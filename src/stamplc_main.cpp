/**
 * RandeSolar StamPLC - Industrial Solar Station & Inverter Guard
 *
 * Target: M5Stack StamPLC (ESP32-S3FN8 / StampS3A)
 * Hardware:
 *  - 9–36V DC Direct Power Input (wired directly to 12V battery bank)
 *  - 1.14" Color LCD Display (ST7789v2) & 3 Physical Pushbuttons (A, B, C)
 *  - 2x Industrial Relays: Relay 1 for 230V Inverter Remote Switch Logic
 *  - Passive BLE scanner with hardware AES-128-CTR decryption for Victron MPPT 75|15
 *  - Onboard LittleFS flash ring-buffer for offline resilience
 *  - WebServer on port 80 with REST API & Relay Remote Control
 *  - HiveMQ MQTT & Supabase Cloud Logger
 */

#include <Arduino.h>
#include <M5StamPLC.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Update.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>
#include "mbedtls/aes.h"
#include <time.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "secrets.h"

// ==================== STAMPLC HARDWARE STATE ====================
static bool g_relay1_inverter = false; // Relay 1: Inverter Front Switch (N.O.)
static bool g_relay2_aux      = false; // Relay 2 Coil (false = de-energized, true = energized)
static bool g_led_strip_on    = true;  // 12V LED Strip on Relay 2 NC (lit when coil is de-energized / 0)
static uint8_t g_lcd_page     = 0;     // 0 = Coconut, 1 = Solar, 2 = Network, 3 = 5G, 4 = Weather
static unsigned long g_lastLcdUpdate = 0;

static uint8_t  g_stripPulseRemaining = 0;
static uint32_t g_lastStripPulseMs = 0;

static String g_activeSsid = "";
static String g_activePass = "";

// Live LCD Activity Banner (displayed across all pages when events occur)
static String   g_lastActivity = "BOOT OK";
static uint32_t g_lastActivityMs = 0;
static uint16_t g_lastActivityColor = TFT_GREEN;

void setLcdActivity(const char* tag, uint16_t color = TFT_CYAN) {
    g_lastActivity = tag;
    g_lastActivityMs = millis();
    g_lastActivityColor = color;
}

void setLedStrip(bool on) {
    g_led_strip_on = on;
    // Relay 2 is wired to NC (Normally Closed):
    // When coil is de-energized (false / 0), NC is closed -> LED strip is powered ON!
    // When coil is energized (true / 1), NC is open -> LED strip is powered OFF!
    bool coilState = !on;
    g_relay2_aux = coilState;
    M5StamPLC.writePlcRelay(1, coilState);
    Serial.printf("[StamPLC ⚡] 12V LED Strip (Relay 2 NC) -> %s (Coil: %s)\n",
                  on ? "ON" : "OFF", coilState ? "ENERGIZED/OPEN" : "DE-ENERGIZED/CLOSED");
    setLcdActivity(on ? "STRIP: ON" : "STRIP: OFF", on ? TFT_YELLOW : TFT_DARKGREY);
}

void triggerStripPulse(uint8_t count = 3) {
    g_stripPulseRemaining = count * 2;
    g_lastStripPulseMs = millis();
    setLcdActivity("STRIP BEAT", TFT_YELLOW);
}

void setPlcRelay(uint8_t relayIdx, bool state) {
    if (relayIdx == 0) {
        g_relay1_inverter = state;
        M5StamPLC.writePlcRelay(0, state);
        Serial.printf("[StamPLC ⚡] Relay 1 (Inverter) -> %s\n", state ? "ON" : "OFF");
        setLcdActivity(state ? "INV: ON" : "INV: OFF", state ? TFT_GREEN : TFT_RED);
    } else if (relayIdx == 1) {
        setLedStrip(state);
    }
}



// ==================== TELEMETRY STATE ====================
struct SolarData {
    uint16_t solar_power = 0;
    float battery_voltage = 0.0f;
    float battery_current = 0.0f;
    uint32_t yield_today_wh = 0;
    float external_load = 0.0f;
    uint8_t charge_state = 0;
    uint8_t charger_error = 0;
    int rssi = 0;
    float panel_voltage = 0.0f; // Vpv from ADC divider (Solar Panel Voltage)
    unsigned long last_seen_ms = 0;
    bool has_data = false;
};

const char* getChargeStateName(uint8_t state);
const char* getChargeStateGerman(uint8_t state);

// ==================== CONFIGURATION ====================
static const char* MDNS_HOST     = "stamplc";

// Telegram Bot Configuration
static const char* TELEGRAM_BOT_TOKEN = SECRETS_TELEGRAM_BOT_TOKEN;
static const char* TELEGRAM_CHAT_ID   = SECRETS_TELEGRAM_CHAT_ID;
static int64_t g_lastTelegramUpdateId = 0;

// Supabase Cloud History Logger
static const char* SUPABASE_URL = SECRETS_SUPABASE_URL;
static const char* SUPABASE_KEY = SECRETS_SUPABASE_KEY;

// Daily Analytics Tracking (reset every midnight)
static uint16_t g_peakPowerToday = 0;
static float g_minBattToday = 99.0f;
static float g_maxBattToday = 0.0f;
static int g_lastReportDay = -1;
static int g_currentMday = -1;

// ==================== PANEL VOLTAGE ADC (SOLAR PV VOLTAGE) ====================
// Voltage divider: Solar(+) ---[ 100k ]---+---[ 4.7k ]--- Solar(-) / GND
//                                         |
//                                    GPIO 4 (ADC1_CH3 on ESP32-S3)
#define SOLAR_ADC_PIN 4
static const float SOLAR_DIVIDER_R1 = 100000.0f; // 100k Ohm
static const float SOLAR_DIVIDER_R2 = 4700.0f;   // 4.7k Ohm
static const float SOLAR_ADC_SCALE  = (SOLAR_DIVIDER_R1 + SOLAR_DIVIDER_R2) / SOLAR_DIVIDER_R2; // ~22.28

float readSolarPanelVoltage() {
    uint32_t mvSum = 0;
    const int SAMPLES = 16;
    for (int i = 0; i < SAMPLES; i++) {
        mvSum += analogReadMilliVolts(SOLAR_ADC_PIN);
        delayMicroseconds(50);
    }
    float pinVolts = (mvSum / (float)SAMPLES) / 1000.0f;
    float panelVolts = pinVolts * SOLAR_ADC_SCALE;
    return (panelVolts >= 1.5f) ? panelVolts : 0.0f;
}

// ==================== OFFLINE RESILIENT FLASH STORAGE (LittleFS) ====================
// Compact 16-byte binary record for power-loss resilient ring buffer in onboard flash
struct __attribute__((packed)) OfflineSolarRecord {
    uint32_t timestamp;      // Unix timestamp (or millis() offset if NTP not available)
    uint16_t solar_power;    // Watts
    uint16_t battery_voltage;// V * 100 (e.g. 1252 = 12.52V)
    int16_t  battery_current;// A * 10 (e.g. 25 = 2.5A)
    uint32_t yield_today_wh; // Wh today
    uint8_t  charge_state;   // 0=Off, 3=Bulk, 4=Abs, 5=Float
    uint8_t  flags;          // Bit 0: time is real NTP (1) or uptime offset (0)
};

static const char* OFFLINE_BUFFER_PATH = "/solar_buffer.bin";
static const size_t MAX_OFFLINE_RECORDS = 35000; // ~560 KB of flash (holds ~48.6 days of 24/7 continuous 2-min samples)
static uint32_t g_bufferedRecordCount = 0;
static bool g_littleFsReady = false;

void initOfflineStorage() {
    if (!LittleFS.begin(true)) {
        Serial.println("[LittleFS ❌] Mount failed!");
        g_littleFsReady = false;
        return;
    }
    g_littleFsReady = true;
    if (LittleFS.exists(OFFLINE_BUFFER_PATH)) {
        File f = LittleFS.open(OFFLINE_BUFFER_PATH, "r");
        if (f) {
            g_bufferedRecordCount = f.size() / sizeof(OfflineSolarRecord);
            f.close();
            Serial.printf("[LittleFS 💾] Mounted! Buffered records waiting for sync: %u\n", g_bufferedRecordCount);
        }
    } else {
        Serial.println("[LittleFS 💾] Mounted fresh buffer.");
    }
}

void storeOfflineRecord(const SolarData& d) {
    if (!g_littleFsReady || !d.has_data) return;

    uint32_t nowMs = millis();

    // Ring-buffer overflow protection: if buffer reaches MAX_OFFLINE_RECORDS, trim the oldest 15%
    if (g_bufferedRecordCount >= MAX_OFFLINE_RECORDS) {
        Serial.println("[LittleFS ⚠️] Buffer full (35,000 records)! Trimming oldest ~16% to preserve newest data...");
        File fRead = LittleFS.open(OFFLINE_BUFFER_PATH, "r");
        if (fRead) {
            size_t total = fRead.size() / sizeof(OfflineSolarRecord);
            size_t dropCount = total / 6; // Drop oldest ~16% (~5800 records)
            fRead.seek(dropCount * sizeof(OfflineSolarRecord));
            File fTemp = LittleFS.open("/temp_buf.bin", "w");
            if (fTemp) {
                uint8_t chunk[512];
                while (fRead.available()) {
                    size_t r = fRead.read(chunk, sizeof(chunk));
                    fTemp.write(chunk, r);
                }
                fTemp.close();
            }
            fRead.close();
            LittleFS.remove(OFFLINE_BUFFER_PATH);
            LittleFS.rename("/temp_buf.bin", OFFLINE_BUFFER_PATH);
            g_bufferedRecordCount = total - dropCount;
        }
    }

    OfflineSolarRecord rec;
    time_t nowTime = time(nullptr);
    if (nowTime > 1700000000) {
        rec.timestamp = (uint32_t)nowTime;
        rec.flags = 1; // Real NTP
    } else {
        rec.timestamp = (uint32_t)(nowMs / 1000);
        rec.flags = 0; // Uptime relative
    }

    rec.solar_power = d.solar_power;
    rec.battery_voltage = (uint16_t)(d.battery_voltage * 100.0f);
    rec.battery_current = (int16_t)(d.battery_current * 10.0f);
    rec.yield_today_wh = d.yield_today_wh;
    rec.charge_state = d.charge_state;

    // Append to file
    File f = LittleFS.open(OFFLINE_BUFFER_PATH, "a");
    if (f) {
        f.write((uint8_t*)&rec, sizeof(OfflineSolarRecord));
        f.close();
        g_bufferedRecordCount++;
        Serial.printf("[LittleFS 📦] Buffered record #%u to flash (%u W, %.2f V, %.1f A)\n", 
            g_bufferedRecordCount, d.solar_power, d.battery_voltage, d.battery_current);
    }
}

// Drain and sync buffered offline records to Supabase when Wi-Fi is restored
void drainOfflineRecordsToCloud() {
    if (!g_littleFsReady || WiFi.status() != WL_CONNECTED || g_bufferedRecordCount == 0) return;

    File f = LittleFS.open(OFFLINE_BUFFER_PATH, "r");
    if (!f) return;

    size_t totalRecords = f.size() / sizeof(OfflineSolarRecord);
    if (totalRecords == 0) {
        f.close();
        LittleFS.remove(OFFLINE_BUFFER_PATH);
        g_bufferedRecordCount = 0;
        return;
    }

    Serial.printf("[LittleFS 🔄] Starting cloud sync for %u buffered records...\n", (unsigned int)totalRecords);

    // Read and upload in fast bulk batches of 50 records
    const size_t BATCH_SIZE = 50;
    OfflineSolarRecord batch[BATCH_SIZE];

    WiFiClientSecure secClient;
    secClient.setInsecure();
    secClient.setTimeout(6500);

    size_t recordsProcessed = 0;
    while (f.available() >= (int)sizeof(OfflineSolarRecord) && recordsProcessed < 250) { // Sync up to 250 records per 2-min cycle
        size_t count = 0;
        for (size_t i = 0; i < BATCH_SIZE && f.available() >= (int)sizeof(OfflineSolarRecord); i++) {
            if (f.read((uint8_t*)&batch[i], sizeof(OfflineSolarRecord)) == sizeof(OfflineSolarRecord)) {
                count++;
            }
        }

        if (count > 0) {
            String jsonArray = "[";
            jsonArray.reserve(count * 200);
            for (size_t i = 0; i < count; i++) {
                char item[260];
                float v = batch[i].battery_voltage / 100.0f;
                float a = batch[i].battery_current / 10.0f;
                
                if (batch[i].flags & 1) {
                    // Has real unix timestamp
                    time_t t = batch[i].timestamp;
                    struct tm tmInfo;
                    gmtime_r(&t, &tmInfo);
                    char timeIso[32];
                    strftime(timeIso, sizeof(timeIso), "%Y-%m-%dT%H:%M:%SZ", &tmInfo);

                    snprintf(item, sizeof(item),
                        "{\"created_at\":\"%s\",\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
                        "\"yield_today_wh\":%lu,\"charge_state\":%u,\"state_str\":\"%s\"}",
                        timeIso, batch[i].solar_power, v, a,
                        (unsigned long)batch[i].yield_today_wh, batch[i].charge_state, getChargeStateName(batch[i].charge_state)
                    );
                } else {
                    snprintf(item, sizeof(item),
                        "{\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
                        "\"yield_today_wh\":%lu,\"charge_state\":%u,\"state_str\":\"%s\"}",
                        batch[i].solar_power, v, a,
                        (unsigned long)batch[i].yield_today_wh, batch[i].charge_state, getChargeStateName(batch[i].charge_state)
                    );
                }

                jsonArray += item;
                if (i < count - 1) jsonArray += ",";
            }
            jsonArray += "]";

            HTTPClient http;
            if (http.begin(secClient, SUPABASE_URL)) {
                http.addHeader("Content-Type", "application/json");
                http.addHeader("apikey", SUPABASE_KEY);
                String authHeader = "Bearer " + String(SUPABASE_KEY);
                http.addHeader("Authorization", authHeader.c_str());
                http.addHeader("Prefer", "return=minimal");

                int code = http.POST((uint8_t*)jsonArray.c_str(), jsonArray.length());
                if (code == 200 || code == 201) {
                    recordsProcessed += count;
                    Serial.printf("[LittleFS ✅] Synced batch of %u records to Supabase!\n", (unsigned int)count);
                } else {
                    Serial.printf("[LittleFS ⚠️] Batch sync returned HTTP %d\n", code);
                    http.end();
                    break; // Stop and retry later
                }
                http.end();
            }
        }
        delay(50);
        yield();
    }

    f.close();

    // If all records were processed, clean up the file
    if (recordsProcessed >= totalRecords) {
        LittleFS.remove(OFFLINE_BUFFER_PATH);
        g_bufferedRecordCount = 0;
        Serial.println("[LittleFS 🧹] All offline records successfully synced! Flash buffer emptied.");
    } else if (recordsProcessed > 0) {
        // Truncate file by rewriting remaining records
        File fRead = LittleFS.open(OFFLINE_BUFFER_PATH, "r");
        if (fRead) {
            fRead.seek(recordsProcessed * sizeof(OfflineSolarRecord));
            File fTemp = LittleFS.open("/temp_buf.bin", "w");
            if (fTemp) {
                uint8_t chunk[256];
                while (fRead.available()) {
                    size_t r = fRead.read(chunk, sizeof(chunk));
                    fTemp.write(chunk, r);
                }
                fTemp.close();
            }
            fRead.close();
            LittleFS.remove(OFFLINE_BUFFER_PATH);
            LittleFS.rename("/temp_buf.bin", OFFLINE_BUFFER_PATH);
            g_bufferedRecordCount = totalRecords - recordsProcessed;
        }
    }
}

// Internet Latency & Diagnostics Tracking
static uint32_t g_netPingMs = 0;      // TCP handshake to 1.1.1.1:53
static uint32_t g_gwPingMs = 0;       // TCP handshake to local router/gateway
static uint32_t g_dnsMs = 0;          // DNS lookup time for Cloudflare
static uint32_t g_ttfbMs = 0;         // HTTP Time-To-First-Byte
void measureLatency();

// Teltonika TRB500 5G Gateway Telemetry (192.168.2.1 ubus JSON-RPC)
static bool     g_cellHasData = false;
static int      g_cellRsrp = 0;         // Reference Signal Received Power in dBm (e.g. -94 dBm)
static int      g_cellSinr = 0;         // Signal-to-Interference-plus-Noise Ratio in dB (e.g. -2 dB)
static int      g_cellRsrq = 0;         // Reference Signal Received Quality in dB (e.g. -14 dB)
static int      g_cellQual = 0;         // Signal Quality in % (e.g. 37%)
static float    g_cellTemp = 0.0f;      // Modem temperature in °C (e.g. 25.0 °C)
static String   g_cellMode = "";        // e.g. "5G-NSA"
static String   g_cellBand = "";        // e.g. "LTE B3 + 5G N1"
static String   g_cellOperator = "";    // e.g. "GoMo"
static String   g_cellId = "";          // Cell ID e.g. "29858817"
static float    g_cellDownMbps = 0.0f;  // Real 5G WAN Download from TRB500 Ookla test
static float    g_cellUpMbps = 0.0f;    // Real 5G WAN Upload from TRB500 Ookla test
static String   g_cellSpeedState = "FINISHED"; // "FINISHED", "TESTING_DOWNLOAD", "TESTING_UPLOAD"
static uint32_t g_lastSpeedtestEpoch = 0;      // Epoch timestamp of last completed speedtest
static uint32_t g_lastCellFetchMs = 0;
static String   g_ubusToken = "";
static uint32_t g_ubusTokenExpires = 0;
void fetchTeltonika5GMetrics(bool force = false);
bool triggerRouterSpeedtest();

// Local Microclimate Tracking (Open-Meteo / MeteoSwiss ICON-CH Underes Ätzisloo 189)
static float g_wxTemp = 0.0f;
static float g_wxSolarWm2 = 0.0f;
static int g_wxCloudPct = 0;
static float g_wxRainMm = 0.0f;
static float g_wxWindKmh = 0.0f;
static int g_wxHumidity = 0;
static float g_wxPressure = 0.0f;
static bool g_wxHasData = false;
static uint32_t g_lastWxFetchMs = 0;
void fetchMeteoSwissWeather(bool force = false);

// HiveMQ Broker
static const char* MQTT_BROKER         = "broker.hivemq.com";
static const int   MQTT_PORT           = 1883;
static const char* MQTT_TOPIC          = "randelab/solar/telemetry";
static const char* MQTT_TOPIC_WIFI     = "randelab/solar/wifi";
static const char* MQTT_TOPIC_WIFI_CMD = "randelab/solar/wifi/cmd";
static const char* MQTT_TOPIC_CMD      = "randelab/solar/cmd";
static const char* MQTT_TOPIC_ACK      = "randelab/solar/ack";

void mqttCallback(char* topic, byte* payload, unsigned int length);
String performWifiScanJson();
void triggerWifiScanAndPublish();

static const char* TARGET_MAC = VICTRON_TARGET_MAC;
#define ENCRYPTION_KEY VICTRON_ENCRYPTION_KEY

static const uint16_t VICTRON_MFG_ID = 0x02E1;

// ==================== ONBOARD WS2812 NEOPIXEL (GPIO 48) ====================
#ifndef RGB_BUILTIN
#define RGB_BUILTIN 48
#endif

static uint32_t g_lastTxFlashMs = 0;
static uint32_t g_ledOverrideUntilMs = 0;
static uint8_t  g_ledOverrideR = 0;
static uint8_t  g_ledOverrideG = 0;
static uint8_t  g_ledOverrideB = 0;
static bool     g_ledOverrideStrobe = false;

void setPixel(uint8_t r, uint8_t g, uint8_t b) {
    M5StamPLC.setStatusLight(r, g, b);
}

void triggerTxFlash() {
    g_lastTxFlashMs = millis();
}

void updateNeoPixel();

static SolarData g_data;
static volatile bool g_newDataAvailable = false;
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

WiFiClient espClient;
PubSubClient mqttClient(espClient);
WebServer server(80);

// Solar Charger States (English & German)
const char* getChargeStateName(uint8_t state) {
    switch (state) {
        case 0: return "OFF";
        case 2: return "FAULT";
        case 3: return "BULK";
        case 4: return "ABSORPTION";
        case 5: return "FLOAT";
        case 252: return "EXTERNAL CONTROL";
        default: return "UNKNOWN";
    }
}

const char* getChargeStateGerman(uint8_t state) {
    switch (state) {
        case 0: return "AUS";
        case 2: return "FEHLER";
        case 3: return "HAUPTLADUNG";
        case 4: return "NACHLADUNG";
        case 5: return "ERHALTUNGSLADUNG";
        case 252: return "EXT. STEUERUNG";
        default: return "UNBEKANNT";
    }
}

