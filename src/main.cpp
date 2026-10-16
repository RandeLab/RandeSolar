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
#include <PubSubClient.h>
#include <NimBLEDevice.h>
#include "mbedtls/aes.h"
#include <time.h>

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
    unsigned long last_seen_ms = 0;
    bool has_data = false;
};

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

        portENTER_CRITICAL(&g_mux);
        g_data.solar_power = solarPower;
        g_data.battery_voltage = batteryVoltage;
        g_data.battery_current = batteryCurrent;
        g_data.yield_today_wh = yieldTodayWh;
        g_data.external_load = externalLoad;
        g_data.charge_state = chargeState;
        g_data.charger_error = chargerError;
        g_data.rssi = rssi;
        g_data.last_seen_ms = millis();
        g_data.has_data = true;
        g_newDataAvailable = true;

        if (solarPower > g_peakPowerToday) g_peakPowerToday = solarPower;
        if (batteryVoltage > 5.0f) {
            if (g_minBattToday > 50.0f || batteryVoltage < g_minBattToday) g_minBattToday = batteryVoltage;
            if (batteryVoltage > g_maxBattToday) g_maxBattToday = batteryVoltage;
        }
        portEXIT_CRITICAL(&g_mux);

        Serial.printf("[☀️ BEACON] Solar: %uW | Batt: %.2fV, %.1fA | State: %s (%s) | Yield: %uWh | RSSI: %ddBm\n",
            solarPower, batteryVoltage, batteryCurrent, getChargeStateName(chargeState), getChargeStateGerman(chargeState), yieldTodayWh, rssi);
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

    <div class="panel">
      <h2 id="lblPanelDiag">Systemdiagnose & Funknetz</h2>
      <div class="sub" style="border:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:16px;">
        <span><b>Gerät:</b> cb:06:61:60:5a:c2</span>
        <span><b>Bluetooth:</b> <span id="bleRssi">--</span> dBm</span>
        <span><b>WLAN:</b> <span id="wifiRssi">--</span> dBm</span>
        <span><b>MQTT:</b> broker.hivemq.com</span>
        <span><b>Netzwerk-IP:</b> <span id="ipAddr">--</span></span>
        <span><b>Telegramm:</b> <span id="beaconAge">--</span></span>
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
      document.getElementById("lblPanelDiag").textContent = l.panelDiag;
      document.getElementById("lblFooter").textContent = l.footer;
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
        document.getElementById('ipAddr').textContent = d.ip;
        document.getElementById('beaconAge').textContent = d.age_sec + (curLang === 'de' ? ' Sek.' : 's ago');
      } catch (e) {
        console.error(e);
      }
    }

    const savedTheme = localStorage.getItem("randesolar-esp-theme") || "pinkograph";
    document.getElementById("themeSelect").value = savedTheme;
    applyTheme(savedTheme);

    setInterval(update, 2000);
    update();
  </script>
</body>
</html>
)rawliteral";

// ==================== REST API HANDLERS ====================
void handleRoot() {
    server.send(200, "text/html", INDEX_HTML);
}

