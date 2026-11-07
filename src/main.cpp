/**
 * RandeSolar - Victron MPPT 75|15 ESP32-S3 BLE, Wi-Fi & MQTT Station
 *
 * Features:
 *  - Passive BLE scanner with hardware AES-128-CTR decryption
 *  - Connects to Wi-Fi "RandeLab"
 *  - Publishes live telemetry to HiveMQ Public Broker (broker.hivemq.com)
 *    Topic: randelab/solar/telemetry
 *  - Hosts standalone openBrushograph Studio Web Dashboard on Port 80
 *  - Kongress Dresden (Nacht & Altpapier) in German
 *  - mDNS: http://randesolar.local
 *  - REST API: /api/live & /api/status
 *  - USB Serial CDC output
 *
 * Target: ESP32-S3-DevKitC-1-N8
 */

#include <Arduino.h>
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
static const char* WIFI_SSID     = "RandeLab";
static const char* WIFI_PASS     = "sauhund13";
static const char* MDNS_HOST     = "randesolar";

// Telegram Bot Configuration
static const char* TELEGRAM_BOT_TOKEN = "8600149990:AAGGHL_USsmi_PfzPFBDIvoFgQx-rmvXIkc";
static const char* TELEGRAM_CHAT_ID   = "818690605";
static int64_t g_lastTelegramUpdateId = 0;

// Supabase Cloud History Logger
static const char* SUPABASE_URL = "https://pakfuetvwpffwfrrxshz.supabase.co/rest/v1/solar_telemetry";
static const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU";

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
static const char* MQTT_BROKER   = "broker.hivemq.com";
static const int   MQTT_PORT     = 1883;
static const char* MQTT_TOPIC    = "randelab/solar/telemetry";

static const char* TARGET_MAC    = "cb:06:61:60:5a:c2";
static const uint8_t ENCRYPTION_KEY[16] = {
    0x16, 0x23, 0x37, 0x67, 0xe7, 0x2a, 0x76, 0xe1,
    0x5c, 0x04, 0x02, 0x32, 0x74, 0x10, 0x2c, 0x9d
};

static const uint16_t VICTRON_MFG_ID = 0x02E1;

// ==================== ONBOARD WS2812 NEOPIXEL (GPIO 48) ====================
#ifndef RGB_BUILTIN
#define RGB_BUILTIN 48
#endif

static uint32_t g_lastTxFlashMs = 0;