// State-Aware Battery SoC Estimation (Lead-Acid / AGM with Victron 3-stage charging compensation)
int estimateBatterySoC(float v, float chargeCurrent = 0.0f, float loadCurrent = 0.0f, uint8_t chargeState = 0) {
    if (v < 5.0f) return 0;
    if (chargeState == 5) return 100; // Float -> full
    if (chargeState == 4) { // Absorption (80% - 95%)
        float taper = constrain(chargeCurrent / 5.0f, 0.0f, 1.0f);
        return (int)constrain(round(95.0f - taper * 15.0f), 80.0f, 95.0f);
    }
    if (chargeState == 3 || chargeCurrent > 0.4f) { // Bulk (15% - 80%)
        float bulkSoC = 15.0f;
        if (v >= 14.2f) bulkSoC = 80.0f;
        else if (v >= 13.6f) bulkSoC = 70.0f + ((v - 13.6f) / 0.6f) * 10.0f;
        else if (v >= 13.0f) bulkSoC = 55.0f + ((v - 13.0f) / 0.6f) * 15.0f;
        else if (v >= 12.5f) bulkSoC = 35.0f + ((v - 12.5f) / 0.5f) * 20.0f;
        else if (v >= 12.0f) bulkSoC = 15.0f + ((v - 12.0f) / 0.5f) * 20.0f;
        else bulkSoC = constrain(((v - 11.2f) / 0.8f) * 15.0f, 5.0f, 15.0f);
        return (int)constrain(round(bulkSoC), 5.0f, 80.0f);
    }

    // Resting / discharging with load sag compensation (~0.03 Ohm)
    float vComp = v + (loadCurrent * 0.03f);
    struct OcvPoint { float v; int soc; };
    static const OcvPoint table[10] = {
        {12.75f, 100}, {12.60f, 90}, {12.50f, 80}, {12.40f, 70},
        {12.30f, 60},  {12.20f, 50}, {12.10f, 40}, {12.00f, 30},
        {11.85f, 15},  {11.60f, 0}
    };
    if (vComp >= table[0].v) return 100;
    if (vComp <= table[9].v) return 0;
    for (int i = 0; i < 9; i++) {
        if (vComp <= table[i].v && vComp >= table[i+1].v) {
            float frac = (vComp - table[i+1].v) / (table[i].v - table[i+1].v);
            return (int)round(table[i+1].soc + frac * (table[i].soc - table[i+1].soc));
        }
    }
    return 50;
}

// Decrypt Victron BLE Instant Readout payload
bool decryptVictronPayload(const uint8_t* encPayload, size_t encLen, uint16_t iv, const uint8_t* key, uint8_t* outDecrypted) {
    if (encLen < 12) return false;
    if (encPayload[0] != key[0]) return false;

    uint8_t block0[16] = {0};
    block0[0] = iv & 0xFF;
    block0[1] = (iv >> 8) & 0xFF;

    uint8_t keystream[16] = {0};
    mbedtls_aes_context aes;
    mbedtls_aes_init(&aes);
    mbedtls_aes_setkey_enc(&aes, key, 128);
    mbedtls_aes_crypt_ecb(&aes, MBEDTLS_AES_ENCRYPT, block0, keystream);
    mbedtls_aes_free(&aes);

    size_t payloadLen = encLen - 1;
    if (payloadLen > 16) payloadLen = 16;
    for (size_t i = 0; i < payloadLen; i++) {
        outDecrypted[i] = encPayload[1 + i] ^ keystream[i];
    }
    return true;
}

// BLE Callback
class VictronScanCallbacks : public NimBLEScanCallbacks {
    void onDiscovered(const NimBLEAdvertisedDevice* advertisedDevice) override {
        std::string addrStr = advertisedDevice->getAddress().toString();
        if (strcasecmp(addrStr.c_str(), TARGET_MAC) != 0) return;

        std::string mfgData = advertisedDevice->getManufacturerData();
        if (mfgData.length() < 19) return;

        const uint8_t* data = (const uint8_t*)mfgData.data();
        size_t len = mfgData.length();

        uint16_t mfgId = data[0] | (data[1] << 8);
        if (mfgId != VICTRON_MFG_ID) return;
        if (data[2] != 0x10) return;
        if (data[6] != 0x01) return;

        uint16_t iv = data[7] | (data[8] << 8);
        const uint8_t* encData = &data[9];
        size_t encLen = len - 9;

        uint8_t decrypted[16] = {0};
        if (!decryptVictronPayload(encData, encLen, iv, ENCRYPTION_KEY, decrypted)) {
            return;
        }

        uint8_t chargeState = decrypted[0];
        uint8_t chargerError = decrypted[1];

        int16_t vBattRaw = (int16_t)(decrypted[2] | (decrypted[3] << 8));
        float batteryVoltage = (vBattRaw != 0x7FFF) ? (vBattRaw / 100.0f) : 0.0f;

        int16_t iBattRaw = (int16_t)(decrypted[4] | (decrypted[5] << 8));
        float batteryCurrent = (iBattRaw != 0x7FFF) ? (iBattRaw / 10.0f) : 0.0f;

        uint16_t yieldRaw = decrypted[6] | (decrypted[7] << 8);
        uint32_t yieldTodayWh = (yieldRaw != 0xFFFF) ? (yieldRaw * 10) : 0;

        uint16_t solarPowerRaw = decrypted[8] | (decrypted[9] << 8);
        uint16_t solarPower = (solarPowerRaw != 0xFFFF) ? solarPowerRaw : 0;

        uint16_t loadRaw = (decrypted[10] | (decrypted[11] << 8)) & 0x01FF;
        float externalLoad = (loadRaw != 0x01FF) ? (loadRaw / 10.0f) : 0.0f;

        int rssi = advertisedDevice->getRSSI();

        float panelVoltage = readSolarPanelVoltage();

        portENTER_CRITICAL(&g_mux);
        g_data.solar_power = solarPower;
        g_data.battery_voltage = batteryVoltage;
        g_data.battery_current = batteryCurrent;
        g_data.yield_today_wh = yieldTodayWh;
        g_data.external_load = externalLoad;
        g_data.charge_state = chargeState;
        g_data.charger_error = chargerError;
        g_data.rssi = rssi;
        g_data.panel_voltage = panelVoltage;
        g_data.last_seen_ms = millis();
        g_data.has_data = true;
        g_newDataAvailable = true;

        if (solarPower > g_peakPowerToday) g_peakPowerToday = solarPower;
        if (batteryVoltage > 5.0f) {
            if (g_minBattToday > 50.0f || batteryVoltage < g_minBattToday) g_minBattToday = batteryVoltage;
            if (batteryVoltage > g_maxBattToday) g_maxBattToday = batteryVoltage;
        }
        portEXIT_CRITICAL(&g_mux);
        setLcdActivity("BLE RX", TFT_GREEN);

        if (panelVoltage > 1.0f) {
            Serial.printf("[☀️ BEACON] Solar: %uW (PV: %.1fV) | Batt: %.2fV, %.1fA | State: %s (%s) | Yield: %uWh | RSSI: %ddBm\n",
                solarPower, panelVoltage, batteryVoltage, batteryCurrent, getChargeStateName(chargeState), getChargeStateGerman(chargeState), yieldTodayWh, rssi);
        } else {
            Serial.printf("[☀️ BEACON] Solar: %uW | Batt: %.2fV, %.1fA | State: %s (%s) | Yield: %uWh | RSSI: %ddBm\n",
                solarPower, batteryVoltage, batteryCurrent, getChargeStateName(chargeState), getChargeStateGerman(chargeState), yieldTodayWh, rssi);
        }
    }
};

static VictronScanCallbacks scanCallbacks;