void handleLiveApi() {
    SolarData d;
    portENTER_CRITICAL(&g_mux);
    d = g_data;
    portEXIT_CRITICAL(&g_mux);

    unsigned long ageSec = d.has_data ? ((millis() - d.last_seen_ms) / 1000) : 999;

    char json[450];
    snprintf(json, sizeof(json),
        "{\"has_data\":%s,\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
        "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
        "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,\"ip\":\"%s\",\"age_sec\":%lu}",
        d.has_data ? "true" : "false",
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
        WiFi.localIP().toString().c_str(),
        ageSec
    );

    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", json);
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
    if (WiFi.status() != WL_CONNECTED || !d.has_data) return;

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

        char json[380];
        snprintf(json, sizeof(json),
            "{\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
            "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
            "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d}",
            d.solar_power,
            d.battery_voltage,
            d.battery_current,
            (unsigned long)d.yield_today_wh,
            d.external_load,
            d.charge_state,
            getChargeStateName(d.charge_state),
            d.charger_error,
            d.rssi,
            WiFi.RSSI()
        );

        int code = http.POST((uint8_t*)json, strlen(json));
        if (code == 200 || code == 201) {
            Serial.printf("[Supabase 💾] Logged row to cloud: %.2fV | %uW | %.1fA\n", d.battery_voltage, d.solar_power, d.battery_current);
        } else {
            Serial.printf("[Supabase ⚠️] Insert failed (HTTP %d): %s\n", code, http.errorToString(code).c_str());
        }
        http.end();
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

                            char msg[650];
                            int soc = estimateBatterySoC(d.battery_voltage, d.battery_current, d.external_load, d.charge_state);
                            const char* socStage = (d.charge_state == 5) ? "Float" : (d.charge_state == 4) ? "Absorp." : (d.charge_state == 3 || d.battery_current > 0.4f) ? "Bulk" : "Ruhe";
                            unsigned long ageSec = d.has_data ? ((millis() - d.last_seen_ms) / 1000) : 999;
                            float minV = (g_minBattToday > 50.0f ? d.battery_voltage : g_minBattToday);
                            float maxV = (g_maxBattToday < 5.0f ? d.battery_voltage : g_maxBattToday);

                            snprintf(msg, sizeof(msg),
                                "☀️ *RandeSolar Kraftwerk Status* ⚡\n"
                                "━━━━━━━━━━━━━━━━━━━━\n"
                                "☀️ *Solar-Leistung:* %u W (Peak: %u W)\n"
                                "🔋 *Batteriespeicher:* %.2f V (~%d%% • %s)\n"
                                "📉 *Batterie Min / Max:* %.2f V / %.2f V\n"
                                "⚡ *Ladestrom:* %.1f A\n"
                                "💡 *Lastanschluß:* %.1f A\n"
                                "📊 *Tagesertrag:* %.2f kWh\n"
                                "🏷️ *Zustand:* %s (%s)\n"
                                "📶 *Signal:* BLE %d dBm | WiFi %d dBm\n"
                                "⏱️ *Telegramm-Alter:* %lu Sek.\n"
                                "━━━━━━━━━━━━━━━━━━━━\n"
                                "📍 _ESP32-S3 Standalone Station_",
                                d.solar_power,
                                g_peakPowerToday,
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
                                d.rssi,
                                WiFi.RSSI(),
                                ageSec
                            );
                            sendTelegramMessage(msg, fromChatId.c_str());
                        } else if (cmd.startsWith("/mood") || cmd.startsWith("/feel") || cmd.startsWith("/wiegehts") || cmd.startsWith("/story") || cmd.startsWith("/tagebuch")) {
                            SolarData d;
                            portENTER_CRITICAL(&g_mux);
                            d = g_data;
                            portEXIT_CRITICAL(&g_mux);

                            String moodMsg = generateHumanMoodReport(d);
                            sendTelegramMessage(moodMsg, fromChatId.c_str());
                        } else if (cmd.startsWith("/ping")) {
                            sendTelegramMessage("🏓 *Pong!* RandeSolar ESP32-S3 ist online und empfängt Bluetooth-Telemetrie.", fromChatId.c_str());
                        } else if (cmd.startsWith("/start") || cmd.startsWith("/help") || cmd.startsWith("/hilfe")) {
                            sendTelegramMessage(
                                "☀️ *Willkommen beim RandeSolar Bot!* ⚡\n\n"
                                "Verfügbare Befehle:\n"
                                "• /status - Technische Zahlen & Messwerte\n"
                                "• /mood - Wie ich mich heute fühle (Tagebuch) 💬\n"
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

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        if (MDNS.begin(MDNS_HOST)) {
            Serial.printf("[mDNS] http://%s.local\n", MDNS_HOST);
        }
        setPixel(0, 30, 15); // Green confirmation flash

        // Sync time via NTP (Europe/Zurich: UTC+1 with 1h daylight saving = UTC+2 in summer)
        configTime(3600, 3600, "pool.ntp.org", "time.google.com");
        Serial.println("[NTP] Time synchronization requested");

        // Send Telegram startup message to Marc
        char bootMsg[240];
        snprintf(bootMsg, sizeof(bootMsg),
            "🚀 *RandeSolar ESP32-S3 online!* 🔌\n"
            "Verbunden mit Wi-Fi *%s* (IP: `%s`).\n"
            "Sende /status für Live-Telemetrie.",
            WIFI_SSID,
            WiFi.localIP().toString().c_str()
        );
        sendTelegramMessage(bootMsg);
    } else {
        Serial.println("\n[WiFi] Connection timed out. Running offline BLE logger mode.");
        setPixel(30, 0, 0); // Red warning
    }

    // Configure MQTT
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(512);

    // Setup Web Server
    server.on("/", handleRoot);
    server.on("/api/live", handleLiveApi);
    server.begin();
    Serial.println("[HTTP] Web Server started on port 80");

    // Initialize NimBLE
    NimBLEDevice::init("RandeSolar-ESP32");
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);

    NimBLEScan* pScan = NimBLEDevice::getScan();
    pScan->setScanCallbacks(&scanCallbacks, true);
    pScan->setActiveScan(false);
    pScan->setInterval(100);
    pScan->setWindow(99);

    Serial.println("[BLE] Scanner active. Listening for Victron beacons...\n");
    pScan->start(0, false);
}

void loop() {
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
            char json[380];
            snprintf(json, sizeof(json),
                "{\"solar_power\":%u,\"battery_voltage\":%.2f,\"battery_current\":%.2f,"
                "\"yield_today_wh\":%lu,\"external_load\":%.2f,\"charge_state\":%u,\"state_str\":\"%s\","
                "\"charger_error\":%u,\"ble_rssi\":%d,\"wifi_rssi\":%d,\"age_sec\":0}",
                d.solar_power,
                d.battery_voltage,
                d.battery_current,
                (unsigned long)d.yield_today_wh,
                d.external_load,
                d.charge_state,
                getChargeStateName(d.charge_state),
                d.charger_error,
                d.rssi,
                WiFi.RSSI()
            );
            mqttClient.publish(MQTT_TOPIC, json);
            triggerTxFlash();
            Serial.printf("[MQTT 📡] Published to %s: %s\n", MQTT_TOPIC, json);
        }
    }

    // Log to Supabase Cloud every 20 seconds
    static uint32_t lastSupabaseLog = 0;
    if (now - lastSupabaseLog >= 20000) {
        lastSupabaseLog = now;

        SolarData d;
        portENTER_CRITICAL(&g_mux);
        d = g_data;
        portEXIT_CRITICAL(&g_mux);

        if (d.has_data) {
            logToSupabase(d);
            checkDailyEveningReport(d);
        }
    }

    delay(10);
}