void setPixel(uint8_t r, uint8_t g, uint8_t b) {
    neopixelWrite(RGB_BUILTIN, r, g, b);
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
        <span style="font-size:0.72rem; color:var(--muted); font-family:monospace;">47.7612°N, 8.5868°E • ~640m ü.M. (MeteoSwiss ICON)</span>
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
        <span><b>MQTT:</b> broker.hivemq.com</span>
        <span><b>Empfang:</b> <span id="beaconAge">--</span></span>
        <span><a id="tgBotLink" href="https://t.me/RandeSolarBot" target="_blank" style="color:var(--cyan);text-decoration:none;font-weight:bold;">✈️ Telegram Bot</a></span>
        <span><a href="/update" style="color:var(--pink);text-decoration:none;font-weight:bold;">⚡ OTA Firmware Update</a></span>
      </div>
    </div>
    <div class="footer" id="lblFooter">RandeSolar • Mechatronische Kunstwerkstatt RandeLab</div>
  </div>

  <script>
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
      const elDiag = document.getElementById("lblPanelDiag");
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

        document.getElementById('solarPower').textContent = d.solar_power;
        document.getElementById('yieldToday').textContent = (d.yield_today_wh / 1000).toFixed(2) + ' kWh';
        document.getElementById('batteryVoltage').textContent = d.battery_voltage.toFixed(2);

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
        document.getElementById('batteryBar').style.width = soc + '%';
        const stageLabel = (d.charge_state === 5) ? 'Float' : (d.charge_state === 4) ? 'Absorp.' : (d.charge_state === 3) ? 'Bulk' : 'Ruhe';
        document.getElementById('estSoc').textContent = soc + '% (' + stageLabel + ')';

        document.getElementById('batteryCurrent').textContent = d.battery_current.toFixed(1);
        document.getElementById('flowWatts').textContent = (d.battery_voltage * d.battery_current).toFixed(1) + ' W';

        const stateMap = dict[curLang].states;
        const stStr = stateMap[d.charge_state] || d.state_str;
        document.getElementById('chargeState').textContent = stStr;

        document.getElementById('externalLoad').textContent = d.external_load.toFixed(1) + ' A';
        document.getElementById('bleRssi').textContent = d.ble_rssi;
        document.getElementById('wifiRssi').textContent = d.wifi_rssi;
        if (d.wifi_quality_pct !== undefined) document.getElementById('wifiQual').textContent = d.wifi_quality_pct;
        if (d.wifi_channel !== undefined) document.getElementById('wifiCh').textContent = d.wifi_channel;
        document.getElementById('ipAddr').textContent = d.ip;
        if (d.gateway_ip) document.getElementById('gwAddr').textContent = d.gateway_ip;
        if (d.chip_temp !== undefined) document.getElementById('chipTemp').textContent = d.chip_temp.toFixed(1);
        if (d.free_heap_kb !== undefined) document.getElementById('freeHeap').textContent = d.free_heap_kb;
        if (d.net_mbps !== undefined) document.getElementById('netDown').textContent = d.net_mbps.toFixed(2);
        if (d.net_up_mbps !== undefined) document.getElementById('netUp').textContent = d.net_up_mbps.toFixed(2);
        if (d.net_ping_ms !== undefined) document.getElementById('netPing').textContent = d.net_ping_ms;
        if (d.gw_ping_ms !== undefined) document.getElementById('gwPing').textContent = d.gw_ping_ms;
        if (d.dns_ms !== undefined) document.getElementById('dnsMs').textContent = d.dns_ms;
        if (d.ttfb_ms !== undefined) document.getElementById('ttfbMs').textContent = d.ttfb_ms;
        if (d.cell_has_data) {
          const elRsrp = document.getElementById('cellRsrp');
          if (elRsrp) elRsrp.textContent = d.cell_rsrp;
          const elSinr = document.getElementById('cellSinr');
          if (elSinr) elSinr.textContent = d.cell_sinr;
          const elBand = document.getElementById('cellBand');
          if (elBand) elBand.textContent = d.cell_band;
          const elQual = document.getElementById('cellQual');
          if (elQual) elQual.textContent = d.cell_qual;
          const elOp = document.getElementById('cellOperator');
          if (elOp) elOp.textContent = d.cell_operator;
          const elMode = document.getElementById('cellMode');
          if (elMode) elMode.textContent = d.cell_mode;
          const elId = document.getElementById('cellId');
          if (elId) elId.textContent = d.cell_id;
          const elTemp = document.getElementById('cellTemp');
          if (elTemp) elTemp.textContent = d.cell_temp.toFixed(1);
          if (d.cell_down_mbps !== undefined && d.cell_down_mbps > 0) {
            const elCd = document.getElementById('cellDown');
            if (elCd) elCd.textContent = d.cell_down_mbps.toFixed(2);
            const elCu = document.getElementById('cellUp');
            if (elCu) elCu.textContent = d.cell_up_mbps.toFixed(2);
          }
        }
        document.getElementById('beaconAge').textContent = d.age_sec + (curLang === 'de' ? ' Sek.' : 's ago');
      } catch (e) {
        console.error(e);
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
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=47.7612&longitude=8.5868&elevation=640&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation,global_tilted_irradiance&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,sunshine_duration&timezone=Europe%2FZurich&tilt=35';
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
        Serial.println("\n[ArduinoOTA] Starting wireless update...");
    });
    ArduinoOTA.onEnd([]() {
        setPixel(0, 40, 10); // Green on finish
        Serial.println("\n[ArduinoOTA] Update complete! Rebooting...");
    });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        uint8_t pct = (progress * 100) / (total ? total : 1);
        setPixel(20, 0, (uint8_t)map(pct, 0, 100, 5, 45));
        Serial.printf("[ArduinoOTA] Progress: %u%%\r", pct);
    });
    ArduinoOTA.onError([](ota_error_t error) {
        setPixel(40, 0, 0);
        Serial.printf("\n[ArduinoOTA] Error[%u]\n", error);
        NimBLEDevice::getScan()->start(0, false);
    });

    ArduinoOTA.begin();
    Serial.printf("[OTA] Ready at %s.local:3232 and http://%s.local/update\n", MDNS_HOST, MDNS_HOST);
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

    char json[1350];
    snprintf(json, sizeof(json),
        "{\"has_data\":%s,\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,\"panel_voltage\":%.2f,"
        "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
        "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,\"wifi_quality_pct\":%d,\"wifi_channel\":%d,"
        "\"chip_temp\":%.1f,\"free_heap_kb\":%u,\"net_mbps\":%.2f,\"net_up_mbps\":%.2f,"
        "\"net_ping_ms\":%u,\"gw_ping_ms\":%u,\"dns_ms\":%u,\"ttfb_ms\":%u,"
        "\"cell_has_data\":%s,\"cell_rsrp\":%d,\"cell_sinr\":%d,\"cell_rsrq\":%d,\"cell_qual\":%d,"
        "\"cell_mode\":\"%s\",\"cell_band\":\"%s\",\"cell_operator\":\"%s\",\"cell_id\":\"%s\",\"cell_temp\":%.1f,"
        "\"cell_down_mbps\":%.2f,\"cell_up_mbps\":%.2f,\"cell_speed_state\":\"%s\","
        "\"wx_temp\":%.1f,\"wx_solar_wm2\":%.1f,\"wx_cloud_pct\":%d,\"wx_rain_mm\":%.2f,\"wx_wind_kmh\":%.1f,\"wx_humidity\":%d,\"wx_pressure\":%.1f,"
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
        g_wxTemp,
        g_wxSolarWm2,
        g_wxCloudPct,
        g_wxRainMm,
        g_wxWindKmh,
        g_wxHumidity,
        g_wxPressure,
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

void measureLatency() {
    if (WiFi.status() != WL_CONNECTED) return;

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
    // High-resolution MeteoSwiss ICON-CH model data for Merishausen / Randen (47.7612° N, 8.5868° E, ~640m)
    String wxUrl = "https://api.open-meteo.com/v1/forecast?latitude=47.7612&longitude=8.5868&elevation=640&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_gusts_10m,shortwave_radiation&timezone=Europe%2FZurich";
    
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
            if (dl.length() > 0 && dl != "0") g_cellDownMbps = (dl.toFloat() * 8.0f) / 1000000.0f;
            if (ul.length() > 0 && ul != "0") g_cellUpMbps = (ul.toFloat() * 8.0f) / 1000000.0f;
            if (st.length() > 0) g_cellSpeedState = st;
            if (g_cellDownMbps > 0.0f) {
                Serial.printf("[TRB500 🚀] Router 5G Speedtest: ⬇️ %.2f Mbit/s | ⬆️ %.2f Mbit/s (%s)\n",
                    g_cellDownMbps, g_cellUpMbps, g_cellSpeedState.c_str());
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

// Reconnect MQTT (non-blocking)
void reconnectMQTT() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (mqttClient.connected()) return;

    static unsigned long lastAttempt = 0;
    if (millis() - lastAttempt > 5000) {
        lastAttempt = millis();
        String clientId = "RandeSolar-ESP32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
        Serial.printf("[MQTT] Connecting to %s:%d...\n", MQTT_BROKER, MQTT_PORT);
        if (mqttClient.connect(clientId.c_str())) {
            Serial.println("[MQTT] Connected to HiveMQ Broker!");
        } else {
            Serial.printf("[MQTT] Connect failed, rc=%d\n", mqttClient.state());
        }
    }
}

void updateNeoPixel() {
    uint32_t now = millis();

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
            Serial.printf("[Supabase 💾] Logged row to cloud: %.2fV | %uW | %.1fA\n", d.battery_voltage, d.solar_power, d.battery_current);
        } else {
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
    secClient.setTimeout(3500);

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
                                    "🏔️ _47.7612°N, 8.5868°E • ~640m ü.M. (MeteoSwiss ICON)_",
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
                                "• /speed - Live Internet-Speedtest vom ESP32 🚀\n"
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

void setup() {
    Serial.begin(115200);
    delay(1000);

    // Initial soft blue startup
    setPixel(0, 10, 30);

    // Initialize local LittleFS flash memory for offline logging
    initOfflineStorage();

    // Configure ADC1 for Solar Panel Voltage Divider
    analogSetPinAttenuation(SOLAR_ADC_PIN, ADC_11db);

    Serial.println("\n========================================");
    Serial.println("  RandeSolar • ESP32-S3 BLE & Wi-Fi & MQTT");
    Serial.printf("  Connecting to: %s\n", WIFI_SSID);
    Serial.printf("  MQTT Broker:   %s:%d\n", MQTT_BROKER, MQTT_PORT);
    Serial.println("========================================\n");

    // Connect to Wi-Fi
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    Serial.print("[WiFi] Connecting");
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 25) {
        delay(500);
        Serial.print(".");
        // Gentle blue pulsing during Wi-Fi connect
        setPixel(0, 0, (uint8_t)(10 + (attempts % 2) * 35));
        attempts++;
    }

    // Configure MQTT
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(1024);

    // Setup Web Server
    server.on("/", handleRoot);
    server.on("/api/live", handleLiveApi);
    server.on("/api/buffer", handleBufferApi);
    server.on("/api/buffer/csv", handleBufferCsv);
    server.on("/api/speedtest", handleSpeedtestApi);
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
            WIFI_SSID,
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
    ArduinoOTA.handle();
    server.handleClient();
    reconnectMQTT();
    mqttClient.loop();

    // Update onboard NeoPixel state machine
    updateNeoPixel();

    uint32_t now = millis();

    // Check Telegram commands every 3.5 seconds
    static uint32_t lastTelegramCheck = 0;
    if (now - lastTelegramCheck >= 3500) {
        lastTelegramCheck = now;
        checkTelegramUpdates();
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
            char json[680];
            snprintf(json, sizeof(json),
                "{\"solar_power\":%u,\"panel_voltage\":%.2f,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
                "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
                "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,\"wifi_quality_pct\":%d,\"wifi_channel\":%d,"
                "\"chip_temp\":%.1f,\"free_heap_kb\":%u,\"net_mbps\":%.2f,\"net_up_mbps\":%.2f,"
                "\"net_ping_ms\":%u,\"gw_ping_ms\":%u,\"dns_ms\":%u,\"ttfb_ms\":%u,"
                "\"cell_rsrp\":%d,\"cell_sinr\":%d,\"cell_band\":\"%s\",\"age_sec\":0}",
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
                g_cellRsrp,
                g_cellSinr,
                g_cellBand.c_str()
            );
            mqttClient.publish(MQTT_TOPIC, json);
            triggerTxFlash();
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