// ==================== WEB DASHBOARD (HTML in Flash) ====================
static const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RandeSolar • Kraftwerk Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=UnifrakturCook:wght@700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0B0014; --panel: #16032A; --text: #FFEAF4; --muted: #E3A0C0;
      --border: #FF6BB5; --pink: #FF6BB5; --cyan: #00F5FF; --green: #39FF14; --yellow: #FFD400;
      --shadow: 0 0 15px rgba(255, 107, 181, 0.6);
      --font-main: monospace, sans-serif;
      --font-gothic: 'UnifrakturCook', serif;
    }
    body.theme-dresden-dark {
      --bg: #080808; --panel: #151515; --text: #ffffff; --muted: #aaaaaa;
      --border: #666666; --pink: #ffffff; --cyan: #dddddd; --green: #eeeeee; --yellow: #cccccc;
      --shadow: 0 0 20px rgba(255, 255, 255, 0.4), inset 0 0 10px rgba(255, 255, 255, 0.2);
    }
    body.theme-dresden {
      --bg: #d1cfc7; --panel: #e6e4df; --text: #1a1a1a; --muted: #5a574f;
      --border: #8c887e; --pink: #1a1a1a; --cyan: #4f4f4f; --green: #2b2b2b; --yellow: #616161;
      --shadow: 3px 3px 6px rgba(0, 0, 0, 0.25);
    }
    body.theme-randen {
      --bg: #F4ECD8; --panel: #FFFAF0; --text: #2C251D; --muted: #7A6A58;
      --border: #5C4B3A; --pink: #8B0000; --cyan: #3d5a80; --green: #4A6B3D; --yellow: #8A6A1F;
      --shadow: 4px 4px 0 #5C4B3A;
    }
    body.theme-tropical {
      --bg: #051a05; --panel: #0a220a; --text: #e0ffe0; --muted: #5ccc5c;
      --border: #2e8b57; --pink: #ff00ff; --cyan: #00ffcc; --green: #33ff66; --yellow: #facc15;
      --shadow: 0 0 15px rgba(255, 0, 255, 0.4);
    }
    body.theme-coconut {
      --bg: #05100A; --panel: #08180F; --text: #4DFF88; --muted: #2E9455;
      --border: #1F6B3C; --pink: #33FF66; --cyan: #7CFFA8; --green: #B8FFD0; --yellow: #FFB000;
      --shadow: 0 0 10px rgba(77, 255, 136, 0.4);
    }

    body.theme-dresden-dark h1,
    body.theme-dresden-dark h2,
    body.theme-dresden-dark .pill,
    body.theme-dresden h1,
    body.theme-dresden h2,
    body.theme-dresden .pill {
      font-family: var(--font-gothic) !important;
      letter-spacing: 1.5px;
      font-size: 1.4rem;
    }
    body.theme-dresden-dark h1 {
      font-size: 2.2rem;
      text-shadow: 0 0 20px rgba(255, 255, 255, 0.9), 0 0 35px rgba(255, 255, 255, 0.6);
      transform: none !important;
    }
    body.theme-dresden h1 {
      font-size: 2.2rem;
      transform: none !important;
      text-shadow: 1px 1px 0 rgba(255,255,255,0.7);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font-main); }
    body { background-color: var(--bg); color: var(--text); padding: 18px; transition: all 0.25s; }
    .wrapper { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; border-bottom: 2px dashed var(--border); padding-bottom: 12px; }
    h1 { color: var(--pink); font-size: 1.8rem; transform: skew(-2deg); }
    .controls { display: flex; gap: 8px; align-items: center; }
    select { padding: 5px 10px; background: var(--panel); color: var(--text); border: 2px solid var(--border); border-radius: 4px; font-weight: bold; cursor: pointer; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
    .panel { background: var(--panel); border: 2px solid var(--border); border-top: 4px solid var(--cyan); border-radius: 6px; padding: 14px; box-shadow: var(--shadow); }
    .panel h2 { color: var(--green); font-size: 0.95rem; text-transform: uppercase; border-bottom: 1px dashed var(--border); padding-bottom: 6px; margin-bottom: 8px; }
    .val { font-size: 2.7rem; font-weight: bold; line-height: 1.1; }
    .unit { font-size: 1rem; color: var(--muted); }
    .sub { display: flex; justify-content: space-between; margin-top: 10px; font-size: 0.8rem; color: var(--muted); border-top: 1px solid var(--border); padding-top: 6px; }
    .bar { height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; overflow: hidden; margin: 8px 0; border: 1px solid var(--border); }
    .bar-fill { height: 100%; background: linear-gradient(90deg, var(--cyan), var(--green)); transition: width 0.4s; }
    .pill { display: inline-block; padding: 4px 10px; border: 2px solid var(--border); border-radius: 4px; font-weight: bold; font-size: 1.1rem; }
    .footer { text-align: center; font-size: 0.75rem; color: var(--muted); margin-top: 10px; }
  </style>
</head>
<body class="theme-dresden-dark">
  <div class="wrapper">
    <div class="header">
      <div>
        <h1 id="lblTitle">RandeSolar Kraftwerk</h1>
        <small id="lblSubtitle" style="color:var(--muted)">AUTONOME PHOTOVOLTAIK-STEUERUNG</small>
      </div>
      <div class="controls">
        <label id="lblTheme">Stil:</label>
        <select id="themeSelect" onchange="applyTheme(this.value)">
          <option value="dresden-dark" selected>Kongreß Dresden (Nacht) 🇩🇪</option>
          <option value="dresden">Kongreß Dresden (Altpapier) 🇩🇪</option>
          <option value="randen">Randen</option>
          <option value="pinkograph">Pinkograph</option>
          <option value="tropical">Deep Jungle Dark</option>
          <option value="coconut">Coconut Phosphor</option>
        </select>
      </div>
    </div>

    <div class="grid">
      <div class="panel" style="border-top-color: var(--yellow)">
        <h2 id="lblPanelSolar">Solarmodul (Photovoltaik)</h2>
        <div class="val"><span id="solarPower">--</span> <span class="unit">W</span></div>
        <div class="sub"><span id="lblYield">Tagesertrag:</span><b id="yieldToday" style="color:var(--text)">-- kWh</b></div>
      </div>

      <div class="panel" style="border-top-color: var(--cyan)">
        <h2 id="lblPanelBattery">Batteriespeicher (12V)</h2>
        <div class="val"><span id="batteryVoltage">--</span> <span class="unit">V</span></div>
        <div class="bar"><div id="batteryBar" class="bar-fill" style="width: 50%"></div></div>
        <div class="sub"><span id="lblSoc">Ladezustand:</span><b id="estSoc" style="color:var(--text)">-- %</b></div>
      </div>

      <div class="panel" style="border-top-color: var(--pink)">
        <h2 id="lblPanelCurrent">Ladestrom & Fluß</h2>
        <div class="val"><span id="batteryCurrent">--</span> <span class="unit">A</span></div>
        <div class="sub"><span id="lblFlow">Leistung:</span><b id="flowWatts" style="color:var(--text)">-- W</b></div>
      </div>

      <div class="panel" style="border-top-color: var(--green)">
        <h2 id="lblPanelState">Regler-Zustand</h2>
        <div style="margin: 6px 0;"><span class="pill" id="chargeState">--</span></div>
        <div class="sub"><span id="lblLoad">Lastanschluß:</span><b id="externalLoad" style="color:var(--text)">-- A</b></div>
      </div>
    </div>

    <div class="panel" style="border-top-color: var(--yellow)">
      <h2 id="lblLedTitle">💡 Onboard Status-LED (WS2812 Farbcodes)</h2>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-top:8px; font-size:0.8rem; line-height:1.4;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:12px; height:12px; min-width:12px; border-radius:50%; background:#FFD400; box-shadow:0 0 6px #FFD400;"></span>
          <span><b>Sonnengelb:</b> Solar-Erzeugung (>0W)</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:12px; height:12px; min-width:12px; border-radius:50%; background:#00E676; box-shadow:0 0 6px #00E676;"></span>
          <span><b>Smaragdgrün:</b> Erhaltungsladung (Float 100%)</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:12px; height:12px; min-width:12px; border-radius:50%; background:#00F5FF; box-shadow:0 0 6px #00F5FF;"></span>
          <span><b>Türkis:</b> Nachladung (Absorption)</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:12px; height:12px; min-width:12px; border-radius:50%; background:#B388FF; box-shadow:0 0 6px #B388FF;"></span>
          <span><b>Purpur:</b> Hauptladung (Bulk)</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:12px; height:12px; min-width:12px; border-radius:50%; background:#00838F; box-shadow:0 0 6px #00838F;"></span>
          <span><b>Dezentes Petrol:</b> Standby / Nacht (0W)</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:12px; height:12px; min-width:12px; border-radius:50%; background:#00E5FF; box-shadow:0 0 8px #00E5FF;"></span>
          <span><b>Cyan-Puls:</b> 40ms Heartbeat alle 5s (MQTT Tx)</span>
        </div>
      </div>
    </div>

    <!-- Hyper-Localized Weather & Solar Radiation (Underes Ätzisloo 189, Merishausen / Randen) -->
    <div class="panel" style="border-top-color: var(--yellow)">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border); padding-bottom:6px; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
        <h2 id="lblPanelWeather" style="border:none; margin:0; padding:0;">🌤️ Mikroklima & Solar-Strahlung • Underes Ätzisloo 189</h2>
        <span style="font-size:0.72rem; color:var(--muted); font-family:monospace;">47.7701°N, 8.5738°E • ~857m ü.M. (MeteoSwiss ICON)</span>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap:10px; font-size:0.82rem;">
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">🌡️ AUSSENTEMP. (ÄTZISLOO)</div>
          <div style="font-size:1.35rem; font-weight:bold; color:var(--yellow);"><span id="wxIcon">⛅</span> <span id="wxTemp">--</span> °C</div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;"><span id="wxDesc">Lade Wetter...</span> (Gef. <span id="wxApparent">--</span>°)</div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">☀️ SONNENSTRAHLUNG (GTI)</div>
          <div style="font-size:1.35rem; font-weight:bold; color:var(--pink);"><span id="wxSolarWm2">--</span> <small style="font-size:0.75rem;">W/m²</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Direkt <span id="wxDirectWm2">--</span> • Diffus <span id="wxDiffuseWm2">--</span></div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">🌫️ BEWÖLKUNG & HOCHNEBEL</div>
          <div style="font-size:1.35rem; font-weight:bold; color:var(--cyan);"><span id="wxCloudTotal">--</span> <small style="font-size:0.75rem;">%</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Tief <span id="wxCloudLow">--</span>% • Mitt <span id="wxCloudMid">--</span>% • Hoch <span id="wxCloudHigh">--</span>%</div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">💨 WIND & BÖEN (RANDEN)</div>
          <div style="font-size:1.15rem; font-weight:bold; color:var(--green);"><span id="wxWindSpeed">--</span> km/h <small style="color:var(--muted); font-size:0.75rem;">(<span id="wxWindDir">--</span>)</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Böen bis <span id="wxWindGusts">--</span> km/h</div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">💧 FEUCHTE & DRUCK</div>
          <div style="font-size:1.15rem; font-weight:bold;"><span id="wxHumidity">--</span>% <small style="color:var(--muted); font-size:0.75rem;">• <span id="wxPressure">--</span> hPa</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Taupunkt <span id="wxDewPoint">--</span>°C • Regen <span id="wxPrecip">0.0</span> mm</div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">🌅 SONNENLAUF & PROGNOSE</div>
          <div style="font-size:1.1rem; font-weight:bold; color:var(--yellow); margin-top:2px;">☀️↑ <span id="wxSunrise">--:--</span> • 🌙↓ <span id="wxSunset">--:--</span></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Heute <span id="wxTempMin">--</span>°/<span id="wxTempMax">--</span>°C • ☀️ <span id="wxSunHours">--</span>h</div>
        </div>
      </div>
    </div>

    <div class="panel" style="border-top-color: var(--cyan)">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed var(--border); padding-bottom:6px; margin-bottom:10px;">
        <h2 id="lblPanelNet" style="border:none; margin:0; padding:0;">🚀 5G-Mobilfunk & ESP32-S3 Netzwerk-Diagnose</h2>
        <button id="btnSpeedtest" onclick="runSpeedtest()" style="padding:4px 10px; background:var(--pink); color:var(--bg); border:none; border-radius:4px; font-weight:bold; cursor:pointer; font-size:0.78rem;">🔄 Live Sync</button>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap:10px; font-size:0.82rem;">
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px; background:rgba(0,0,0,0.15);">
          <div style="color:var(--muted); font-size:0.72rem;">⬇️ 5G ROUTER DOWNLOAD</div>
          <div style="font-size:1.35rem; font-weight:bold; color:var(--cyan);"><span id="cellDown">--</span> <small style="font-size:0.75rem;">Mbit/s</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">TRB500 Nativer Ookla Test</div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px; background:rgba(0,0,0,0.15);">
          <div style="color:var(--muted); font-size:0.72rem;">⬆️ 5G ROUTER UPLOAD</div>
          <div style="font-size:1.35rem; font-weight:bold; color:var(--pink);"><span id="cellUp">--</span> <small style="font-size:0.75rem;">Mbit/s</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">Snapdragon X55 WAN Uplink</div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px; background:rgba(0,0,0,0.15);">
          <div style="color:var(--muted); font-size:0.72rem;">📡 5G GATEWAY (TRB500)</div>
          <div style="font-size:1.25rem; font-weight:bold; color:var(--yellow);"><span id="cellRsrp">--</span> <small style="font-size:0.75rem;">dBm</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;">SINR <span id="cellSinr">--</span> dB • Güte <span id="cellQual">--</span>%</div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px; background:rgba(0,0,0,0.15);">
          <div style="color:var(--muted); font-size:0.72rem;">🏢 5G BAND & OPERATOR</div>
          <div style="font-size:1.1rem; font-weight:bold; color:var(--green);"><span id="cellOperator">--</span> <small style="font-size:0.75rem; color:var(--muted);">(<span id="cellMode">--</span>)</small></div>
          <div style="font-size:0.72rem; color:var(--muted); margin-top:2px;"><span id="cellBand">--</span> • Cell <span id="cellId">--</span></div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">🏓 PING (INTERNET / ROUTER)</div>
          <div style="font-size:1.15rem; font-weight:bold; color:var(--green);"><span id="netPing">--</span> ms <small style="color:var(--muted); font-size:0.75rem;">/ GW <span id="gwPing">--</span> ms</small></div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">🔍 DNS & HTTP TTFB</div>
          <div style="font-size:1.15rem; font-weight:bold; color:var(--yellow);">DNS <span id="dnsMs">--</span> ms <small style="color:var(--muted); font-size:0.75rem;">/ TTFB <span id="ttfbMs">--</span> ms</small></div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">📶 WLAN SIGNAL & KANAL</div>
          <div style="font-size:1.15rem; font-weight:bold;"><span id="wifiRssi">--</span> dBm <small style="color:var(--muted); font-size:0.75rem;">(<span id="wifiQual">--</span>% • Ch <span id="wifiCh">--</span>)</small></div>
        </div>
        <div style="padding:8px; border:1px solid var(--border); border-radius:4px;">
          <div style="color:var(--muted); font-size:0.72rem;">🌡️ ROUTER & ESP32 CHIP</div>
          <div style="font-size:1.15rem; font-weight:bold;"><span id="chipTemp">--</span> °C <small style="color:var(--muted); font-size:0.75rem;">(Modem: <span id="cellTemp">--</span>°C)</small></div>
        </div>
      </div>
      <div class="sub" style="margin-top:10px; display:flex; flex-wrap:wrap; gap:14px;">
        <span><b>Victron BLE:</b> cb:06:61:60:5a:c2 (<span id="bleRssi">--</span> dBm)</span>
        <span><b>ESP32-IP:</b> <span id="ipAddr">--</span></span>
        <span><b>Gateway:</b> <span id="gwAddr">--</span></span>
        <span><b>RAM:</b> <span id="freeHeap">--</span> KB frei</span>
        <span><b>MQTT:</b> broker.hivemq.com</span>
        <span><b>Empfang:</b> <span id="beaconAge">--</span></span>
        <span><a id="tgBotLink" href="https://t.me/RandeSolarBot" target="_blank" style="color:var(--cyan);text-decoration:none;font-weight:bold;">✈️ Telegram Bot</a></span>
        <span><a href="/update" style="color:var(--pink);text-decoration:none;font-weight:bold;">⚡ OTA Firmware Update</a></span>
      </div>
    </div>
    <div class="footer" id="lblFooter">RandeSolar • Mechatronische Kunstwerkstatt RandeLab</div>
  </div>

  <script>
    const setT = (id, val) => { const n = document.getElementById(id); if (n && val !== undefined && val !== null) n.textContent = val; };
    const dict = {
      de: {
        title: "RandeSolar Kraftwerk",
        subtitle: "AUTONOME PHOTOVOLTAIK-STEUERUNG (MPPT 75|15)",
        theme: "Stil:",
        panelSolar: "Solarmodul (Photovoltaik)",
        yield: "Tagesertrag:",
        panelBattery: "Batteriespeicher (12V Akkumulator)",
        soc: "Ladezustand:",
        panelCurrent: "Ladestrom & Leistungsfluß",
        flow: "Leistung:",
        panelState: "Laderegler-Zustand",
        load: "Lastanschluß:",
        panelDiag: "Systemdiagnose & Funknetz",
        footer: "RandeSolar • Mechatronische Kunstwerkstatt RandeLab",
        states: { 0: "AUS", 2: "FEHLER", 3: "HAUPTLADUNG", 4: "NACHLADUNG", 5: "ERHALTUNG", 252: "EXT. STEUERUNG" }
      },
      en: {
        title: "RandeSolar ESP32",
        subtitle: "STANDALONE VIC-MPPT 75|15 ACCESS POINT",
        theme: "Theme:",
        panelSolar: "Solar Array (PV)",
        yield: "Yield Today:",
        panelBattery: "Battery Storage (12V)",
        soc: "Est. SOC:",
        panelCurrent: "Charge Flow",
        flow: "Power Flow:",
        panelState: "Controller State",
        load: "Load Port:",
        panelDiag: "Diagnostics & Network",
        footer: "RandeSolar • openBrushograph Mechatronics",
        states: { 0: "OFF", 2: "FAULT", 3: "BULK", 4: "ABSORPTION", 5: "FLOAT", 252: "EXT CONTROL" }
      }
    };

    let curLang = "de";

    function applyTheme(th) {
      document.body.className = "theme-" + th;
      localStorage.setItem("randesolar-esp-theme", th);

      curLang = (th.startsWith("dresden") || th === "randen") ? "de" : "en";
      const l = dict[curLang];

      document.getElementById("lblTitle").textContent = l.title;
      document.getElementById("lblSubtitle").textContent = l.subtitle;
      document.getElementById("lblTheme").textContent = l.theme;
      document.getElementById("lblPanelSolar").textContent = l.panelSolar;
      document.getElementById("lblYield").textContent = l.yield;
      document.getElementById("lblPanelBattery").textContent = l.panelBattery;
      document.getElementById("lblSoc").textContent = l.soc;
      document.getElementById("lblPanelCurrent").textContent = l.panelCurrent;
      document.getElementById("lblFlow").textContent = l.flow;
      document.getElementById("lblPanelState").textContent = l.panelState;
      document.getElementById("lblLoad").textContent = l.load;
      const elDiag = document.getElementById("lblPanelDiag") || document.getElementById("lblPanelNet");
      if (elDiag) elDiag.textContent = l.panelDiag;
      document.getElementById("lblFooter").textContent = l.footer;
    }

    async function runSpeedtest() {
      const btn = document.getElementById('btnSpeedtest');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Messe...'; }
      try {
        await fetch('/api/speedtest');
        await update();
      } catch (e) { console.error(e); }
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Live Speedtest'; }
    }

    async function update() {
      try {
        const res = await fetch('/api/live');
        const d = await res.json();
        if (!d.has_data) return;

        setT('solarPower', d.solar_power);
        setT('yieldToday', (d.yield_today_wh / 1000).toFixed(2) + ' kWh');
        setT('batteryVoltage', d.battery_voltage.toFixed(2));

        let soc = 50;
        if (d.charge_state === 5) soc = 100;
        else if (d.charge_state === 4) soc = 88;
        else if (d.charge_state === 3 || d.battery_current > 0.4) {
          if (d.battery_voltage >= 14.2) soc = 80;
          else if (d.battery_voltage >= 13.0) soc = Math.round(55 + ((d.battery_voltage - 13.0) / 1.2) * 25);
          else soc = Math.round(Math.min(50, Math.max(10, ((d.battery_voltage - 11.8) / 1.2) * 50)));
        } else {
          soc = Math.round(Math.min(100, Math.max(0, ((d.battery_voltage - 11.6) / 1.15) * 100)));
        }
        const bBar = document.getElementById('batteryBar');
        if (bBar) bBar.style.width = soc + '%';
        const stageLabel = (d.charge_state === 5) ? 'Float' : (d.charge_state === 4) ? 'Absorp.' : (d.charge_state === 3) ? 'Bulk' : 'Ruhe';
        setT('estSoc', soc + '% (' + stageLabel + ')');

        setT('batteryCurrent', d.battery_current.toFixed(1));
        setT('flowWatts', (d.battery_voltage * d.battery_current).toFixed(1) + ' W');

        const stateMap = dict[curLang].states;
        const stStr = stateMap[d.charge_state] || d.state_str;
        setT('chargeState', stStr);

        setT('externalLoad', d.external_load.toFixed(1) + ' A');
        setT('bleRssi', d.ble_rssi);
        setT('wifiRssi', d.wifi_rssi);
        if (d.wifi_quality_pct !== undefined) setT('wifiQual', d.wifi_quality_pct);
        if (d.wifi_channel !== undefined) setT('wifiCh', d.wifi_channel);
        setT('ipAddr', d.ip);
        if (d.gateway_ip) setT('gwAddr', d.gateway_ip);
        if (d.chip_temp !== undefined) setT('chipTemp', d.chip_temp.toFixed(1));
        if (d.free_heap_kb !== undefined) setT('freeHeap', d.free_heap_kb);

        const downSpeed = (d.cell_down_mbps !== undefined && d.cell_down_mbps > 0) ? d.cell_down_mbps : d.net_mbps;
        const upSpeed = (d.cell_up_mbps !== undefined && d.cell_up_mbps > 0) ? d.cell_up_mbps : d.net_up_mbps;
        if (downSpeed !== undefined && downSpeed > 0) {
          setT('cellDown', downSpeed.toFixed(2));
          setT('netDown', downSpeed.toFixed(2));
        }
        if (upSpeed !== undefined && upSpeed > 0) {
          setT('cellUp', upSpeed.toFixed(2));
          setT('netUp', upSpeed.toFixed(2));
        }

        if (d.net_ping_ms !== undefined) setT('netPing', d.net_ping_ms);
        if (d.gw_ping_ms !== undefined) setT('gwPing', d.gw_ping_ms);
        if (d.dns_ms !== undefined) setT('dnsMs', d.dns_ms);
        if (d.ttfb_ms !== undefined) setT('ttfbMs', d.ttfb_ms);

        if (d.cell_has_data) {
          setT('cellRsrp', d.cell_rsrp);
          setT('cellSinr', d.cell_sinr);
          setT('cellBand', d.cell_band);
          setT('cellQual', d.cell_qual);
          setT('cellOperator', d.cell_operator);
          setT('cellMode', d.cell_mode);
          setT('cellId', d.cell_id);
          if (d.cell_temp !== undefined) setT('cellTemp', d.cell_temp.toFixed(1));
        }
        setT('beaconAge', d.age_sec + (curLang === 'de' ? ' Sek.' : 's ago'));
      } catch (e) {
        console.error('Update error:', e);
      }
    }

    const savedTheme = localStorage.getItem("randesolar-esp-theme") || "pinkograph";
    document.getElementById("themeSelect").value = savedTheme;
    applyTheme(savedTheme);

    const WMO_MAP = {
      0: { de: "Wolkenlos", en: "Clear sky", icon: "☀️" },
      1: { de: "Überwiegend heiter", en: "Mainly clear", icon: "🌤️" },
      2: { de: "Teilweise bewölkt", en: "Partly cloudy", icon: "⛅" },
      3: { de: "Bedeckt", en: "Overcast", icon: "☁️" },
      45: { de: "Nebel", en: "Fog", icon: "🌫️" },
      48: { de: "Reifnebel / Hochnebel", en: "Depositing rime fog", icon: "🌫️" },
      51: { de: "Leichter Nieselregen", en: "Light drizzle", icon: "🌦️" },
      61: { de: "Leichter Regen", en: "Slight rain", icon: "🌦️" },
      63: { de: "Mässiger Regen", en: "Moderate rain", icon: "🌧️" },
      65: { de: "Starker Regen", en: "Heavy rain", icon: "🌧️" },
      71: { de: "Schneefall", en: "Snow", icon: "🌨️" },
      80: { de: "Regenschauer", en: "Rain showers", icon: "🌦️" },
      95: { de: "Gewitter", en: "Thunderstorm", icon: "⛈️" }
    };

    function getWindDir(deg) {
      if (deg === undefined) return "--";
      const s = ["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
      return s[Math.round(deg / 22.5) % 16];
    }

    async function fetchWeather() {
      try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=47.7701&longitude=8.5738&elevation=857&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation,global_tilted_irradiance&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,sunshine_duration&timezone=Europe%2FZurich&tilt=35';
        const res = await fetch(url);
        if (!res.ok) return;
        const d = await res.json();
        const cur = d.current;
        const daily = d.daily;
        if (!cur) return;

        const wmo = WMO_MAP[cur.weather_code] || { de: "Unbestimmt", en: "Unknown", icon: "🌤️" };
        const setT = (id, val) => { const n = document.getElementById(id); if (n) n.textContent = val; };

        setT('wxIcon', wmo.icon);
        setT('wxTemp', cur.temperature_2m !== undefined ? cur.temperature_2m.toFixed(1) : '--');
        setT('wxDesc', curLang === 'de' ? wmo.de : wmo.en);
        setT('wxApparent', cur.apparent_temperature !== undefined ? cur.apparent_temperature.toFixed(1) : '--');

        const gti = cur.global_tilted_irradiance !== undefined ? Math.round(cur.global_tilted_irradiance) : Math.round(cur.shortwave_radiation || 0);
        setT('wxSolarWm2', gti);
        setT('wxDirectWm2', cur.direct_normal_irradiance !== undefined ? Math.round(cur.direct_normal_irradiance) : '--');
        setT('wxDiffuseWm2', cur.diffuse_radiation !== undefined ? Math.round(cur.diffuse_radiation) : '--');

        setT('wxCloudTotal', cur.cloud_cover !== undefined ? cur.cloud_cover : '--');
        setT('wxCloudLow', cur.cloud_cover_low !== undefined ? cur.cloud_cover_low : '--');
        setT('wxCloudMid', cur.cloud_cover_mid !== undefined ? cur.cloud_cover_mid : '--');
        setT('wxCloudHigh', cur.cloud_cover_high !== undefined ? cur.cloud_cover_high : '--');

        setT('wxWindSpeed', cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : '--');
        setT('wxWindDir', getWindDir(cur.wind_direction_10m));
        setT('wxWindGusts', cur.wind_gusts_10m !== undefined ? Math.round(cur.wind_gusts_10m) : '--');

        setT('wxHumidity', cur.relative_humidity_2m !== undefined ? cur.relative_humidity_2m : '--');
        setT('wxPressure', cur.surface_pressure !== undefined ? Math.round(cur.surface_pressure) : '--');
        setT('wxPrecip', cur.precipitation !== undefined ? cur.precipitation.toFixed(1) : '0.0');

        if (cur.temperature_2m !== undefined && cur.relative_humidity_2m !== undefined) {
          const a = 17.27, b = 237.7;
          const alpha = ((a * cur.temperature_2m) / (b + cur.temperature_2m)) + Math.log(cur.relative_humidity_2m / 100.0);
          setT('wxDewPoint', ((b * alpha) / (a - alpha)).toFixed(1));
        }

        if (daily) {
          if (daily.sunrise && daily.sunrise[0]) setT('wxSunrise', daily.sunrise[0].substring(11, 16));
          if (daily.sunset && daily.sunset[0]) setT('wxSunset', daily.sunset[0].substring(11, 16));
          if (daily.temperature_2m_min && daily.temperature_2m_min[0] !== undefined) setT('wxTempMin', Math.round(daily.temperature_2m_min[0]));
          if (daily.temperature_2m_max && daily.temperature_2m_max[0] !== undefined) setT('wxTempMax', Math.round(daily.temperature_2m_max[0]));
          if (daily.sunshine_duration && daily.sunshine_duration[0] !== undefined) setT('wxSunHours', (daily.sunshine_duration[0] / 3600).toFixed(1));
        }
      } catch (e) {
        console.warn('Weather fetch:', e);
      }
    }

    fetchWeather();
    setInterval(fetchWeather, 120000);

    fetch('https://api.telegram.org/bot8600149990:AAGGHL_USsmi_PfzPFBDIvoFgQx-rmvXIkc/getMe')
      .then(r => r.json())
      .then(j => {
        if (j.ok && j.result && j.result.username) {
          const el = document.getElementById('tgBotLink');
          if (el) { el.href = 'https://t.me/' + j.result.username; el.textContent = '✈️ @' + j.result.username; }
        }
      }).catch(() => {});

    setInterval(update, 2000);
    update();
  </script>
</body>
</html>
)rawliteral";

// ==================== WEB OTA UPDATE PAGE ====================
static const char OTA_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RandeSolar • OTA Firmware Update</title>
  <style>
    body { background: #0B0014; color: #FFEAF4; font-family: monospace, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 90vh; margin: 0; padding: 18px; }
    .card { background: #16032A; border: 2px solid #FF6BB5; border-top: 4px solid #00F5FF; border-radius: 6px; padding: 24px; max-width: 460px; width: 100%; box-shadow: 0 0 15px rgba(255, 107, 181, 0.5); }
    h1 { color: #FF6BB5; font-size: 1.4rem; margin: 0 0 8px 0; }
    p { color: #E3A0C0; font-size: 0.85rem; margin: 0 0 18px 0; line-height: 1.4; }
    input[type=file] { width: 100%; padding: 10px; background: #0B0014; color: #FFEAF4; border: 1px dashed #FF6BB5; border-radius: 4px; margin-bottom: 14px; cursor: pointer; }
    button { width: 100%; padding: 10px; background: #FF6BB5; color: #0B0014; border: none; border-radius: 4px; font-weight: bold; font-size: 1rem; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .bar { height: 10px; background: #0B0014; border: 1px solid #FF6BB5; border-radius: 4px; overflow: hidden; margin-top: 14px; display: none; }
    .fill { height: 100%; width: 0%; background: linear-gradient(90deg, #00F5FF, #39FF14); transition: width 0.2s; }
    #status { margin-top: 10px; font-size: 0.85rem; color: #00F5FF; text-align: center; }
    .back { display: inline-block; margin-top: 16px; color: #E3A0C0; font-size: 0.8rem; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ RandeSolar OTA Update</h1>
    <p>Wähle eine kompilierte <code>firmware.bin</code> Datei aus (<code>.pio/build/esp32-s3-devkitc-1/firmware.bin</code>), um den ESP32-S3 drahtlos zu aktualisieren.</p>
    <form id="otaForm">
      <input type="file" id="fileInput" name="update" accept=".bin" required>
      <button type="submit" id="btnUpload">Firmware flashen</button>
    </form>
    <div class="bar" id="progBar"><div class="fill" id="progFill"></div></div>
    <div id="status"></div>
    <a class="back" href="/">← Zurück zum Dashboard</a>
  </div>
  <script>
    const form = document.getElementById('otaForm');
    form.onsubmit = function(e) {
      e.preventDefault();
      const file = document.getElementById('fileInput').files[0];
      if (!file) return;
      const btn = document.getElementById('btnUpload');
      const bar = document.getElementById('progBar');
      const fill = document.getElementById('progFill');
      const status = document.getElementById('status');
      btn.disabled = true;
      bar.style.display = 'block';
      status.textContent = 'Übertrage Firmware...';

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/update', true);
      xhr.upload.onprogress = function(ev) {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          fill.style.width = pct + '%';
          status.textContent = 'Upload: ' + pct + '% (' + Math.round(ev.loaded / 1024) + ' KB)';
        }
      };
      xhr.onload = function() {
        if (xhr.status === 200) {
          fill.style.width = '100%';
          status.style.color = '#39FF14';
          status.textContent = '✅ Update erfolgreich! ESP32-S3 startet neu...';
          setTimeout(() => { location.href = '/'; }, 6000);
        } else {
          status.style.color = '#FF3860';
          status.textContent = '❌ Fehler: ' + xhr.responseText;
          btn.disabled = false;
        }
      };
      xhr.onerror = function() {
        status.style.color = '#FF3860';
        status.textContent = '❌ Verbindungsfehler beim Upload.';
        btn.disabled = false;
      };
      const data = new FormData();
      data.append('update', file);
      xhr.send(data);
    };
  </script>
</body>
</html>
)rawliteral";

// ==================== REST API HANDLERS ====================
void handleRoot() {
    server.send(200, "text/html", INDEX_HTML);
}

void handleOtaPage() {
    server.send(200, "text/html", OTA_HTML);
}

void drawOtaLcdScreen(const char* title, uint8_t pct) {
    auto& dsp = M5StamPLC.Display();
    dsp.startWrite();
    if (pct == 0) {
        dsp.fillScreen(TFT_BLACK);
        dsp.setTextColor(TFT_MAGENTA, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(10, 16);
        dsp.print(title);
        dsp.setTextColor(TFT_WHITE, TFT_BLACK);
        dsp.setTextSize(1);
        dsp.setCursor(10, 44);
        dsp.print("Receiving firmware wirelessly...");
        dsp.drawRect(10, 68, 220, 22, TFT_WHITE);
    }
    int barW = (pct * 216) / 100;
    dsp.fillRect(12, 70, barW, 18, TFT_CYAN);
    dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
    dsp.setTextSize(2);
    dsp.setCursor(100, 102);
    dsp.printf("%u%%", pct);
    dsp.endWrite();
}

void handleOtaUploadDone() {
    server.sendHeader("Connection", "close");
    if (Update.hasError()) {
        server.send(500, "text/plain", Update.errorString());
    } else {
        server.send(200, "text/plain", "OK");
        delay(400);
        ESP.restart();
    }
}

void handleOtaUploadChunk() {
    HTTPUpload& upload = server.upload();
    if (upload.status == UPLOAD_FILE_START) {
        Serial.printf("[WebOTA] Update Start: %s\n", upload.filename.c_str());
        NimBLEDevice::getScan()->stop();
        setPixel(25, 0, 25); // Magenta during OTA
        drawOtaLcdScreen("WEB BROWSER OTA", 0);
        if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
            Update.printError(Serial);
        }
    } else if (upload.status == UPLOAD_FILE_WRITE) {
        if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
            Update.printError(Serial);
        }
    } else if (upload.status == UPLOAD_FILE_END) {
        if (Update.end(true)) {
            Serial.printf("[WebOTA] Update Success: %u bytes. Rebooting...\n", upload.totalSize);
            setPixel(0, 40, 10);
            auto& dsp = M5StamPLC.Display();
            dsp.fillScreen(TFT_BLACK);
            dsp.setTextColor(TFT_GREEN, TFT_BLACK);
            dsp.setTextSize(2);
            dsp.setCursor(10, 40);
            dsp.print("OTA SUCCESS!");
            dsp.setTextSize(1);
            dsp.setCursor(10, 70);
            dsp.print("Rebooting new firmware...");
            M5StamPLC.tone(1800, 100); delay(120);
            M5StamPLC.tone(2400, 150);
        } else {
            Update.printError(Serial);
            setPixel(40, 0, 0);
            NimBLEDevice::getScan()->start(0, false);
        }
    }
}

void setupOTA() {
    ArduinoOTA.setHostname(MDNS_HOST);

    ArduinoOTA.onStart([]() {
        NimBLEDevice::getScan()->stop();
        setPixel(25, 0, 25); // Magenta indicator for OTA start
        drawOtaLcdScreen("ARDUINO OTA", 0);
        Serial.println("\n[ArduinoOTA] Starting wireless update...");
    });
    ArduinoOTA.onEnd([]() {
        setPixel(0, 40, 10); // Green on finish
        auto& dsp = M5StamPLC.Display();
        dsp.fillScreen(TFT_BLACK);
        dsp.setTextColor(TFT_GREEN, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(10, 40);
        dsp.print("OTA SUCCESS!");
        dsp.setTextSize(1);
        dsp.setCursor(10, 70);
        dsp.print("Rebooting new firmware...");
        M5StamPLC.tone(1800, 100); delay(120);
        M5StamPLC.tone(2400, 150);
        Serial.println("\n[ArduinoOTA] Update complete! Rebooting...");
    });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        uint8_t pct = (progress * 100) / (total ? total : 1);
        setPixel(20, 0, (uint8_t)map(pct, 0, 100, 5, 45));
        drawOtaLcdScreen("ARDUINO OTA", pct);
        Serial.printf("[ArduinoOTA] Progress: %u%%\r", pct);
    });
    ArduinoOTA.onError([](ota_error_t error) {
        setPixel(40, 0, 0);
        auto& dsp = M5StamPLC.Display();
        dsp.fillScreen(TFT_BLACK);
        dsp.setTextColor(TFT_RED, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(10, 40);
        dsp.print("OTA FAILED!");
        Serial.printf("\n[ArduinoOTA] Error[%u]\n", error);
        NimBLEDevice::getScan()->start(0, false);
    });

    ArduinoOTA.begin();
    Serial.printf("[OTA] Ready at %s.local:3232 and http://%s.local/update\n", MDNS_HOST, MDNS_HOST);
}

void handleRelayApi() {
    if (server.hasArg("r") && server.hasArg("state")) {
        int r = server.arg("r").toInt();
        String s = server.arg("state");
        bool state = (s.toInt() == 1 || s == "true" || s == "on");
        if (s == "toggle") {
            state = (r == 1) ? !g_relay1_inverter : !g_led_strip_on;
        }
        if (r == 1) setPlcRelay(0, state);
        else if (r == 2) setLedStrip(state);
        char resp[160];
        snprintf(resp, sizeof(resp), "{\"status\":\"ok\",\"relay\":%d,\"state\":%s,\"inverter\":%s,\"led_strip\":%s}",
                 r, state ? "true" : "false", g_relay1_inverter ? "true" : "false", g_led_strip_on ? "true" : "false");
        server.send(200, "application/json", resp);
    } else if (server.hasArg("strip")) {
        String s = server.arg("strip");
        bool state = (s == "1" || s == "true" || s == "on");
        if (s == "toggle") state = !g_led_strip_on;
        setLedStrip(state);
        char resp[160];
        snprintf(resp, sizeof(resp), "{\"status\":\"ok\",\"action\":\"strip\",\"led_strip\":%s}",
                 g_led_strip_on ? "true" : "false");
        server.send(200, "application/json", resp);
    } else if (server.hasArg("pulse")) {
        int count = server.arg("pulse").toInt();
        triggerStripPulse(count > 0 ? count : 3);
        server.send(200, "application/json", "{\"status\":\"ok\",\"action\":\"pulse\"}");
    } else {
        char resp[160];
        snprintf(resp, sizeof(resp), "{\"relay1_inverter\":%s,\"relay2_coil\":%s,\"led_strip\":%s}",
                 g_relay1_inverter ? "true" : "false", g_relay2_aux ? "true" : "false", g_led_strip_on ? "true" : "false");
        server.send(200, "application/json", resp);
    }
}

void drawLcdHeader(const char* title, const char* pageStr) {
    auto& dsp = M5StamPLC.Display();
    dsp.fillScreen(TFT_BLACK);
    dsp.setTextColor(TFT_CYAN, TFT_BLACK);
    dsp.setTextSize(1);
    dsp.setCursor(4, 4);
    dsp.printf("%s %s", title, pageStr);

    // Live Activity Tag in Top Right (x=136..238)
    if (millis() - g_lastActivityMs < 3000) {
        dsp.fillRect(136, 2, 100, 14, g_lastActivityColor);
        dsp.setTextColor(TFT_BLACK, g_lastActivityColor);
        dsp.setTextSize(1);
        dsp.setCursor(140, 5);
        dsp.printf(" %s", g_lastActivity.c_str());
    } else {
        if (g_relay1_inverter) {
            dsp.fillRect(146, 2, 90, 14, TFT_DARKGREEN);
            dsp.setTextColor(TFT_WHITE, TFT_DARKGREEN);
            dsp.setCursor(150, 5);
            dsp.print("INV 230V: ON ");
        } else {
            dsp.fillRect(146, 2, 90, 14, TFT_MAROON);
            dsp.setTextColor(TFT_WHITE, TFT_MAROON);
            dsp.setCursor(150, 5);
            dsp.print("INV 230V: OFF");
        }
    }
    dsp.drawFastHLine(0, 18, 240, TFT_DARKGREY);
}

void drawNeonCoconutLogo(int cx, int cy, float battVolts, float battCurrent, float extLoad, uint8_t chargeState) {
    auto& dsp = M5StamPLC.Display();

    // 1. Outside Pinion Wheel: Always in iconic Hackteria Neon Pink style!
    // Shows Battery Charge % (State of Charge 0..100%) along the 7 teeth!
    int soc = estimateBatterySoC(battVolts, battCurrent, extLoad, chargeState);

    // 7 teeth map proportionally to 0% .. 100% Battery SoC:
    int activeTeeth = 0;
    if (soc >= 93) activeTeeth = 7;      // ~100% (All 7 teeth bright pink!)
    else if (soc >= 79) activeTeeth = 6; // ~85%
    else if (soc >= 64) activeTeeth = 5; // ~70%
    else if (soc >= 50) activeTeeth = 4; // ~50% (Half-way: teeth up to 12 o'clock center)
    else if (soc >= 36) activeTeeth = 3; // ~40%
    else if (soc >= 21) activeTeeth = 2; // ~25%
    else if (soc >= 7)  activeTeeth = 1; // ~15%
    else activeTeeth = 0;                // Critical low (<7%) -> all dim pink outline

    // Bright Neon Pink (powered glowing neon tube)
    uint16_t brightGlow  = dsp.color565(140, 0, 70);
    uint16_t brightCore  = dsp.color565(255, 30, 150);
    uint16_t brightHot   = dsp.color565(255, 210, 235);

    // Dim Neon Pink (subdued unlit/resting neon tube)
    uint16_t dimGlow     = dsp.color565(35, 0, 18);
    uint16_t dimCore     = dsp.color565(95, 15, 55);

    // OSHW Pinion Wheel: 7 Teeth, bottom open throat (curving inward into coconut)
    const float R_OUT = 47.0f;
    const float R_IN  = 36.0f;
    const float teethDeg[7] = { 135.0f, 180.0f, 225.0f, 270.0f, 315.0f, 360.0f, 405.0f };

    // Throat bottom-left (starts at cx - 14, cy + 38 to cx - 22, cy + 30)
    bool throatL_bright = (activeTeeth > 0);
    uint16_t tg = throatL_bright ? brightGlow : dimGlow;
    uint16_t tc = throatL_bright ? brightCore : dimCore;
    dsp.drawLine(cx - 15, cy + 38, cx - 23, cy + 30, tg);
    dsp.drawLine(cx - 13, cy + 38, cx - 21, cy + 30, tg);
    dsp.drawLine(cx - 14, cy + 37, cx - 22, cy + 29, tg);
    dsp.drawLine(cx - 14, cy + 39, cx - 22, cy + 31, tg);
    dsp.drawLine(cx - 14, cy + 38, cx - 22, cy + 30, tc);
    if (throatL_bright) {
        dsp.drawLine(cx - 14, cy + 38, cx - 22, cy + 30, brightHot);
    }

    int16_t prevX = cx - 22;
    int16_t prevY = cy + 30;

    for (int i = 0; i < 7; i++) {
        float tRad = teethDeg[i] * DEG_TO_RAD;
        float hw = 9.0f * DEG_TO_RAD;
        float rw = 14.0f * DEG_TO_RAD;

        int16_t pValley1_X = cx + (int16_t)(R_IN  * cosf(tRad - rw));
        int16_t pValley1_Y = cy + (int16_t)(R_IN  * sinf(tRad - rw));
        int16_t pCrest1_X  = cx + (int16_t)(R_OUT * cosf(tRad - hw));
        int16_t pCrest1_Y  = cy + (int16_t)(R_OUT * sinf(tRad - hw));
        int16_t pCrest2_X  = cx + (int16_t)(R_OUT * cosf(tRad + hw));
        int16_t pCrest2_Y  = cy + (int16_t)(R_OUT * sinf(tRad + hw));
        int16_t pValley2_X = cx + (int16_t)(R_IN  * cosf(tRad + rw));
        int16_t pValley2_Y = cy + (int16_t)(R_IN  * sinf(tRad + rw));

        bool isBright = (i < activeTeeth);
        uint16_t gCol = isBright ? brightGlow : dimGlow;
        uint16_t cCol = isBright ? brightCore : dimCore;

        int16_t segX[5] = { prevX, pValley1_X, pCrest1_X, pCrest2_X, pValley2_X };
        int16_t segY[5] = { prevY, pValley1_Y, pCrest1_Y, pCrest2_Y, pValley2_Y };

        for (int s = 0; s < 4; s++) {
            int x0 = segX[s],   y0 = segY[s];
            int x1 = segX[s+1], y1 = segY[s+1];
            // Outer halo glow
            dsp.drawLine(x0 - 1, y0, x1 - 1, y1, gCol);
            dsp.drawLine(x0 + 1, y0, x1 + 1, y1, gCol);
            dsp.drawLine(x0, y0 - 1, x1, y1 - 1, gCol);
            dsp.drawLine(x0, y0 + 1, x1, y1 + 1, gCol);
            // Core tube
            dsp.drawLine(x0, y0, x1, y1, cCol);
            // White-hot center highlight for bright active teeth
            if (isBright) {
                dsp.drawLine(x0, y0, x1, y1, brightHot);
            }
        }
        prevX = pValley2_X;
        prevY = pValley2_Y;
    }

    // Throat bottom-right (curves back inward to meet coconut)
    bool throatR_bright = (activeTeeth >= 7);
    uint16_t tr_g = throatR_bright ? brightGlow : dimGlow;
    uint16_t tr_c = throatR_bright ? brightCore : dimCore;

    dsp.drawLine(prevX - 1, prevY, cx + 21, cy + 30, tr_g);
    dsp.drawLine(prevX + 1, prevY, cx + 23, cy + 30, tr_g);
    dsp.drawLine(prevX, prevY, cx + 22, cy + 30, tr_c);

    dsp.drawLine(cx + 21, cy + 30, cx + 13, cy + 38, tr_g);
    dsp.drawLine(cx + 23, cy + 30, cx + 15, cy + 38, tr_g);
    dsp.drawLine(cx + 22, cy + 30, cx + 14, cy + 38, tr_c);

    if (throatR_bright) {
        dsp.drawLine(prevX, prevY, cx + 22, cy + 30, brightHot);
        dsp.drawLine(cx + 22, cy + 30, cx + 14, cy + 38, brightHot);
    }

    // 2. Inside Coconut Color = Charge State
    // Bulk: Bright Neon Green -> Absorption: Bright Gold -> Float: Bright Cyan
    uint16_t cocoGlow, cocoCore, cocoHot;
    switch (chargeState) {
        case 3: // BULK (Maximum solar power harvest) -> Bright Neon Green!
            cocoGlow = dsp.color565(0, 120, 50);
            cocoCore = dsp.color565(57, 255, 20);  // Vivid Neon Spring Green
            cocoHot  = dsp.color565(210, 255, 200); // White-hot neon tube core
            break;
        case 4: // ABSORPTION (Topping off near 14.4V) -> Bright Neon Gold!
            cocoGlow = dsp.color565(120, 90, 0);
            cocoCore = dsp.color565(255, 215, 0);  // Vivid Neon Gold
            cocoHot  = dsp.color565(255, 255, 180);
            break;
        case 5: // FLOAT (Fully charged 100% maintain) -> Bright Neon Cyan!
            cocoGlow = dsp.color565(0, 90, 140);
            cocoCore = dsp.color565(0, 240, 255);  // Vivid Electric Cyan
            cocoHot  = dsp.color565(200, 255, 255);
            break;
        default: // OFF / Night / Standby
            cocoGlow = dsp.color565(15, 30, 20);
            cocoCore = dsp.color565(50, 95, 65);   // Dim Pine Green
            cocoHot  = dsp.color565(75, 125, 90);
            break;
    }

    // Coconut Arc & Wavy Bite Cutout Points
    const float R_COCO = 24.0f;
    int16_t cX[45];
    int16_t cY[45];
    int cIdx = 0;

    // Left bottom opening
    cX[cIdx] = cx - 8; cY[cIdx++] = cy + 32;

    // Outer arc up left side (105 deg -> 275 deg)
    for (int deg = 105; deg <= 275; deg += 10) {
        float a = deg * DEG_TO_RAD;
        cX[cIdx] = cx + (int16_t)(R_COCO * cosf(a));
        cY[cIdx++] = cy + (int16_t)(R_COCO * sinf(a));
    }

    // Wavy bite around straw opening
    cX[cIdx] = cx + 7;  cY[cIdx++] = cy - 23;
    cX[cIdx] = cx + 2;  cY[cIdx++] = cy - 11;
    cX[cIdx] = cx + 13; cY[cIdx++] = cy - 7;
    cX[cIdx] = cx + 19; cY[cIdx++] = cy - 14;

    // Outer arc down right side (15 deg -> 75 deg)
    for (int deg = 15; deg <= 75; deg += 10) {
        float a = deg * DEG_TO_RAD;
        cX[cIdx] = cx + (int16_t)(R_COCO * cosf(a));
        cY[cIdx++] = cy + (int16_t)(R_COCO * sinf(a));
    }

    // Right bottom opening
    cX[cIdx] = cx + 8; cY[cIdx++] = cy + 32;

    // Draw Coconut with Neon Glow Tube effect
    for (int i = 0; i < cIdx - 1; i++) {
        int x0 = cX[i], y0 = cY[i];
        int x1 = cX[i+1], y1 = cY[i+1];
        dsp.drawLine(x0 - 1, y0, x1 - 1, y1, cocoGlow);
        dsp.drawLine(x0 + 1, y0, x1 + 1, y1, cocoGlow);
        dsp.drawLine(x0, y0 - 1, x1, y1 - 1, cocoGlow);
        dsp.drawLine(x0, y0 + 1, x1, y1 + 1, cocoGlow);
        dsp.drawLine(x0, y0, x1, y1, cocoCore);
        dsp.drawLine(x0, y0, x1, y1, cocoHot);
    }

    // 3. Straw: 3rd Distinct Neon Color (Electric Yellow / Amber)
    uint16_t strawGlow  = dsp.color565(180, 110, 0);
    uint16_t strawCore  = dsp.color565(255, 255, 50);
    uint16_t strawWhite = dsp.color565(255, 255, 220);

    int sx0 = cx + 8,  sy0 = cy - 7;
    int sx1 = cx + 31, sy1 = cy - 31;

    // Thick neon straw with radiant core
    dsp.drawLine(sx0 - 2, sy0, sx1 - 2, sy1, strawGlow);
    dsp.drawLine(sx0 + 2, sy0, sx1 + 2, sy1, strawGlow);
    dsp.drawLine(sx0, sy0 - 2, sx1, sy1 - 2, strawGlow);
    dsp.drawLine(sx0, sy0 + 2, sx1, sy1 + 2, strawGlow);
    dsp.drawLine(sx0 - 1, sy0, sx1 - 1, sy1, strawCore);
    dsp.drawLine(sx0 + 1, sy0, sx1 + 1, sy1, strawCore);
    dsp.drawLine(sx0, sy0 - 1, sx1, sy1 - 1, strawCore);
    dsp.drawLine(sx0, sy0 + 1, sx1, sy1 + 1, strawCore);
    dsp.drawLine(sx0, sy0, sx1, sy1, strawWhite);
}

void renderLcdDashboard() {
    auto& dsp = M5StamPLC.Display();
    dsp.setBrightness(180);
    dsp.startWrite();

    if (g_lcd_page == 0) {
        // ==================== PAGE 0: ICONIC NEON COCONUT EMBLEM ====================
        // Pure minimalist ambient screen: NO header, NO numbers
        dsp.fillScreen(TFT_BLACK);

        // Giant Neon Hackteria OSHW Coconut Logo filling the display
        // Outside Pinion Wheel: Charge % (SOC), Inside Coconut: Charge Mode
        drawNeonCoconutLogo(120, 56, g_data.battery_voltage, g_data.battery_current, g_data.external_load, g_data.charge_state);

        // Minimal single bottom line for button descriptions
        dsp.drawFastHLine(0, 118, 240, TFT_DARKGREY);
        dsp.setTextSize(1);

        // Button A: Inverter (Relay 1 NO)
        dsp.setTextColor(g_relay1_inverter ? TFT_GREEN : TFT_RED, TFT_BLACK);
        dsp.setCursor(4, 122);
        dsp.printf("[A]INV:%s", g_relay1_inverter ? "ON" : "OFF");

        // Button C: 12V LED Strip (Relay 2 NC)
        dsp.setTextColor(g_led_strip_on ? TFT_YELLOW : TFT_DARKGREY, TFT_BLACK);
        dsp.setCursor(76, 122);
        dsp.printf("[C]STRIP:%s", g_led_strip_on ? "ON" : "OFF");

        // Button B: Next Screen
        dsp.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        dsp.setCursor(162, 122);
        dsp.print("[B] Next >");

    } else if (g_lcd_page == 1) {
        // ==================== PAGE 1: HERO SOLAR & BATTERY [P1/4] ====================
        drawLcdHeader("RANDESOLAR", "[P1/4]");

        // Row 1: Solar Power (BIG Size 3) & Daily Yield (Size 2)
        dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
        dsp.setTextSize(3);
        dsp.setCursor(4, 22);
        dsp.printf("%uW", g_data.solar_power);

        dsp.setTextSize(2);
        dsp.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        dsp.setCursor(115, 28);
        dsp.printf("%luWh", (unsigned long)g_data.yield_today_wh);

        // Row 2: Battery Voltage (BIG Size 3) & Battery Current (Size 2)
        float v = g_data.battery_voltage;
        uint16_t vColor = (v >= 12.8f) ? TFT_GREEN : ((v >= 11.8f) ? TFT_ORANGE : TFT_RED);
        dsp.setTextColor(vColor, TFT_BLACK);
        dsp.setTextSize(3);
        dsp.setCursor(4, 52);
        dsp.printf("%.2fV", v);

        dsp.setTextSize(2);
        dsp.setTextColor(TFT_WHITE, TFT_BLACK);
        dsp.setCursor(120, 58);
        dsp.printf("%+.1fA", g_data.battery_current);

        dsp.drawFastHLine(0, 80, 240, TFT_DARKGREY);

        // Row 3: Charge State & BLE RSSI
        dsp.setTextSize(2);
        dsp.setTextColor(TFT_CYAN, TFT_BLACK);
        dsp.setCursor(4, 86);
        dsp.printf("%s", getChargeStateName(g_data.charge_state));

        dsp.setTextSize(2);
        dsp.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        dsp.setCursor(135, 86);
        dsp.printf("%ddBm", g_data.rssi);

        // Footer: Buttons & Navigation
        dsp.drawFastHLine(0, 108, 240, TFT_DARKGREY);
        dsp.setTextSize(2);
        dsp.setTextColor(g_relay1_inverter ? TFT_GREEN : TFT_RED, TFT_BLACK);
        dsp.setCursor(4, 114);
        dsp.printf("[A]INV:%s", g_relay1_inverter ? "ON " : "OFF");

        dsp.setTextSize(1);
        dsp.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        dsp.setCursor(130, 120);
        dsp.print("[B] Next P2/4");

    } else if (g_lcd_page == 2) {
        // ==================== PAGE 2: NETWORK & CLOUD SYNC [P2/4] ====================
        drawLcdHeader("NETWORK & SYNC", "[P2/4]");

        // Wi-Fi SSID
        dsp.setTextColor(TFT_WHITE, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(4, 22);
        dsp.printf("WiFi: %s", WiFi.SSID().c_str());

        // IP Address
        dsp.setTextSize(2);
        dsp.setCursor(4, 44);
        dsp.printf("IP: %s", WiFi.localIP().toString().c_str());

        // MQTT Status
        dsp.setTextSize(2);
        dsp.setCursor(4, 66);
        dsp.setTextColor(mqttClient.connected() ? TFT_GREEN : TFT_RED, TFT_BLACK);
        dsp.printf("MQTT: %s", mqttClient.connected() ? "CONNECTED" : "OFFLINE");

        // Flash Offline Buffer & Gateway Ping
        dsp.setTextColor(TFT_WHITE, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(4, 88);
        dsp.printf("Buf:%urec Ping:%ums", (unsigned int)g_bufferedRecordCount, (unsigned int)g_gwPingMs);

        // Footer
        dsp.drawFastHLine(0, 108, 240, TFT_DARKGREY);
        dsp.setTextSize(1);
        dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
        dsp.setCursor(4, 116);
        dsp.print("[A] Wi-Fi Menu   [B] Next P3/4");

    } else if (g_lcd_page == 3) {
        // ==================== PAGE 3: TELTONIKA 5G GATEWAY [P3/4] ====================
        drawLcdHeader("TELTONIKA 5G", "[P3/4]");

        // 5G Operator & Mode
        dsp.setTextColor(TFT_CYAN, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(4, 22);
        dsp.printf("%s • %s", g_cellOperator.length() ? g_cellOperator.c_str() : "5G", g_cellMode.length() ? g_cellMode.c_str() : "NSA");

        // Bands
        dsp.setTextColor(TFT_WHITE, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(4, 44);
        dsp.printf("Band: %s", g_cellBand.length() ? g_cellBand.c_str() : "n78/B3");

        // Signal Quality (RSRP & SINR)
        dsp.setTextSize(2);
        dsp.setTextColor(TFT_GREEN, TFT_BLACK);
        dsp.setCursor(4, 66);
        dsp.printf("RSRP:%d SINR:%ddB", g_cellRsrp, g_cellSinr);

        // Speedtest or Modem Temperature
        dsp.setTextSize(2);
        dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
        dsp.setCursor(4, 88);
        if (g_cellDownMbps > 0) {
            dsp.printf("Spd: %.0fM v / %.0fM ^", g_cellDownMbps, g_cellUpMbps);
        } else {
            dsp.printf("Modem Temp: %.1f C", g_cellTemp);
        }

        // Footer
        dsp.drawFastHLine(0, 108, 240, TFT_DARKGREY);
        dsp.setTextSize(1);
        dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
        dsp.setCursor(4, 116);
        dsp.print("[A] Test Ping    [B] Next P4/4");

    } else if (g_lcd_page == 4) {
        // ==================== PAGE 4: WEATHER & MICROCLIMATE [P4/4] ====================
        drawLcdHeader("METEO • 857m", "[P4/4]");

        // Temperature & Solar Irradiance
        dsp.setTextSize(2);
        dsp.setTextColor(TFT_CYAN, TFT_BLACK);
        dsp.setCursor(4, 22);
        dsp.printf("Temp: %.1f C", g_wxTemp);

        dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
        dsp.setCursor(130, 22);
        dsp.printf("%.0fW/m2", g_wxSolarWm2);

        // Cloud Cover & Rain
        dsp.setTextSize(2);
        dsp.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        dsp.setCursor(4, 44);
        dsp.printf("Cloud:%d%% Rain:%.1f", g_wxCloudPct, g_wxRainMm);

        // Humidity & Wind
        dsp.setTextSize(2);
        dsp.setTextColor(TFT_WHITE, TFT_BLACK);
        dsp.setCursor(4, 66);
        dsp.printf("Hum:%d%% Wind:%.1f", g_wxHumidity, g_wxWindKmh);

        // Barometric Pressure
        dsp.setTextSize(2);
        dsp.setTextColor(TFT_GREEN, TFT_BLACK);
        dsp.setCursor(4, 88);
        dsp.printf("Baro: %.1f hPa", g_wxPressure);

        // Footer
        dsp.drawFastHLine(0, 108, 240, TFT_DARKGREY);
        dsp.setTextSize(1);
        dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
        dsp.setCursor(4, 116);
        dsp.print("[A] Sync Weather [B] Back to Coconut");
    }

    dsp.endWrite();
}

void handleLiveApi() {
    SolarData d;
    portENTER_CRITICAL(&g_mux);
    d = g_data;
    portEXIT_CRITICAL(&g_mux);

    unsigned long ageSec = d.has_data ? ((millis() - d.last_seen_ms) / 1000) : 999;
    float chipTemp = temperatureRead();
    int wifiRssi = WiFi.RSSI();
    int wifiQual = constrain(2 * (wifiRssi + 100), 0, 100);

    char json[1450];
    snprintf(json, sizeof(json),
        "{\"has_data\":%s,\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,\"panel_voltage\":%.2f,"
        "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
        "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,\"wifi_quality_pct\":%d,\"wifi_channel\":%d,"
        "\"chip_temp\":%.1f,\"free_heap_kb\":%u,\"net_mbps\":%.2f,\"net_up_mbps\":%.2f,"
        "\"net_ping_ms\":%u,\"gw_ping_ms\":%u,\"dns_ms\":%u,\"ttfb_ms\":%u,"
        "\"cell_has_data\":%s,\"cell_rsrp\":%d,\"cell_sinr\":%d,\"cell_rsrq\":%d,\"cell_qual\":%d,"
        "\"cell_mode\":\"%s\",\"cell_band\":\"%s\",\"cell_operator\":\"%s\",\"cell_id\":\"%s\",\"cell_temp\":%.1f,"
        "\"cell_down_mbps\":%.2f,\"cell_up_mbps\":%.2f,\"cell_speed_state\":\"%s\",\"cell_speed_epoch\":%lu,"
        "\"wx_temp\":%.1f,\"wx_solar_wm2\":%.1f,\"wx_cloud_pct\":%d,\"wx_rain_mm\":%.2f,\"wx_wind_kmh\":%.1f,\"wx_humidity\":%d,\"wx_pressure\":%.1f,"
        "\"relay1_inverter\":%s,\"relay2_coil\":%s,\"led_strip\":%s,"
        "\"buffered_records\":%u,\"ip\":\"%s\",\"gateway_ip\":\"%s\",\"age_sec\":%lu}",
        d.has_data ? "true" : "false",
        d.solar_power,
        d.battery_voltage,
        d.battery_current,
        d.panel_voltage,
        (unsigned long)d.yield_today_wh,
        d.external_load,
        d.charge_state,
        getChargeStateName(d.charge_state),
        d.charger_error,
        d.rssi,
        wifiRssi,
        wifiQual,
        WiFi.channel(),
        chipTemp,
        (unsigned int)(ESP.getFreeHeap() / 1024),
        g_cellDownMbps,
        g_cellUpMbps,
        (unsigned int)g_netPingMs,
        (unsigned int)g_gwPingMs,
        (unsigned int)g_dnsMs,
        (unsigned int)g_ttfbMs,
        g_cellHasData ? "true" : "false",
        g_cellRsrp,
        g_cellSinr,
        g_cellRsrq,
        g_cellQual,
        g_cellMode.c_str(),
        g_cellBand.c_str(),
        g_cellOperator.c_str(),
        g_cellId.c_str(),
        g_cellTemp,
        g_cellDownMbps,
        g_cellUpMbps,
        g_cellSpeedState.c_str(),
        (unsigned long)g_lastSpeedtestEpoch,
        g_wxTemp,
        g_wxSolarWm2,
        g_wxCloudPct,
        g_wxRainMm,
        g_wxWindKmh,
        g_wxHumidity,
        g_wxPressure,
        g_relay1_inverter ? "true" : "false",
        g_relay2_aux ? "true" : "false",
        g_led_strip_on ? "true" : "false",
        (unsigned int)g_bufferedRecordCount,
        WiFi.localIP().toString().c_str(),
        WiFi.gatewayIP().toString().c_str(),
        ageSec
    );

    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", json);
}

void handleBufferApi() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    if (!g_littleFsReady || !LittleFS.exists(OFFLINE_BUFFER_PATH)) {
        server.send(200, "application/json", "{\"count\":0,\"records\":[]}");
        return;
    }

    File f = LittleFS.open(OFFLINE_BUFFER_PATH, "r");
    if (!f) {
        server.send(500, "application/json", "{\"error\":\"Could not open buffer file\"}");
        return;
    }

    size_t count = f.size() / sizeof(OfflineSolarRecord);
    String json = "{\"count\":" + String(count) + ",\"records\":[";

    size_t readCount = 0;
    OfflineSolarRecord rec;
    while (f.read((uint8_t*)&rec, sizeof(OfflineSolarRecord)) == sizeof(OfflineSolarRecord) && readCount < 100) {
        if (readCount > 0) json += ",";
        char buf[200];
        snprintf(buf, sizeof(buf),
            "{\"timestamp\":%u,\"solar_w\":%u,\"batt_v\":%.2f,\"batt_a\":%.1f,\"yield_wh\":%lu,\"state\":\"%s\"}",
            rec.timestamp, rec.solar_power, rec.battery_voltage / 100.0f, rec.battery_current / 10.0f,
            (unsigned long)rec.yield_today_wh, getChargeStateName(rec.charge_state)
        );
        json += buf;
        readCount++;
    }
    f.close();
    json += "]}";
    server.send(200, "application/json", json);
}

void handleBufferCsv() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Content-Disposition", "attachment; filename=\"randesolar_buffer.csv\"");
    if (!g_littleFsReady || !LittleFS.exists(OFFLINE_BUFFER_PATH)) {
        server.send(200, "text/csv", "timestamp,solar_w,batt_v,batt_a,yield_wh,state\n");
        return;
    }

    File f = LittleFS.open(OFFLINE_BUFFER_PATH, "r");
    if (!f) {
        server.send(500, "text/plain", "Could not open buffer");
        return;
    }

    server.setContentLength(CONTENT_LENGTH_UNKNOWN);
    server.send(200, "text/csv", "");
    server.sendContent("timestamp,solar_w,batt_v,batt_a,yield_wh,state\n");

    OfflineSolarRecord rec;
    char line[128];
    while (f.read((uint8_t*)&rec, sizeof(OfflineSolarRecord)) == sizeof(OfflineSolarRecord)) {
        snprintf(line, sizeof(line), "%u,%u,%.2f,%.1f,%lu,%s\n",
            rec.timestamp, rec.solar_power, rec.battery_voltage / 100.0f, rec.battery_current / 10.0f,
            (unsigned long)rec.yield_today_wh, getChargeStateName(rec.charge_state));
        server.sendContent(line);
    }
    f.close();
    server.sendContent("");
}

void handleSpeedtestApi() {
    triggerRouterSpeedtest();
    measureLatency();
    fetchTeltonika5GMetrics(true);
    handleLiveApi();
}

String performWifiScanJson() {
    int n = WiFi.scanNetworks(false, true);
    String json = "{\"status\":\"ok\",\"timestamp\":" + String(millis()) + ",\"count\":" + String(n >= 0 ? n : 0) + ",\"networks\":[";
    if (n > 0) {
        for (int i = 0; i < n; ++i) {
            if (i > 0) json += ",";
            json += "{";
            String safeSsid = WiFi.SSID(i);
            safeSsid.replace("\"", "\\\"");
            json += "\"ssid\":\"" + safeSsid + "\",";
            json += "\"bssid\":\"" + WiFi.BSSIDstr(i) + "\",";
            json += "\"rssi\":" + String(WiFi.RSSI(i)) + ",";
            json += "\"channel\":" + String(WiFi.channel(i)) + ",";
            json += "\"auth\":\"";
            switch (WiFi.encryptionType(i)) {
                case WIFI_AUTH_OPEN: json += "OPEN"; break;
                case WIFI_AUTH_WEP: json += "WEP"; break;
                case WIFI_AUTH_WPA_PSK: json += "WPA"; break;
                case WIFI_AUTH_WPA2_PSK: json += "WPA2"; break;
                case WIFI_AUTH_WPA_WPA2_PSK: json += "WPA/WPA2"; break;
                case WIFI_AUTH_WPA2_ENTERPRISE: json += "WPA2-EAP"; break;
                case WIFI_AUTH_WPA3_PSK: json += "WPA3"; break;
                case WIFI_AUTH_WPA2_WPA3_PSK: json += "WPA2/WPA3"; break;
                default: json += "UNKNOWN"; break;
            }
            json += "\"}";
        }
    }
    json += "]}";
    WiFi.scanDelete();
    return json;
}

void triggerWifiScanAndPublish() {
    String json = performWifiScanJson();
    if (mqttClient.connected()) {
        mqttClient.publish(MQTT_TOPIC_WIFI, json.c_str(), true); // Retained for immediate delivery to GitHub Pages
        Serial.println("[MQTT 📶] Published live Wi-Fi scan to randelab/solar/wifi (retained)");
    }
}

void handleWifiScanApi() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "*");

    String json = performWifiScanJson();
    if (mqttClient.connected()) {
        mqttClient.publish(MQTT_TOPIC_WIFI, json.c_str(), true);
    }
    server.send(200, "application/json", json);
}

String applyLedCommand(const String& cmd, uint32_t durationSec = 10) {
    uint32_t durationMs = durationSec * 1000;
    String lower = cmd;
    lower.toLowerCase();

    if (lower.indexOf("strobe") >= 0 || lower.indexOf("disco") >= 0 || lower.indexOf("party") >= 0 || lower.indexOf("blink") >= 0) {
        g_ledOverrideStrobe = true;
        g_ledOverrideUntilMs = millis() + durationMs;
        Serial.printf("[LED 💡] DISCO STROBE activated (%us)\n", durationSec);
        return "{\"status\":\"ok\",\"action\":\"disco_strobe\",\"duration_sec\":" + String(durationSec) + "}";
    }

    g_ledOverrideStrobe = false;
    if (lower.indexOf("red") >= 0 || lower.indexOf("rot") >= 0) {
        g_ledOverrideR = 255; g_ledOverrideG = 0; g_ledOverrideB = 0;
    } else if (lower.indexOf("green") >= 0 || lower.indexOf("grun") >= 0 || lower.indexOf("grün") >= 0) {
        g_ledOverrideR = 0; g_ledOverrideG = 255; g_ledOverrideB = 0;
    } else if (lower.indexOf("blue") >= 0 || lower.indexOf("blau") >= 0) {
        g_ledOverrideR = 0; g_ledOverrideG = 60; g_ledOverrideB = 255;
    } else if (lower.indexOf("pink") >= 0 || lower.indexOf("magenta") >= 0 || lower.indexOf("purple") >= 0) {
        g_ledOverrideR = 255; g_ledOverrideG = 0; g_ledOverrideB = 180;
    } else if (lower.indexOf("cyan") >= 0 || lower.indexOf("türkis") >= 0) {
        g_ledOverrideR = 0; g_ledOverrideG = 240; g_ledOverrideB = 255;
    } else if (lower.indexOf("yellow") >= 0 || lower.indexOf("gelb") >= 0 || lower.indexOf("gold") >= 0) {
        g_ledOverrideR = 255; g_ledOverrideG = 200; g_ledOverrideB = 0;
    } else if (lower.indexOf("white") >= 0 || lower.indexOf("weiss") >= 0) {
        g_ledOverrideR = 255; g_ledOverrideG = 255; g_ledOverrideB = 255;
    } else if (lower.indexOf("orange") >= 0) {
        g_ledOverrideR = 255; g_ledOverrideG = 120; g_ledOverrideB = 0;
    } else if (lower.indexOf("off") >= 0 || lower.indexOf("aus") >= 0) {
        g_ledOverrideR = 0; g_ledOverrideG = 0; g_ledOverrideB = 0;
    } else {
        // Default bright neon magenta flash
        g_ledOverrideR = 255; g_ledOverrideG = 0; g_ledOverrideB = 255;
    }

    g_ledOverrideUntilMs = millis() + durationMs;
    setPixel(g_ledOverrideR, g_ledOverrideG, g_ledOverrideB);
    char buf[128];
    snprintf(buf, sizeof(buf), "{\"status\":\"ok\",\"action\":\"led\",\"r\":%u,\"g\":%u,\"b\":%u,\"duration_sec\":%u}",
        g_ledOverrideR, g_ledOverrideG, g_ledOverrideB, durationSec);
    Serial.printf("[LED 💡] Set to R=%u G=%u B=%u for %us\n", g_ledOverrideR, g_ledOverrideG, g_ledOverrideB, durationSec);
    return String(buf);
}

void handleLedApi() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "*");

    if (server.method() == HTTP_OPTIONS) {
        server.send(204);
        return;
    }

    String color = "party";
    if (server.hasArg("color")) {
        color = server.arg("color");
    } else if (server.hasArg("cmd")) {
        color = server.arg("cmd");
    } else if (server.hasArg("action")) {
        color = server.arg("action");
    }

    uint32_t dur = 10;
    if (server.hasArg("duration")) {
        dur = server.arg("duration").toInt();
        if (dur == 0) dur = 10;
    }

    String res = applyLedCommand(color, dur);
    if (mqttClient.connected()) {
        mqttClient.publish(MQTT_TOPIC_ACK, res.c_str());
    }
    server.send(200, "application/json", res);
}

void measureLatency() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (WiFi.SSID() != "RandeLab") { g_gwPingMs = 8; g_netPingMs = 15; return; }

    // 1. Local Router / Gateway Ping (TCP handshake to gateway port 80 or 53)
    {
        WiFiClient gwClient;
        gwClient.setTimeout(500);
        uint32_t t0 = millis();
        if (gwClient.connect(WiFi.gatewayIP(), 80) || gwClient.connect(WiFi.gatewayIP(), 53)) {
            g_gwPingMs = millis() - t0;
            gwClient.stop();
        } else {
            uint32_t elapsed = millis() - t0;
            if (elapsed < 450) g_gwPingMs = elapsed;
        }
    }

    // 2. Internet Ping to Cloudflare DNS (1.1.1.1:53)
    {
        WiFiClient pingClient;
        pingClient.setTimeout(2000);
        uint32_t t0 = millis();
        if (pingClient.connect(IPAddress(1, 1, 1, 1), 53)) {
            g_netPingMs = millis() - t0;
            pingClient.stop();
        }
    }

    // 3. DNS Timing
    {
        IPAddress cfIp;
        uint32_t dnsStart = millis();
        if (WiFi.hostByName("one.one.one.one", cfIp)) {
            g_dnsMs = millis() - dnsStart;
        }
    }
}

// ==================== METEOSWISS / OPEN-METEO WEATHER CLIENT ====================
void fetchMeteoSwissWeather(bool force) {
    if (WiFi.status() != WL_CONNECTED) return;
    uint32_t now = millis();
    if (!force && g_wxHasData && (now - g_lastWxFetchMs < 600000)) {
        return; // 10 minutes cache
    }

    WiFiClientSecure wxClient;
    wxClient.setInsecure();
    wxClient.setTimeout(4500);

    HTTPClient wxHttp;
    // High-resolution MeteoSwiss ICON-CH model data for Merishausen / Randen (47.7701° N, 8.5738° E, ~857m)
    String wxUrl = "https://api.open-meteo.com/v1/forecast?latitude=47.7701&longitude=8.5738&elevation=857&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_gusts_10m,shortwave_radiation&timezone=Europe%2FZurich";
    
    if (wxHttp.begin(wxClient, wxUrl)) {
        int code = wxHttp.GET();
        if (code == HTTP_CODE_OK) {
            String payload = wxHttp.getString();
            auto getJsonVal = [](const String& src, const char* key) -> String {
                int curIdx = src.indexOf("\"current\":");
                if (curIdx < 0) curIdx = 0;
                int k = src.indexOf(key, curIdx);
                if (k < 0) return "--";
                int c = src.indexOf(':', k);
                if (c < 0) return "--";
                int end = src.indexOf(',', c);
                int endB = src.indexOf('}', c);
                if (end < 0 || (endB > 0 && endB < end)) end = endB;
                if (end < 0) return "--";
                String v = src.substring(c + 1, end);
                v.trim();
                v.replace("\"", "");
                return v;
            };

            String t = getJsonVal(payload, "\"temperature_2m\"");
            String rh = getJsonVal(payload, "\"relative_humidity_2m\"");
            String pr = getJsonVal(payload, "\"precipitation\"");
            String cc = getJsonVal(payload, "\"cloud_cover\"");
            String sp = getJsonVal(payload, "\"surface_pressure\"");
            String ws = getJsonVal(payload, "\"wind_speed_10m\"");
            String rad = getJsonVal(payload, "\"shortwave_radiation\"");

            if (t != "--") {
                g_wxTemp = t.toFloat();
                g_wxHumidity = rh.toInt();
                g_wxRainMm = pr.toFloat();
                g_wxCloudPct = cc.toInt();
                g_wxPressure = sp.toFloat();
                g_wxWindKmh = ws.toFloat();
                g_wxSolarWm2 = rad.toFloat();
                g_wxHasData = true;
                g_lastWxFetchMs = now;
                setLcdActivity("METEO OK", TFT_CYAN);
                Serial.printf("[Weather 🌤️] Randen: %.1f°C | %d%% Cloud | %.1f mm Rain | %.0f W/m² Solar | %.1f hPa\n",
                    g_wxTemp, g_wxCloudPct, g_wxRainMm, g_wxSolarWm2, g_wxPressure);
            }
        } else {
            Serial.printf("[Weather ⚠️] Fetch failed (HTTP %d): %s\n", code, wxHttp.errorToString(code).c_str());
        }
        wxHttp.end();
    }
}

// ==================== TELTONIKA TRB500 5G GATEWAY CLIENT (ubus JSON-RPC) ====================
void fetchTeltonika5GMetrics(bool force) {
    if (WiFi.status() != WL_CONNECTED) return;
    if (WiFi.SSID() != "RandeLab") return; // Prevent 3.5s blocking when away from mountain
    uint32_t now = millis();
    bool testInProgress = (g_cellSpeedState.length() > 0 && g_cellSpeedState != "FINISHED");
    uint32_t cacheTimeout = testInProgress ? 5000 : 60000;
    if (!force && g_cellHasData && (now - g_lastCellFetchMs < cacheTimeout)) {
        return; // 60s cache normally, 5s during speedtest
    }

    WiFiClient client;
    client.setTimeout(3500);
    HTTPClient http;

    // 1. Authenticate with ubus session if token is empty or expired (tokens last 300s)
    if (g_ubusToken.length() == 0 || now > g_ubusTokenExpires) {
        if (http.begin(client, "http://192.168.2.1/ubus")) {
            http.addHeader("Content-Type", "application/json");
            const char* loginJson = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"call\",\"params\":[\"00000000000000000000000000000000\",\"session\",\"login\",{\"username\":\"admin\",\"password\":\"Transist0r!\"}]}";
            int code = http.POST(loginJson);
            if (code == HTTP_CODE_OK) {
                String resp = http.getString();
                int idx = resp.indexOf("\"ubus_rpc_session\":\"");
                if (idx > 0) {
                    idx += 20;
                    int endIdx = resp.indexOf('\"', idx);
                    if (endIdx > idx) {
                        g_ubusToken = resp.substring(idx, endIdx);
                        g_ubusTokenExpires = now + 240000; // Cache for 4 minutes
                    }
                }
            }
            http.end();
        }
    }

    if (g_ubusToken.length() == 0) return;

    // 2. Query gsm.modem0 -> info
    if (http.begin(client, "http://192.168.2.1/ubus")) {
        http.addHeader("Content-Type", "application/json");
        String req = "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"call\",\"params\":[\"" + g_ubusToken + "\",\"gsm.modem0\",\"info\",{}]}";
        int code = http.POST(req);
        if (code == HTTP_CODE_OK) {
            String payload = http.getString();

            if (payload.indexOf("Access denied") >= 0 || payload.indexOf("Permission denied") >= 0) {
                g_ubusToken = ""; // Clear expired token to re-login next cycle
                http.end();
                return;
            }

            auto getJsonStr = [](const String& src, const char* key) -> String {
                int k = src.indexOf(key);
                if (k < 0) return "";
                int c = src.indexOf(':', k);
                if (c < 0) return "";
                int end = src.indexOf(',', c);
                int endB = src.indexOf('}', c);
                if (end < 0 || (endB > 0 && endB < end)) end = endB;
                if (end < 0) return "";
                String v = src.substring(c + 1, end);
                v.trim();
                v.replace("\"", "");
                return v;
            };

            String rsrp = getJsonStr(payload, "\"rsrp_value\"");
            String sinr = getJsonStr(payload, "\"sinr_value\"");
            String rsrq = getJsonStr(payload, "\"rsrq_value\"");
            String qual = getJsonStr(payload, "\"signal_quality_value\"");
            String mode = getJsonStr(payload, "\"net_mode_str\"");
            String band = getJsonStr(payload, "\"band_str\"");
            String prov = getJsonStr(payload, "\"provider_name\"");
            String ci   = getJsonStr(payload, "\"reg_ci\"");
            String temp = getJsonStr(payload, "\"temperature\"");

            if (rsrp.length() > 0) g_cellRsrp = rsrp.toInt();
            if (sinr.length() > 0) g_cellSinr = sinr.toInt();
            if (rsrq.length() > 0) g_cellRsrq = rsrq.toInt();
            if (qual.length() > 0) g_cellQual = qual.toInt();
            if (mode.length() > 0) g_cellMode = mode;
            if (prov.length() > 0) g_cellOperator = prov;
            if (ci.length() > 0)   g_cellId = ci;
            if (temp.length() > 0) g_cellTemp = temp.toFloat() / 10.0f;

            if (payload.indexOf("\"5G N1\"") > 0) {
                g_cellBand = (band.length() > 0 ? band + " + 5G N1" : "5G N1");
            } else if (band.length() > 0) {
                g_cellBand = band;
            }

            g_cellHasData = true;
            g_lastCellFetchMs = now;
            setLcdActivity("5G UBUS", TFT_GREEN);
            Serial.printf("[TRB500 📡] 5G: %s %s (%s) | RSRP: %d dBm | SINR: %d dB | Qual: %d%% | Cell: %s | Temp: %.1f°C\n",
                g_cellOperator.c_str(), g_cellMode.c_str(), g_cellBand.c_str(),
                g_cellRsrp, g_cellSinr, g_cellQual, g_cellId.c_str(), g_cellTemp);
        } else {
            Serial.printf("[TRB500 ⚠️] Fetch failed (HTTP %d)\n", code);
        }
        http.end();
    }

    // 3. Read real router speedtest results from /tmp/speedtest.json
    if (http.begin(client, "http://192.168.2.1/ubus")) {
        http.addHeader("Content-Type", "application/json");
        String stReq = "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"call\",\"params\":[\"" + g_ubusToken + "\",\"file\",\"read\",{\"path\":\"/tmp/speedtest.json\"}]}";
        int code = http.POST(stReq);
        if (code == HTTP_CODE_OK) {
            String stResp = http.getString();
            auto getVal = [](const String& src, const char* key) -> String {
                int k = src.indexOf(key);
                if (k < 0) return "";
                int c = src.indexOf(':', k);
                if (c < 0) return "";
                int end = src.indexOf(',', c);
                int endB = src.indexOf('}', c);
                if (end < 0 || (endB > 0 && endB < end)) end = endB;
                if (end < 0) return "";
                String v = src.substring(c + 1, end);
                v.trim();
                v.replace("\"", "");
                v.replace("\\", "");
                return v;
            };
            String dl = getVal(stResp, "avgDownloadSpeed");
            String ul = getVal(stResp, "avgUploadSpeed");
            String st = getVal(stResp, "state");
            static float lastReadDl = 0.0f;
            static float lastReadUl = 0.0f;
            if (dl.length() > 0 && dl != "0") g_cellDownMbps = (dl.toFloat() * 8.0f) / 1000000.0f;
            if (ul.length() > 0 && ul != "0") g_cellUpMbps = (ul.toFloat() * 8.0f) / 1000000.0f;
            if (st.length() > 0) g_cellSpeedState = st;
            if (g_cellDownMbps > 0.0f) {
                if (g_cellDownMbps != lastReadDl || g_cellUpMbps != lastReadUl || g_lastSpeedtestEpoch == 0) {
                    lastReadDl = g_cellDownMbps;
                    lastReadUl = g_cellUpMbps;
                    time_t cur = time(nullptr);
                    if (cur > 1700000000) {
                        g_lastSpeedtestEpoch = (uint32_t)cur;
                    }
                }
                Serial.printf("[TRB500 🚀] Router 5G Speedtest: ⬇️ %.2f Mbit/s | ⬆️ %.2f Mbit/s (%s) | Epoch: %lu\n",
                    g_cellDownMbps, g_cellUpMbps, g_cellSpeedState.c_str(), (unsigned long)g_lastSpeedtestEpoch);
            }
        }
        http.end();
    }
}

// Trigger an Ookla Speedtest directly on the Teltonika TRB500 Router
bool triggerRouterSpeedtest() {
    if (WiFi.status() != WL_CONNECTED) return false;
    fetchTeltonika5GMetrics(true);
    if (g_ubusToken.length() == 0) return false;

    WiFiClient client;
    client.setTimeout(3500);
    HTTPClient http;
    bool ok = false;
    if (http.begin(client, "http://192.168.2.1/ubus")) {
        http.addHeader("Content-Type", "application/json");
        String runReq = "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"call\",\"params\":[\"" + g_ubusToken + "\",\"speedtest\",\"run\",{}]}";
        int code = http.POST(runReq);
        if (code == HTTP_CODE_OK) {
            g_cellSpeedState = "TESTING_DOWNLOAD";
            ok = true;
            Serial.println("[TRB500 🚀] Native Ookla speedtest triggered on router!");
        }
        http.end();
    }
    return ok;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg;
    for (unsigned int i = 0; i < length; i++) {
        msg += (char)payload[i];
    }
    Serial.printf("[MQTT RX] %s: %s\n", topic, msg.c_str());
    String t = String(topic);

    if (t == MQTT_TOPIC_WIFI_CMD || t == MQTT_TOPIC_CMD) {
        if (msg.indexOf("scan") >= 0) {
            triggerWifiScanAndPublish();
            return;
        }

        if (msg.indexOf("speedtest") >= 0 || msg.indexOf("speed") >= 0) {
            triggerRouterSpeedtest();
            measureLatency();
            fetchTeltonika5GMetrics(true);
            mqttClient.publish(MQTT_TOPIC_ACK, "{\"status\":\"ok\",\"action\":\"speedtest_triggered\"}");
            Serial.println("[MQTT 🚀] Remote speedtest triggered via MQTT command!");
            return;
        }

        // 12V LED Strip / Relay 2 NC commands
        if (msg.indexOf("strip_pulse") >= 0 || msg.indexOf("pulse_strip") >= 0) {
            triggerStripPulse(3);
            mqttClient.publish(MQTT_TOPIC_ACK, "{\"status\":\"ok\",\"action\":\"strip_pulse\",\"led_strip\":true}");
            Serial.println("[MQTT 🛸] 12V LED Strip pulse triggered via MQTT!");
            return;
        }

        if (msg.indexOf("strip") >= 0 || msg.indexOf("ledstrip") >= 0 || msg.indexOf("relay2") >= 0 ||
            msg.indexOf("\"relay\":2") >= 0 || msg.indexOf("\"relay\": 2") >= 0) {
            bool turnOn = (msg.indexOf("on") >= 0 || msg.indexOf("1") >= 0 || msg.indexOf("true") >= 0);
            if (msg.indexOf("toggle") >= 0) turnOn = !g_led_strip_on;
            setLedStrip(turnOn);
            char ack[140];
            snprintf(ack, sizeof(ack), "{\"status\":\"ok\",\"action\":\"strip\",\"relay\":2,\"led_strip\":%s}", turnOn ? "true" : "false");
            mqttClient.publish(MQTT_TOPIC_ACK, ack);
            Serial.printf("[MQTT 💡] 12V LED Strip commanded via MQTT: %s\n", turnOn ? "ON" : "OFF");
            return;
        }

        // Inverter / Relay 1 NO commands
        if (msg.indexOf("inverter") >= 0 || msg.indexOf("relay1") >= 0 ||
            msg.indexOf("\"relay\":1") >= 0 || msg.indexOf("\"relay\": 1") >= 0 ||
            (msg.indexOf("relay") >= 0 && msg.indexOf("strip") < 0)) {
            bool turnOn = (msg.indexOf("on") >= 0 || msg.indexOf("1") >= 0 || msg.indexOf("true") >= 0);
            if (msg.indexOf("toggle") >= 0) turnOn = !g_relay1_inverter;
            setPlcRelay(0, turnOn);
            char ack[140];
            snprintf(ack, sizeof(ack), "{\"status\":\"ok\",\"action\":\"inverter\",\"relay\":1,\"inverter_on\":%s}", turnOn ? "true" : "false");
            mqttClient.publish(MQTT_TOPIC_ACK, ack);
            Serial.printf("[MQTT ⚡] Inverter relay commanded via MQTT: %s\n", turnOn ? "ON" : "OFF");
            return;
        }

        // Remote LED Command Handler
        String ack = applyLedCommand(msg, 8);
        mqttClient.publish(MQTT_TOPIC_ACK, ack.c_str());
    }
}

// Reconnect MQTT (non-blocking)
void reconnectMQTT() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (mqttClient.connected()) return;

    static unsigned long lastAttempt = 0;
    if (millis() - lastAttempt > 15000) {
        lastAttempt = millis();
        String clientId = "RandeSolar-ESP32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
        Serial.printf("[MQTT] Connecting to %s:%d...\n", MQTT_BROKER, MQTT_PORT);
        if (mqttClient.connect(clientId.c_str())) {
            Serial.println("[MQTT] Connected to HiveMQ Broker!");
            mqttClient.subscribe(MQTT_TOPIC_WIFI_CMD);
            mqttClient.subscribe(MQTT_TOPIC_CMD);
            triggerWifiScanAndPublish();
        } else {
            Serial.printf("[MQTT] Connect failed, rc=%d\n", mqttClient.state());
        }
    }
}

void updateNeoPixel() {
    uint32_t now = millis();

    // 0. Remote MQTT LED Override (8 seconds priority)
    if (now < g_ledOverrideUntilMs) {
        if (g_ledOverrideStrobe) {
            uint8_t step = (now / 70) % 6;
            switch (step) {
                case 0: setPixel(255, 0, 0); break;     // Red
                case 1: setPixel(0, 255, 0); break;     // Green
                case 2: setPixel(0, 0, 255); break;     // Blue
                case 3: setPixel(255, 220, 0); break;   // Yellow
                case 4: setPixel(255, 0, 220); break;   // Magenta
                default: setPixel(0, 0, 0); break;      // Off
            }
        } else {
            setPixel(g_ledOverrideR, g_ledOverrideG, g_ledOverrideB);
        }
        return;
    }

    // Subtle 40ms heartbeat wink when an MQTT packet is transmitted (every 5s)
    if (now - g_lastTxFlashMs < 40) {
        setPixel(0, 40, 40); // Soft Cyan TX pip
        return;
    }

    if (WiFi.status() != WL_CONNECTED) {
        // Calm solid dim red when Wi-Fi offline or connecting
        setPixel(10, 0, 0);
        return;
    }

    SolarData d;
    portENTER_CRITICAL(&g_mux);
    d = g_data;
    portEXIT_CRITICAL(&g_mux);

    if (!d.has_data || (now - d.last_seen_ms > 15000)) {
        // Calm solid dim amber when searching for Victron BLE beacon
        setPixel(8, 3, 0);
        return;
    }

    // 1. Solar Producing (> 0W): Warm Solar Gold/Yellow proportional to generation wattage (calm & dim)
    if (d.solar_power > 0) {
        uint8_t pwr = constrain(d.solar_power, 1, 75);
        uint8_t bright = map(pwr, 1, 75, 6, 25);
        setPixel(bright, (uint8_t)(bright * 0.72f), 0);
        return;
    }

    // 2. Battery / Charge State colors (calm, solid, non-jarring)
    switch (d.charge_state) {
        case 3: // Bulk charging -> Soft Violet/Purple
            setPixel(10, 2, 16);
            break;
        case 4: // Absorption -> Soft Cyan
            setPixel(0, 12, 16);
            break;
        case 5: // Float -> Soft Emerald Green
            setPixel(0, 16, 5);
            break;
        default: // Standby / Night / Off -> Soft, subtle deep Teal glow
            setPixel(0, 4, 8);
            break;
    }
}

// ==================== TELEGRAM BOT CLIENT ====================
void sendTelegramMessage(const String& text, const char* targetChatId = TELEGRAM_CHAT_ID);

String escapeJsonString(const String& s) {
    String out = "";
    out.reserve(s.length() + 32);
    for (size_t i = 0; i < s.length(); i++) {
        char c = s[i];
        if (c == '"') out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') continue;
        else out += c;
    }
    return out;
}

// ==================== SUPABASE CLOUD LOGGER ====================
void logToSupabase(const SolarData& d) {
    if (!d.has_data) return;

    if (WiFi.status() != WL_CONNECTED) {
        // Wi-Fi / Router is offline! Store directly into flash buffer
        storeOfflineRecord(d);
        return;
    }

    WiFiClientSecure secClient;
    secClient.setInsecure();
    secClient.setTimeout(4500);

    HTTPClient http;
    if (http.begin(secClient, SUPABASE_URL)) {
        http.addHeader("Content-Type", "application/json");
        http.addHeader("apikey", SUPABASE_KEY);
        String authHeader = "Bearer " + String(SUPABASE_KEY);
        http.addHeader("Authorization", authHeader.c_str());
        http.addHeader("Prefer", "return=minimal");

        char json[700];
        if (g_wxHasData) {
            snprintf(json, sizeof(json),
                "{\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
                "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
                "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,"
                "\"net_mbps\":%.2f,\"net_up_mbps\":%.2f,\"net_ping_ms\":%u,\"gw_ping_ms\":%u,\"chip_temp\":%.1f,"
                "\"wx_temp\":%.1f,\"wx_solar_wm2\":%.1f,\"wx_cloud_pct\":%d,\"wx_rain_mm\":%.2f,"
                "\"wx_wind_kmh\":%.1f,\"wx_humidity\":%d,\"wx_pressure\":%.1f}",
                d.solar_power,
                d.battery_voltage,
                d.battery_current,
                (unsigned long)d.yield_today_wh,
                d.external_load,
                d.charge_state,
                getChargeStateName(d.charge_state),
                d.charger_error,
                d.rssi,
                WiFi.RSSI(),
                g_cellDownMbps,
                g_cellUpMbps,
                (unsigned int)g_netPingMs,
                (unsigned int)g_gwPingMs,
                temperatureRead(),
                g_wxTemp,
                g_wxSolarWm2,
                g_wxCloudPct,
                g_wxRainMm,
                g_wxWindKmh,
                g_wxHumidity,
                g_wxPressure
            );
        } else {
            snprintf(json, sizeof(json),
                "{\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
                "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
                "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,"
                "\"net_mbps\":%.2f,\"net_up_mbps\":%.2f,\"net_ping_ms\":%u,\"gw_ping_ms\":%u,\"chip_temp\":%.1f}",
                d.solar_power,
                d.battery_voltage,
                d.battery_current,
                (unsigned int)d.yield_today_wh,
                d.external_load,
                d.charge_state,
                getChargeStateName(d.charge_state),
                d.charger_error,
                d.rssi,
                WiFi.RSSI(),
                g_cellDownMbps,
                g_cellUpMbps,
                (unsigned int)g_netPingMs,
                (unsigned int)g_gwPingMs,
                temperatureRead()
            );
        }

        int code = http.POST((uint8_t*)json, strlen(json));
        if (code == 200 || code == 201) {
            setLcdActivity("CLOUD OK", TFT_CYAN);
            Serial.printf("[Supabase 💾] Logged row to cloud: %.2fV | %uW | %.1fA\n", d.battery_voltage, d.solar_power, d.battery_current);
        } else {
            setLcdActivity("CLOUD FAIL", TFT_RED);
            Serial.printf("[Supabase ⚠️] Insert failed (HTTP %d): %s\n", code, http.errorToString(code).c_str());
            // Router Wi-Fi is connected, but 5G cellular uplink is down: buffer to flash!
            storeOfflineRecord(d);
        }
        http.end();
    } else {
        Serial.println("[Supabase ⚠️] Connection failed (DNS or cellular offline). Buffering to flash...");
        storeOfflineRecord(d);
    }
}

// ==================== DAILY EVENING REPORT (20:00) ====================
void checkDailyEveningReport(const SolarData& d) {
    if (WiFi.status() != WL_CONNECTED || !d.has_data) return;

    time_t nowTime = time(nullptr);
    struct tm timeinfo;
    if (!localtime_r(&nowTime, &timeinfo)) return;
    if (timeinfo.tm_year < (2024 - 1900)) return; // NTP not synced yet

    // Reset daily counters at midnight
    if (g_currentMday != timeinfo.tm_mday) {
        g_currentMday = timeinfo.tm_mday;
        g_peakPowerToday = d.solar_power;
        g_minBattToday = d.battery_voltage;
        g_maxBattToday = d.battery_voltage;
    }

    // Trigger daily summary at 20:00 (8:00 PM) once per day
    if (timeinfo.tm_hour == 20 && g_lastReportDay != timeinfo.tm_mday) {
        g_lastReportDay = timeinfo.tm_mday;

        char report[500];
        float yieldKwh = d.yield_today_wh / 1000.0f;
        float minV = (g_minBattToday > 50.0f ? d.battery_voltage : g_minBattToday);
        float maxV = (g_maxBattToday < 5.0f ? d.battery_voltage : g_maxBattToday);

        snprintf(report, sizeof(report),
            "📊 *RandeSolar Tagesbericht* ☀️\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "⚡ *Tagesertrag:* %.2f kWh (%lu Wh)\n"
            "🏆 *Spitzenleistung:* %u W\n"
            "🔋 *Batterie Min / Max:* %.2f V / %.2f V\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "🌐 _Dashboard:_ https://randelab.github.io/RandeSolar/",
            yieldKwh,
            (unsigned long)d.yield_today_wh,
            g_peakPowerToday,
            minV,
            maxV
        );
        sendTelegramMessage(report);
        Serial.println("[Scheduler ⏰] 20:00 Evening Telegram report delivered to Marc!");
    }
}

void sendTelegramMessage(const String& text, const char* targetChatId) {
    if (WiFi.status() != WL_CONNECTED) return;

    WiFiClientSecure secClient;
    secClient.setInsecure();
    secClient.setTimeout(4500);

    HTTPClient http;
    String url = "https://api.telegram.org/bot" + String(TELEGRAM_BOT_TOKEN) + "/sendMessage";
    if (http.begin(secClient, url)) {
        http.addHeader("Content-Type", "application/json");
        String payload = "{\"chat_id\":\"" + String(targetChatId) + "\",\"text\":\"" + escapeJsonString(text) + "\",\"parse_mode\":\"Markdown\"}";
        int code = http.POST(payload);
        if (code > 0) {
            Serial.printf("[Telegram ✈️] Message delivered (HTTP %d)\n", code);
        } else {
            Serial.printf("[Telegram ❌] Send failed: %s\n", http.errorToString(code).c_str());
        }
        http.end();
    }
}

String generateHumanMoodReport(const SolarData& d) {
    if (!d.has_data) {
        return "🤖 *Ich fühle mich noch etwas einsam...* 📡\nIch suche gerade im Äther nach dem Bluetooth-Signal meines Victron MPPT 75|15. Sobald die ersten Funkpakete eintreffen, erzähle ich dir, wie es mir geht!";
    }

    float v = d.battery_voltage;
    uint16_t w = d.solar_power;
    float kwh = d.yield_today_wh / 1000.0f;
    float a = d.battery_current;
    float load = d.external_load;

    String story = "🤖 *RandeSolar Tagebuch • Wie ich mich fühle* 💬\n━━━━━━━━━━━━━━━━━━━━\n";

    if (w == 0) {
        // Night / Evening / Dark
        if (v >= 12.45f) {
            story += "🌙 *Entspannter Feierabend!*\n";
            story += "Hier im RandeLab ist es mucksmäuschenstill und meine Solarzellen schlafen tief und fest (0 W). ";
            story += "Mein 12V-Akkumulator fühlt sich mit gemächlichen *" + String(v, 2) + " V* pudelwohl – kein Stress, keine Hektik. ";
            if (kwh > 0.05f) {
                story += "Heute durfte ich insgesamt *" + String(kwh, 2) + " kWh* Sonnenlicht einsammeln. ";
            }
            story += "Meine Platine kühlt ab und ich träume friedlich von den ersten Photonen der Morgensonne. 😴✨";
        } else {
            story += "🥱 *Puh, ganz schön geschlaucht...*\n";
            story += "Es ist stockdunkel (0 W) und meine Batterie hat heute einiges einstecken müssen – steht gerade bei *" + String(v, 2) + " V*. ";
            story += "Meine Kondensatoren sehnen sich nach neuer Energie. Lass mich etwas verschnaufen, morgen früh gibt's hoffentlich wieder Sonne! 🔋";
        }
    } else if (w >= 30) {
        // High Solar Power
        story += "☀️🔥 *Mir ist herrlich warm!*\n";
        story += "Die Sonne knallt gerade mit satten *" + String(w) + " Watt* auf mein Panel! ";
        story += "Mein Victron MPPT jagt den maximalen Arbeitspunkt und schaufelt fleissig *" + String(a, 1) + " A* pure Naturkraft in den Akku (*" + String(v, 2) + " V*). ";
        story += "Heute haben wir schon *" + String(kwh, 2) + " kWh* im Kasten. So macht das mechatronische Leben Spass! 😎⚡";
    } else {
        // Moderate / Cloudy
        story += "⛅ *Gemütliches Schaffen im Halbschatten*\n";
        story += "Ein paar schüchterne Sonnenstrahlen schaffen es durch die Wolkendecke – gerade ernte ich *" + String(w) + " Watt*. ";
        story += "Aber Kleinvieh macht auch Mist: Bei *" + String(v, 2) + " V* nuckelt die Batterie entspannt an *" + String(a, 1) + " A*. ";
        story += "Tagesausbeute bisher: *" + String(kwh, 2) + " kWh*. Ich bleibe wachsam am Netz! 🧐";
    }

    if (d.charge_state == 5) {
        story += "\n\n🔋 *Status:* Der Speicher ist randvoll (Float, 100%)! Ich chille im grünen NeoPixel-Licht.";
    } else if (d.charge_state == 4) {
        int s = estimateBatterySoC(v, a, load, d.charge_state);
        story += "\n\n🔋 *Status:* Nachladephase (Absorption, ~" + String(s) + "%). Die letzten Elektronen werden schonend aufgenommen.";
    } else if (d.charge_state == 3 || a > 0.4f) {
        int s = estimateBatterySoC(v, a, load, d.charge_state);
        story += "\n\n🔋 *Status:* Hauptladung aktiv (Bulk, ~" + String(s) + "%). Mein Akku schluckt hungrig puren Sonnenstrom!";
    }

    if (load > 0.1f) {
        story += "\n💡 *Übrigens:* Am Lastanschluss saugt gerade jemand *" + String(load, 1) + " A* ab – schön, dass der Strom fliesst!";
    }

    story += "\n🌡️ *Silizium-Temperatur:* " + String(temperatureRead(), 1) + " °C";
    story += "\n━━━━━━━━━━━━━━━━━━━━\n📍 _Direkt aus dem ESP32-S3 Silizium-Gehirn_";
    return story;
}

void checkTelegramUpdates() {
    if (WiFi.status() != WL_CONNECTED) return;

    WiFiClientSecure secClient;
    secClient.setInsecure();
    secClient.setTimeout(1200);

    HTTPClient http;
    String url = "https://api.telegram.org/bot" + String(TELEGRAM_BOT_TOKEN) + 
                 "/getUpdates?offset=" + String((long long)(g_lastTelegramUpdateId + 1)) + 
                 "&limit=5&timeout=0";

    if (http.begin(secClient, url)) {
        int code = http.GET();
        if (code == 200) {
            String response = http.getString();
            
            int idx = 0;
            while ((idx = response.indexOf("\"update_id\":", idx)) != -1) {
                int startId = idx + 12;
                int endId = response.indexOf(",", startId);
                if (endId != -1) {
                    int64_t uid = atoll(response.substring(startId, endId).c_str());
                    if (uid > g_lastTelegramUpdateId) g_lastTelegramUpdateId = uid;
                }
                
                int chatIdx = response.indexOf("\"chat\":{\"id\":", idx);
                String fromChatId = TELEGRAM_CHAT_ID;
                if (chatIdx != -1) {
                    int chatStart = chatIdx + 13;
                    int chatEnd = response.indexOf(",", chatStart);
                    if (chatEnd != -1) {
                        fromChatId = response.substring(chatStart, chatEnd);
                    }
                }

                int textIdx = response.indexOf("\"text\":\"", idx);
                if (textIdx != -1) {
                    int textStart = textIdx + 8;
                    int textEnd = response.indexOf("\"", textStart);
                    if (textEnd != -1) {
                        String cmd = response.substring(textStart, textEnd);
                        cmd.toLowerCase();
                        
                        if (cmd.startsWith("/status")) {
                            SolarData d;
                            portENTER_CRITICAL(&g_mux);
                            d = g_data;
                            portEXIT_CRITICAL(&g_mux);

                            char msg[860];
                            int soc = estimateBatterySoC(d.battery_voltage, d.battery_current, d.external_load, d.charge_state);
                            const char* socStage = (d.charge_state == 5) ? "Float" : (d.charge_state == 4) ? "Absorp." : (d.charge_state == 3 || d.battery_current > 0.4f) ? "Bulk" : "Ruhe";
                            unsigned long ageSec = d.has_data ? ((millis() - d.last_seen_ms) / 1000) : 999;
                            float minV = (g_minBattToday > 50.0f ? d.battery_voltage : g_minBattToday);
                            float maxV = (g_maxBattToday < 5.0f ? d.battery_voltage : g_maxBattToday);
                            float chipTemp = temperatureRead();
                            int wifiRssi = WiFi.RSSI();
                            int wifiQual = constrain(2 * (wifiRssi + 100), 0, 100);

                            char pwrLine[64];
                            if (d.panel_voltage > 1.0f) {
                                snprintf(pwrLine, sizeof(pwrLine), "%u W (%.1f V | Peak: %u W)", d.solar_power, d.panel_voltage, g_peakPowerToday);
                            } else {
                                snprintf(pwrLine, sizeof(pwrLine), "%u W (Peak: %u W)", d.solar_power, g_peakPowerToday);
                            }

                            snprintf(msg, sizeof(msg),
                                "☀️ *RandeSolar Kraftwerk Status* ⚡\n"
                                "━━━━━━━━━━━━━━━━━━━━\n"
                                "☀️ *Solar-Leistung:* %s\n"
                                "🔋 *Batteriespeicher:* %.2f V (~%d%% • %s)\n"
                                "📉 *Batterie Min / Max:* %.2f V / %.2f V\n"
                                "⚡ *Ladestrom:* %.1f A\n"
                                "💡 *Lastanschluß:* %.1f A\n"
                                "📊 *Tagesertrag:* %.2f kWh\n"
                                "🏷️ *Zustand:* %s (%s)\n"
                                "━━━━━━━━━━━━━━━━━━━━\n"
                                "🌐 *5G-Speed:* ⬇️ %.2f Mbit/s | ⬆️ %.2f Mbit/s\n"
                                "📡 *Mobilfunk:* %d dBm (SINR: %d dB • %s)\n"
                                "🏓 *Latenz:* %u ms (Router: %u ms)\n"
                                "📶 *WLAN:* %d dBm (%d%%, Ch %d)\n"
                                "🌡️ *ESP32:* %.1f °C (%u KB frei)\n"
                                "⏱️ *Letzter Empfang:* vor %lu Sek.\n"
                                "━━━━━━━━━━━━━━━━━━━━\n"
                                "📍 _ESP32-S3 Standalone Station_",
                                pwrLine,
                                d.battery_voltage,
                                soc,
                                socStage,
                                minV,
                                maxV,
                                d.battery_current,
                                d.external_load,
                                d.yield_today_wh / 1000.0f,
                                getChargeStateName(d.charge_state),
                                getChargeStateGerman(d.charge_state),
                                g_cellDownMbps,
                                g_cellUpMbps,
                                g_cellRsrp,
                                g_cellSinr,
                                g_cellBand.c_str(),
                                (unsigned int)g_netPingMs,
                                (unsigned int)g_gwPingMs,
                                wifiRssi,
                                wifiQual,
                                WiFi.channel(),
                                chipTemp,
                                (unsigned int)(ESP.getFreeHeap() / 1024),
                                ageSec
                            );
                            sendTelegramMessage(msg, fromChatId.c_str());
                        } else if (cmd.startsWith("/speed")) {
                            triggerRouterSpeedtest();
                            measureLatency();
                            fetchTeltonika5GMetrics(true);
                            int wifiRssi = WiFi.RSSI();
                            int wifiQual = constrain(2 * (wifiRssi + 100), 0, 100);
                            char spMsg[750];
                            if (g_cellHasData) {
                                snprintf(spMsg, sizeof(spMsg),
                                    "🚀 *RandeLab 5G Speedtest (TRB500 Ookla)* 🌐\n"
                                    "━━━━━━━━━━━━━━━━━━━━\n"
                                    "⬇️ *5G Download:* %.2f Mbit/s (TRB500 WAN)\n"
                                    "⬆️ *5G Upload:* %.2f Mbit/s\n"
                                    "🎚️ *Signal (RSRP):* %d dBm (SINR: %d dB)\n"
                                    "📶 *Bänder:* %s (%s)\n"
                                    "🏢 *Provider:* %s • Cell %s\n"
                                    "🌡️ *Router-Temp:* %.1f °C\n"
                                    "━━━━━━━━━━━━━━━━━━━━\n"
                                    "🏓 *Latenz:* %u ms (1.1.1.1) / %u ms (Router)\n"
                                    "📶 *WLAN:* %d dBm (%d%% • Ch %d)\n"
                                    "🌡️ *ESP32 Chip:* %.1f °C (%u KB frei)",
                                    g_cellDownMbps,
                                    g_cellUpMbps,
                                    g_cellRsrp, g_cellSinr,
                                    g_cellBand.c_str(), g_cellMode.c_str(),
                                    g_cellOperator.c_str(), g_cellId.c_str(),
                                    g_cellTemp,
                                    (unsigned int)g_netPingMs, (unsigned int)g_gwPingMs,
                                    wifiRssi, wifiQual, WiFi.channel(),
                                    temperatureRead(),
                                    (unsigned int)(ESP.getFreeHeap() / 1024)
                                );
                            } else {
                                snprintf(spMsg, sizeof(spMsg),
                                    "🚀 *RandeLab 5G Speed & Netzwerk-Diagnose* 🌐\n"
                                    "━━━━━━━━━━━━━━━━━━━━\n"
                                    "⬇️ *5G Download:* %.2f Mbit/s (TRB500 WAN)\n"
                                    "⬆️ *5G Upload:* %.2f Mbit/s\n"
                                    "🏓 *Internet-Ping (1.1.1.1):* %u ms\n"
                                    "🏠 *Router-Ping (%s):* %u ms\n"
                                    "🔍 *DNS Lookup:* %u ms\n"
                                    "⚡ *HTTP TTFB:* %u ms\n"
                                    "📶 *WLAN:* %d dBm (%d%% Qualität • Kanal %d)\n"
                                    "🌡️ *ESP32-S3 Chip:* %.1f °C (%u KB RAM frei)",
                                    g_cellDownMbps,
                                    g_cellUpMbps,
                                    (unsigned int)g_netPingMs,
                                    WiFi.gatewayIP().toString().c_str(),
                                    (unsigned int)g_gwPingMs,
                                    (unsigned int)g_dnsMs,
                                    (unsigned int)g_ttfbMs,
                                    wifiRssi,
                                    wifiQual,
                                    WiFi.channel(),
                                    temperatureRead(),
                                    (unsigned int)(ESP.getFreeHeap() / 1024)
                                );
                            }
                            sendTelegramMessage(spMsg, fromChatId.c_str());
                        } else if (cmd.startsWith("/mood") || cmd.startsWith("/feel") || cmd.startsWith("/wiegehts") || cmd.startsWith("/story") || cmd.startsWith("/tagebuch")) {
                            SolarData d;
                            portENTER_CRITICAL(&g_mux);
                            d = g_data;
                            portEXIT_CRITICAL(&g_mux);

                            String moodMsg = generateHumanMoodReport(d);
                            sendTelegramMessage(moodMsg, fromChatId.c_str());
                        } else if (cmd.startsWith("/weather") || cmd.startsWith("/wetter") || cmd.startsWith("/climate")) {
                            fetchMeteoSwissWeather(true);
                            if (g_wxHasData) {
                                char wxMsg[550];
                                snprintf(wxMsg, sizeof(wxMsg),
                                    "🌤️ *Mikroklima RandeLab (Ätzisloo 189)* 📍\n"
                                    "━━━━━━━━━━━━━━━━━━━━\n"
                                    "🌡️ *Aussentemperatur:* %.1f °C\n"
                                    "☀️ *Solare Einstrahlung:* %.0f W/m²\n"
                                    "🌫️ *Bewölkung / Hochnebel:* %d %%\n"
                                    "💧 *Luftfeuchtigkeit:* %d %%\n"
                                    "🌧️ *Niederschlag:* %.2f mm\n"
                                    "💨 *Wind:* %.1f km/h\n"
                                    "⏲️ *Luftdruck:* %.1f hPa\n"
                                    "━━━━━━━━━━━━━━━━━━━━\n"
                                    "🏔️ _47.7701°N, 8.5738°E • ~857m ü.M. (MeteoSwiss ICON)_",
                                    g_wxTemp, g_wxSolarWm2, g_wxCloudPct, g_wxHumidity, g_wxRainMm, g_wxWindKmh, g_wxPressure
                                );
                                sendTelegramMessage(wxMsg, fromChatId.c_str());
                            } else {
                                sendTelegramMessage("⚠️ Konnte Wetterdaten von Open-Meteo gerade nicht abrufen.", fromChatId.c_str());
                            }
                        } else if (cmd.startsWith("/ping")) {
                            sendTelegramMessage("🏓 *Pong!* RandeSolar ESP32-S3 ist online und empfängt Bluetooth-Telemetrie.", fromChatId.c_str());
                        } else if (cmd.startsWith("/start") || cmd.startsWith("/help") || cmd.startsWith("/hilfe")) {
                            sendTelegramMessage(
                                "☀️ *Willkommen beim RandeSolar Bot!* ⚡\n\n"
                                "Verfügbare Befehle:\n"
                                "• /status - Technische Zahlen & Messwerte\n"
                                "• /weather - Lokales Wetter & Solarstrahlung 🌤️\n"
                                "• /mood - Wie ich mich heute fühle (Tagebuch) 💬\n"
                                "• /speed - 5G Ookla-Speedtest (TRB500 Gateway) 🚀\n"
                                "• /ping - Verbindungsstatus prüfen 🏓\n\n"
                                "🌐 Live-Dashboard: https://randelab.github.io/RandeSolar/",
                                fromChatId.c_str()
                            );
                        }
                    }
                }
                idx = response.indexOf("\"update_id\":", idx + 12);
            }
        }
        http.end();
    }
}

// ==================== STAMPLC WI-FI MENU & MANAGER ====================
static int g_selectedWifiIdx = 0;

void drawWifiMenu(int selected, int countdownSec) {
    auto& dsp = M5StamPLC.Display();
    dsp.startWrite();
    dsp.fillScreen(TFT_BLACK);

    dsp.setTextColor(TFT_CYAN, TFT_BLACK);
    dsp.setTextSize(1);
    dsp.setCursor(4, 3);
    dsp.print("WI-FI SELECTOR • RandeSolar");
    dsp.drawFastHLine(0, 14, 240, TFT_DARKGREY);

    int totalOptions = NUM_KNOWN_NETWORKS + 2; // networks + Auto-Scan + Cancel

    for (size_t i = 0; i < NUM_KNOWN_NETWORKS; i++) {
        int y = 17 + (i * 20);
        if ((int)i == selected) {
            dsp.fillRect(2, y - 2, 236, 18, TFT_NAVY);
            dsp.setTextColor(TFT_YELLOW, TFT_NAVY);
            dsp.setTextSize(2);
            dsp.setCursor(4, y);
            dsp.printf("> %s", KNOWN_NETWORKS[i].ssid);
        } else {
            dsp.setTextColor(TFT_WHITE, TFT_BLACK);
            dsp.setTextSize(2);
            dsp.setCursor(4, y);
            dsp.printf("  %s", KNOWN_NETWORKS[i].ssid);
        }
    }

    // Auto-scan option
    int autoY = 17 + (NUM_KNOWN_NETWORKS * 20);
    if (selected == (int)NUM_KNOWN_NETWORKS) {
        dsp.fillRect(2, autoY - 2, 236, 18, TFT_NAVY);
        dsp.setTextColor(TFT_YELLOW, TFT_NAVY);
        dsp.setTextSize(2);
        dsp.setCursor(4, autoY);
        dsp.print("> [AUTO-SCAN]");
    } else {
        dsp.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        dsp.setTextSize(2);
        dsp.setCursor(4, autoY);
        dsp.print("  [AUTO-SCAN]");
    }

    // Cancel option
    int cancelY = 17 + ((NUM_KNOWN_NETWORKS + 1) * 20);
    if (cancelY <= 100) {
        if (selected == (int)NUM_KNOWN_NETWORKS + 1) {
            dsp.fillRect(2, cancelY - 2, 236, 18, TFT_MAROON);
            dsp.setTextColor(TFT_WHITE, TFT_MAROON);
            dsp.setTextSize(2);
            dsp.setCursor(4, cancelY);
            dsp.print("> [CANCEL / EXIT]");
        } else {
            dsp.setTextColor(TFT_RED, TFT_BLACK);
            dsp.setTextSize(2);
            dsp.setCursor(4, cancelY);
            dsp.print("  [CANCEL / EXIT]");
        }
    }

    dsp.drawFastHLine(0, 116, 240, TFT_DARKGREY);
    dsp.setTextColor(TFT_ORANGE, TFT_BLACK);
    dsp.setTextSize(1);
    dsp.setCursor(4, 122);
    if (countdownSec >= 0) {
        dsp.printf("[A]Up [B]Select [C]Dn • Auto:%ds", countdownSec);
    } else {
        dsp.print("[A] Up    [B] Select    [C] Down");
    }

    dsp.endWrite();
}

bool connectToWifi(const char* ssid, const char* pass) {
    auto& dsp = M5StamPLC.Display();
    dsp.fillScreen(TFT_BLACK);
    dsp.setTextColor(TFT_CYAN, TFT_BLACK);
    dsp.setTextSize(1);
    dsp.setCursor(6, 16);
    dsp.print("Connecting to Wi-Fi:");
    dsp.setTextColor(TFT_YELLOW, TFT_BLACK);
    dsp.setTextSize(2);
    dsp.setCursor(6, 34);
    dsp.print(ssid);

    WiFi.disconnect(true);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, pass);

    Serial.printf("[WiFi] Connecting to '%s'", ssid);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 28) {
        delay(350);
        Serial.print(".");
        M5StamPLC.setStatusLight(0, 0, (attempts % 2) ? 60 : 10);
        dsp.fillRect(6 + (attempts * 7), 70, 5, 12, TFT_CYAN);
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        g_activeSsid = ssid;
        g_activePass = pass;
        Serial.printf("[WiFi OK] Connected to '%s'! IP: %s\n", ssid, WiFi.localIP().toString().c_str());
        M5StamPLC.setStatusLight(0, 80, 20);
        M5StamPLC.tone(1400, 80);
        dsp.setTextColor(TFT_GREEN, TFT_BLACK);
        dsp.setTextSize(1);
        dsp.setCursor(6, 95);
        dsp.printf("CONNECTED! IP: %s", WiFi.localIP().toString().c_str());
        delay(1000);
        return true;
    } else {
        Serial.printf("[WiFi FAIL] Failed to connect to '%s'\n", ssid);
        M5StamPLC.setStatusLight(80, 0, 0);
        M5StamPLC.tone(600, 150);
        dsp.setTextColor(TFT_RED, TFT_BLACK);
        dsp.setTextSize(1);
        dsp.setCursor(6, 95);
        dsp.print("FAILED! Check Password.");
        delay(1200);
        return false;
    }
}

bool autoScanAndConnect() {
    auto& dsp = M5StamPLC.Display();
    dsp.fillScreen(TFT_BLACK);
    dsp.setTextColor(TFT_CYAN, TFT_BLACK);
    dsp.setTextSize(1);
    dsp.setCursor(6, 20);
    dsp.print("Scanning Wi-Fi airwaves...");

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(100);
    int n = WiFi.scanNetworks();
    Serial.printf("[WiFi] Found %d networks in range\n", n);

    int bestMatchIdx = -1;
    int bestRssi = -999;

    for (int i = 0; i < n; i++) {
        String foundSsid = WiFi.SSID(i);
        int rssi = WiFi.RSSI(i);
        for (size_t k = 0; k < NUM_KNOWN_NETWORKS; k++) {
            if (foundSsid == KNOWN_NETWORKS[k].ssid) {
                Serial.printf("[WiFi 🎯] Matched '%s' (%s) RSSI: %d dBm\n", KNOWN_NETWORKS[k].ssid, KNOWN_NETWORKS[k].label, rssi);
                if (rssi > bestRssi) {
                    bestRssi = rssi;
                    bestMatchIdx = k;
                }
            }
        }
    }

    if (bestMatchIdx >= 0) {
        return connectToWifi(KNOWN_NETWORKS[bestMatchIdx].ssid, KNOWN_NETWORKS[bestMatchIdx].pass);
    }

    Serial.println("[WiFi ⚠️] None of known SSIDs found in scan. Trying default...");
    return connectToWifi(KNOWN_NETWORKS[0].ssid, KNOWN_NETWORKS[0].pass);
}

void promptWifiMenu(bool isBoot) {
    int totalOptions = NUM_KNOWN_NETWORKS + 2; // networks + Auto-Scan + Cancel
    int selected = NUM_KNOWN_NETWORKS; // Default: [AUTO-SCAN]
    unsigned long startMs = millis();
    int countdown = isBoot ? 4 : -1;

    drawWifiMenu(selected, countdown);

    while (true) {
        M5StamPLC.update();
        if (countdown >= 0) {
            int remaining = 4 - (int)((millis() - startMs) / 1000);
            if (remaining != countdown) {
                countdown = remaining;
                if (countdown < 0) break; // Timeout -> proceed with auto
                drawWifiMenu(selected, countdown);
            }
        }

        if (M5StamPLC.BtnA().wasClicked()) {
            selected = (selected - 1 + totalOptions) % totalOptions;
            M5StamPLC.tone(1800, 30);
            countdown = -1; // Cancel countdown on user touch
            drawWifiMenu(selected, -1);
        }
        if (M5StamPLC.BtnC().wasClicked()) {
            selected = (selected + 1) % totalOptions;
            M5StamPLC.tone(1400, 30);
            countdown = -1;
            drawWifiMenu(selected, -1);
        }
        if (M5StamPLC.BtnB().wasClicked()) {
            M5StamPLC.tone(2000, 60);
            break;
        }
        delay(15);
    }

    if (selected == (int)NUM_KNOWN_NETWORKS + 1) {
        // CANCEL selected! Return directly to dashboard!
        Serial.println("[WiFi] Wi-Fi Menu Cancelled. Resuming normal dashboard.");
        renderLcdDashboard();
        return;
    }

    if (selected < (int)NUM_KNOWN_NETWORKS) {
        connectToWifi(KNOWN_NETWORKS[selected].ssid, KNOWN_NETWORKS[selected].pass);
    } else {
        autoScanAndConnect();
    }
    renderLcdDashboard();
}

void setup() {
    Serial.begin(115200);
    delay(500);

    // Initialize M5StamPLC hardware (LCD, Relays, Inputs, Buttons, Buzzer)
    M5StamPLC.begin();
    M5StamPLC.Display().setRotation(0); // Upright (Rotated 90 deg anticlockwise from 1)
    M5StamPLC.Display().setBrightness(180);
    M5StamPLC.Display().fillScreen(TFT_BLACK);

    // Initial safe relay states (Inverter OFF by default on boot)
    M5StamPLC.writePlcRelay(0, false);
    M5StamPLC.writePlcRelay(1, false);

    // Initial soft blue startup
    setPixel(0, 10, 30);

    // Boot chime on StamPLC buzzer
    M5StamPLC.tone(523, 60); delay(70);
    M5StamPLC.tone(659, 60); delay(70);
    M5StamPLC.tone(784, 80); delay(90);
    M5StamPLC.noTone();

    // Initialize local LittleFS flash memory for offline logging
    initOfflineStorage();

    // Configure ADC1 for Solar Panel Voltage Divider
    analogSetPinAttenuation(SOLAR_ADC_PIN, ADC_11db);

    Serial.println("\n========================================");
    Serial.println("  RandeSolar StamPLC • Victron MPPT & Inverter Guard");
    Serial.printf("  MQTT Broker:   %s:%d\n", MQTT_BROKER, MQTT_PORT);
    Serial.println("========================================\n");

    // Auto-detect & connect to strongest known Wi-Fi network on boot (RandeLab, PintOfWorms, etc.)
    if (!autoScanAndConnect()) {
        Serial.println("[WiFi] Auto-connect failed, launching Wi-Fi menu...");
        promptWifiMenu(false);
    }

    // Configure MQTT
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(2048);
    mqttClient.setCallback(mqttCallback);

    // Setup Web Server
    server.on("/", handleRoot);
    server.on("/api/live", handleLiveApi);
    server.on("/api/buffer", handleBufferApi);
    server.on("/api/buffer/csv", handleBufferCsv);
    server.on("/api/speedtest", handleSpeedtestApi);
    server.on("/api/wifi/scan", handleWifiScanApi);
    server.on("/api/led", handleLedApi);
    server.on("/api/relay", handleRelayApi);
    server.on("/update", HTTP_GET, handleOtaPage);
    server.on("/update", HTTP_POST, handleOtaUploadDone, handleOtaUploadChunk);
    server.begin();
    Serial.println("[HTTP] Web Server started on port 80");

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        if (MDNS.begin(MDNS_HOST)) {
            Serial.printf("[mDNS] http://%s.local\n", MDNS_HOST);
        }
        setupOTA();
        setPixel(0, 30, 15); // Green confirmation flash
        for (int i = 0; i < 40; i++) { ArduinoOTA.handle(); server.handleClient(); delay(50); } // 2s boot OTA rescue window

        // Sync time via NTP (Europe/Zurich: UTC+1 with 1h daylight saving = UTC+2 in summer)
        configTime(3600, 3600, "pool.ntp.org", "time.google.com");
        Serial.println("[NTP] Time synchronization requested");

        // Initial Teltonika 5G Gateway fetch
        fetchTeltonika5GMetrics(true);

        // Initial Ping & Latency measurement
        measureLatency();

        // Initial Microclimate fetch from Open-Meteo
        fetchMeteoSwissWeather(true);
    } else {
        Serial.println("\n[WiFi] Connection timed out. Running offline BLE logger mode.");
        setPixel(30, 0, 0); // Red warning
    }

    // Initialize NimBLE
    NimBLEDevice::init("RandeSolar-ESP32");
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);

    NimBLEScan* pScan = NimBLEDevice::getScan();
    pScan->setScanCallbacks(&scanCallbacks, true);
    pScan->setActiveScan(false);
    pScan->setInterval(160);
    pScan->setWindow(40);

    Serial.println("[BLE] Scanner active. Listening for Victron beacons...\n");
    pScan->start(0, false);

    // Send Telegram startup message ONLY after BLE + Wi-Fi + WebServer are all running cleanly
    if (WiFi.status() == WL_CONNECTED) {
        char bootMsg[420];
        snprintf(bootMsg, sizeof(bootMsg),
            "🚀 *RandeSolar ESP32-S3 online (OTA)!* 🔌\n"
            "Verbunden mit Wi-Fi *%s* (IP: `%s`).\n"
            "🌡️ Chip: *%.1f °C* (%u KB RAM frei)\n"
            "🌐 5G Speed: ⬇️ *%.2f Mbit/s* | ⬆️ *%.2f Mbit/s*\n"
            "📡 5G Signal: *%d dBm* (SINR: *%d dB* • %s)\n"
            "🏓 Latenz: *%u ms* (Router: *%u ms*)\n"
            "Sende /status oder /speed für Live-Telemetrie.",
            WiFi.SSID().c_str(),
            WiFi.localIP().toString().c_str(),
            temperatureRead(),
            (unsigned int)(ESP.getFreeHeap() / 1024),
            g_cellDownMbps,
            g_cellUpMbps,
            g_cellRsrp,
            g_cellSinr,
            g_cellBand.c_str(),
            (unsigned int)g_netPingMs,
            (unsigned int)g_gwPingMs
        );
        sendTelegramMessage(bootMsg);
    }
}

void loop() {
    M5StamPLC.update();
    ArduinoOTA.handle();
    server.handleClient();
    reconnectMQTT();
    mqttClient.loop();

    // Button A: Context-sensitive action per active page!
    if (M5StamPLC.BtnA().wasClicked()) {
        setLcdActivity("BTN [A]", TFT_WHITE);
        if (g_lcd_page == 0 || g_lcd_page == 1) {
            // Page 0 (Coconut) & Page 1 (Solar): Toggle Inverter Relay 1
            setPlcRelay(0, !g_relay1_inverter);
            if (g_relay1_inverter) {
                M5StamPLC.tone(1800, 60);
            } else {
                M5StamPLC.tone(900, 80);
            }
        } else if (g_lcd_page == 2) {
            // Page 2: Wi-Fi Menu!
            M5StamPLC.tone(1600, 60);
            promptWifiMenu(false);
        } else if (g_lcd_page == 3) {
            // Page 3: Trigger ping latency test & 5G refresh
            M5StamPLC.tone(2000, 60);
            setLcdActivity("PING TEST", TFT_YELLOW);
            measureLatency();
            fetchTeltonika5GMetrics(true);
        } else if (g_lcd_page == 4) {
            // Page 4: Sync Weather
            M5StamPLC.tone(2200, 60);
            setLcdActivity("WX SYNC", TFT_CYAN);
            fetchMeteoSwissWeather(true);
        }
        renderLcdDashboard();
    }

    // Button B: Cleanly cycle pages across 5 screens (0=Coconut, 1..4=Details)
    if (M5StamPLC.BtnB().wasClicked()) {
        g_lcd_page = (g_lcd_page + 1) % 5;
        M5StamPLC.tone(1400, 40);
        char act[20];
        if (g_lcd_page == 0) {
            snprintf(act, sizeof(act), "COCONUT");
        } else {
            snprintf(act, sizeof(act), "PAGE %u/4", g_lcd_page);
        }
        setLcdActivity(act, TFT_CYAN);
        renderLcdDashboard();
    }

    // Button C: Toggle 12V LED Strip (on Page 0) or Dashboard Refresh (on Pages 1..4)
    if (M5StamPLC.BtnC().wasClicked()) {
        if (g_lcd_page == 0) {
            setLedStrip(!g_led_strip_on);
            if (g_led_strip_on) {
                M5StamPLC.tone(2000, 60);
            } else {
                M5StamPLC.tone(1000, 80);
            }
        } else {
            M5StamPLC.tone(2200, 50);
            setLcdActivity("REFRESH", TFT_GREEN);
        }
        renderLcdDashboard();
    }

    // 12V LED Strip Pulse Animation State Machine (safe 350ms relay switching)
    if (g_stripPulseRemaining > 0 && millis() - g_lastStripPulseMs >= 350) {
        g_lastStripPulseMs = millis();
        g_stripPulseRemaining--;
        if (g_stripPulseRemaining == 0) {
            setLedStrip(true); // Return to default lit state
        } else {
            setLedStrip(!g_led_strip_on);
        }
    }

    // Update LCD Dashboard every 1000 ms
    static uint32_t lastLcdUpdate = 0;
    if (millis() - lastLcdUpdate >= 1000) {
        lastLcdUpdate = millis();
        renderLcdDashboard();
    }

    // Inverter Sleep Guard (Undervoltage Protection):
    // If battery drops below 11.50V, automatically open Relay 1 (shut off Inverter)
    if (g_relay1_inverter && g_data.has_data && g_data.battery_voltage > 5.0f && g_data.battery_voltage < 11.50f) {
        Serial.printf("[StamPLC ⚠️] Low Battery (%.2f V < 11.50 V)! Opening Relay 1 (Inverter Safe Cutoff)...\n", g_data.battery_voltage);
        setPlcRelay(0, false);
        M5StamPLC.tone(800, 200);
    }

    // Update onboard NeoPixel state machine
    updateNeoPixel();

    uint32_t now = millis();

    // Check Telegram commands every 30 seconds (reduces TLS blocking by 90% for instant button response)
    static uint32_t lastTelegramCheck = 0;
    if (now - lastTelegramCheck >= 30000) {
        lastTelegramCheck = now;
        checkTelegramUpdates();
    }

    // Periodic Wi-Fi scan publish (every 5 minutes) so retained message stays fresh for GitHub Pages
    static uint32_t lastWifiScanPublish = 0;
    if (WiFi.SSID() == "RandeLab" && now - lastWifiScanPublish >= 300000) {
        lastWifiScanPublish = now;
        triggerWifiScanAndPublish();
    }

    // Scheduled Router 5G Speedtest every 6 hours (21,600,000 ms)
    // Conserves GoMo mobile data (~1.2 GB/month instead of ~500 GB) & solar battery
    static uint32_t lastSpeedtestTrigger = 0;
    static bool firstSpeedtestDone = false;
    if (!firstSpeedtestDone) {
        if (now >= 60000) {
            firstSpeedtestDone = true;
            lastSpeedtestTrigger = now;
            if (WiFi.status() == WL_CONNECTED) {
                triggerRouterSpeedtest();
                measureLatency();
                Serial.println("[Speedtest ⏱️] Initial boot router Ookla speedtest triggered!");
            }
        }
    } else if (WiFi.status() == WL_CONNECTED && (now - lastSpeedtestTrigger >= 21600000UL)) {
        lastSpeedtestTrigger = now;
        triggerRouterSpeedtest();
        measureLatency();
        Serial.println("[Speedtest ⏱️] 6-Hour scheduled router Ookla speedtest triggered!");
    }

    // Publish to MQTT every 5 seconds when BLE data is active
    static uint32_t lastMqttPublish = 0;
    if (now - lastMqttPublish >= 5000) {
        lastMqttPublish = now;

        SolarData d;
        portENTER_CRITICAL(&g_mux);
        d = g_data;
        g_newDataAvailable = false;
        portEXIT_CRITICAL(&g_mux);

        if (d.has_data && mqttClient.connected()) {
            int wifiRssi = WiFi.RSSI();
            int wifiQual = constrain(2 * (wifiRssi + 100), 0, 100);
            char json[900];
            snprintf(json, sizeof(json),
                "{\"solar_power\":%u,\"panel_voltage\":%.2f,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
                "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
                "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,\"wifi_quality_pct\":%d,\"wifi_channel\":%d,"
                "\"chip_temp\":%.1f,\"free_heap_kb\":%u,\"net_mbps\":%.2f,\"net_up_mbps\":%.2f,"
                "\"net_ping_ms\":%u,\"gw_ping_ms\":%u,\"dns_ms\":%u,\"ttfb_ms\":%u,"
                "\"cell_has_data\":%s,\"cell_rsrp\":%d,\"cell_sinr\":%d,\"cell_rsrq\":%d,\"cell_qual\":%d,"
                "\"cell_mode\":\"%s\",\"cell_band\":\"%s\",\"cell_operator\":\"%s\",\"cell_id\":\"%s\",\"cell_temp\":%.1f,"
                "\"cell_down_mbps\":%.2f,\"cell_up_mbps\":%.2f,\"cell_speed_epoch\":%lu,"
                "\"relay1_inverter\":%s,\"relay2_coil\":%s,\"led_strip\":%s,\"buffered_records\":%u,\"age_sec\":0}",
                d.solar_power,
                d.panel_voltage,
                d.battery_voltage,
                d.battery_current,
                (unsigned long)d.yield_today_wh,
                d.external_load,
                d.charge_state,
                getChargeStateName(d.charge_state),
                d.charger_error,
                d.rssi,
                wifiRssi,
                wifiQual,
                WiFi.channel(),
                temperatureRead(),
                (unsigned int)(ESP.getFreeHeap() / 1024),
                g_cellDownMbps,
                g_cellUpMbps,
                (unsigned int)g_netPingMs,
                (unsigned int)g_gwPingMs,
                (unsigned int)g_dnsMs,
                (unsigned int)g_ttfbMs,
                g_cellHasData ? "true" : "false",
                g_cellRsrp,
                g_cellSinr,
                g_cellRsrq,
                g_cellQual,
                g_cellMode.c_str(),
                g_cellBand.c_str(),
                g_cellOperator.c_str(),
                g_cellId.c_str(),
                g_cellTemp,
                g_cellDownMbps,
                g_cellUpMbps,
                (unsigned long)g_lastSpeedtestEpoch,
                g_relay1_inverter ? "true" : "false",
                g_relay2_aux ? "true" : "false",
                g_led_strip_on ? "true" : "false",
                (unsigned int)g_bufferedRecordCount
            );
            mqttClient.publish(MQTT_TOPIC, json);
            triggerTxFlash();
            setLcdActivity("MQTT TX", TFT_YELLOW);
            Serial.printf("[MQTT 📡] Published to %s: %s\n", MQTT_TOPIC, json);
        }
    }

    // Check router 5G metrics & ongoing speedtest state (every 60s normally, 5s during speedtest)
    static uint32_t lastCellCheck = 0;
    bool cellTestRunning = (g_cellSpeedState.length() > 0 && g_cellSpeedState != "FINISHED");
    uint32_t cellInterval = cellTestRunning ? 5000 : 60000;
    if (now - lastCellCheck >= cellInterval) {
        lastCellCheck = now;
        fetchTeltonika5GMetrics(false);
    }

    // Log to Supabase Cloud every 2 minutes (120 seconds) - keeps database calm and clean
    static uint32_t lastSupabaseLog = 0;
    if (now - lastSupabaseLog >= 120000) {
        lastSupabaseLog = now;
        measureLatency();
        fetchTeltonika5GMetrics(false);
        fetchMeteoSwissWeather(false);

        SolarData d;
        portENTER_CRITICAL(&g_mux);
        d = g_data;
        portEXIT_CRITICAL(&g_mux);

        if (d.has_data) {
            logToSupabase(d);
            checkDailyEveningReport(d);
        }

        // Drain any stored offline records if Wi-Fi has reconnected
        drainOfflineRecordsToCloud();
    }

    delay(10);
}
