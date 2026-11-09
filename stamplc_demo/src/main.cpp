#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <M5StamPLC.h>
#include <math.h>

// Wi-Fi Credentials & Hostnames
static const char* WIFI_SSID     = "RandeLab";
static const char* WIFI_PASS     = "sauhund13";
static const char* MDNS_HOST     = "stamplc";
static const char* PRIMARY_HOST  = "http://randesolar.local/api/live";
static const char* FALLBACK_HOST = "http://192.168.1.100/api/live";

WebServer server(80);
M5Canvas canvas(&M5.Display);

int SCREEN_W = 240;
int SCREEN_H = 135;

// ==================== BYTEBEAT ENGINE ====================
volatile bool bytebeat_hw_playing = false;
volatile int bytebeat_formula = 3; // Default to user favorite: Acid!
volatile uint32_t bytebeat_t = 2048; // Start with offset so formulas don't start in silence!
unsigned long last_bytebeat_tick = 0;

// Telemetry state fetched from cellar station
struct LiveTelemetry {
    bool has_data = false;
    float battery_voltage = 0.0f;
    float battery_current = 0.0f;
    uint16_t solar_power = 0;
    uint32_t yield_today_wh = 0;
    String state_str = "OFF";
    float wx_temp = 0.0f;
    unsigned long last_fetch_ms = 0;
    bool online = false;
} live_telemetry;

// Starfield stars
const int NUM_STARS = 45;
struct Star {
    float x, y, z;
} stars[NUM_STARS];

// 3D Cube Vertices
struct Point3D {
    float x, y, z;
};
Point3D cube_vertices[8] = {
    {-25, -25, -25}, { 25, -25, -25}, { 25,  25, -25}, {-25,  25, -25},
    {-25, -25,  25}, { 25, -25,  25}, { 25,  25,  25}, {-25,  25,  25}
};
int cube_edges[12][2] = {
    {0, 1}, {1, 2}, {2, 3}, {3, 0},
    {4, 5}, {5, 6}, {6, 7}, {7, 4},
    {0, 4}, {1, 5}, {2, 6}, {3, 7}
};

float angle_x = 0.0f;
float angle_y = 0.0f;
float angle_z = 0.0f;

int anim_mode = 0; // 0 = 3D Cyber Cube, 1 = Plasma / Sine Wave, 2 = Full RandeSolar HUD, 3 = Bytebeat Scope
int current_rotation = 0;
bool relay1_state = false;
bool relay2_state = false;
uint32_t frame_count = 0;
float fps = 0.0f;
unsigned long last_fps_time = 0;
unsigned long last_telemetry_fetch = 0;

void playBootJingle() {
    int melody[] = { 523, 659, 784, 1046 }; // C5, E5, G5, C6 in loud piezo range
    int durations[] = { 90, 90, 90, 200 };
    for (int i = 0; i < 4; i++) {
        M5StamPLC.tone(melody[i], durations[i]);
        delay(durations[i] + 35);
    }
    M5StamPLC.noTone();
}

void playClickBeep(int freq, int ms) {
    if (!bytebeat_hw_playing) {
        M5StamPLC.tone(freq, ms);
    }
}

void initStars() {
    for (int i = 0; i < NUM_STARS; i++) {
        stars[i].x = (float)(random(-SCREEN_W, SCREEN_W));
        stars[i].y = (float)(random(-SCREEN_H, SCREEN_H));
        stars[i].z = (float)(random(20, 200));
    }
}

void fetchLiveTelemetry() {
    if (WiFi.status() != WL_CONNECTED) {
        live_telemetry.online = false;
        return;
    }

    HTTPClient http;
    http.setTimeout(1800);
    bool ok = http.begin(PRIMARY_HOST);
    int httpCode = http.GET();

    if (httpCode != HTTP_CODE_OK) {
        http.end();
        http.begin(FALLBACK_HOST);
        httpCode = http.GET();
    }

    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        StaticJsonDocument<1536> doc;
        DeserializationError err = deserializeJson(doc, payload);
        if (!err) {
            live_telemetry.has_data = doc["has_data"] | false;
            live_telemetry.battery_voltage = doc["battery_voltage"] | 0.0f;
            live_telemetry.battery_current = doc["battery_current"] | 0.0f;
            live_telemetry.solar_power = doc["solar_power"] | 0;
            live_telemetry.yield_today_wh = doc["yield_today_wh"] | 0;
            live_telemetry.state_str = doc["state_str"] | "OFF";
            live_telemetry.wx_temp = doc["wx_temp"] | 0.0f;
            live_telemetry.last_fetch_ms = millis();
            live_telemetry.online = true;
        }
    } else {
        live_telemetry.online = false;
    }
    http.end();
}

void drawStars() {
    for (int i = 0; i < NUM_STARS; i++) {
        stars[i].z -= 2.5f;
        if (stars[i].z <= 5.0f) {
            stars[i].x = (float)(random(-SCREEN_W, SCREEN_W));
            stars[i].y = (float)(random(-SCREEN_H, SCREEN_H));
            stars[i].z = 180.0f;
        }
        int k = (int)(80.0f / stars[i].z);
        int sx = (int)(stars[i].x * k / 80.0f) + SCREEN_W / 2;
        int sy = (int)(stars[i].y * k / 80.0f) + SCREEN_H / 2;

        if (sx >= 0 && sx < SCREEN_W && sy >= 0 && sy < SCREEN_H) {
            uint16_t col = (stars[i].z < 60) ? TFT_WHITE : (stars[i].z < 120 ? TFT_CYAN : TFT_NAVY);
            canvas.drawPixel(sx, sy, col);
        }
    }
}

void drawCyberCube() {
    drawStars();

    float rad_x = angle_x * 0.0174533f;
    float rad_y = angle_y * 0.0174533f;
    float rad_z = angle_z * 0.0174533f;

    Point3D rot[8];
    for (int i = 0; i < 8; i++) {
        float x1 = cube_vertices[i].x * cos(rad_y) + cube_vertices[i].z * sin(rad_y);
        float y1 = cube_vertices[i].y;
        float z1 = -cube_vertices[i].x * sin(rad_y) + cube_vertices[i].z * cos(rad_y);

        float x2 = x1;
        float y2 = y1 * cos(rad_x) - z1 * sin(rad_x);
        float z2 = y1 * sin(rad_x) + z1 * cos(rad_x);

        rot[i].x = x2 * cos(rad_z) - y2 * sin(rad_z);
        rot[i].y = x2 * sin(rad_z) + y2 * cos(rad_z);
        rot[i].z = z2;
    }

    int proj_x[8], proj_y[8];
    for (int i = 0; i < 8; i++) {
        float fov = 160.0f;
        float distance = 110.0f + rot[i].z;
        proj_x[i] = (int)(rot[i].x * fov / distance) + (SCREEN_W / 2);
        proj_y[i] = (int)(rot[i].y * fov / distance) + (SCREEN_H / 2);
    }

    for (int i = 0; i < 12; i++) {
        int p1 = cube_edges[i][0];
        int p2 = cube_edges[i][1];
        uint16_t color = (i < 4) ? TFT_MAGENTA : (i < 8 ? TFT_CYAN : TFT_GREENYELLOW);
        canvas.drawLine(proj_x[p1], proj_y[p1], proj_x[p2], proj_y[p2], color);
    }

    angle_x += 2.0f;
    angle_y += 2.8f;
    angle_z += 1.2f;
}

void drawPlasmaWaves() {
    float t = frame_count * 0.06f;
    for (int x = 0; x < SCREEN_W; x += 3) {
        float y1 = (SCREEN_H / 2) + sin(x * 0.04f + t) * 35.0f;
        float y2 = (SCREEN_H / 2) + cos(x * 0.03f - t * 1.3f) * 28.0f;
        float y3 = (SCREEN_H / 2) + sin(x * 0.08f + t * 0.8f) * 15.0f;

        canvas.drawLine(x, (int)y1, x, (int)y2, canvas.color565(120 + 120 * sin(t + x * 0.02f), 200, 255));
        canvas.drawPixel(x, (int)y3, TFT_YELLOW);
    }
}

inline uint8_t calcBytebeat(uint32_t t, int f) {
    switch (f) {
        case 0: // Sierra Arp (Fast 4-step rising chiptune)
            return (uint8_t)(((t * ((t >> 9 | t >> 13) & 15)) | (t >> 6)) & 0xFF);
        case 1: // 42-Melody Pro (Iconic Hitchhiker progression, instant tone)
            return (uint8_t)((t * (42 & (t >> 7 | t >> 10))) & 0xFF);
        case 2: // Techno Rave (Pumping staccato octave bass & lead)
            return (uint8_t)(((t >> 5 | t >> 8) * 14 + ((t >> 9) & 3) * 60) & 0xFF);
        case 3: // Acid Chiptune (User Favorite TB-303 Arpeggiator)
        default:
            return (uint8_t)(((t >> 7 | t | t >> 6) * 10 + 4 * (t & (t >> 13) | (t >> 6))) & 0xFF);
    }
}

void drawBytebeatScope() {
    canvas.setTextSize(1);
    canvas.setTextColor(TFT_GREENYELLOW);
    canvas.setCursor(6, 6);
    canvas.printf("BYTEBEAT OSCILLOSCOPE [F%d]", bytebeat_formula + 1);

    canvas.setTextColor(bytebeat_hw_playing ? TFT_GREEN : TFT_RED);
    canvas.setCursor(185, 6);
    canvas.printf("[%s]", bytebeat_hw_playing ? "AUDIO" : "MUTE");

    canvas.drawFastHLine(4, 18, SCREEN_W - 8, TFT_DARKGREEN);

    uint32_t t_base = bytebeat_t;
    int prev_y = SCREEN_H / 2;
    for (int x = 0; x < SCREEN_W; x += 2) {
        uint32_t t = t_base + x * 3;
        uint8_t sample = calcBytebeat(t, bytebeat_formula);
        int y = (SCREEN_H / 2) + ((sample - 128) * 45) / 128;
        y = constrain(y, 22, SCREEN_H - 22);

        canvas.drawLine(x, prev_y, x + 2, y, TFT_GREEN);
        prev_y = y;
    }

    const char* fnames[] = {"SIERRA ARP", "42-MELODY", "TECHNO RAVE", "ACID TB-303"};
    canvas.setTextColor(TFT_WHITE);
    canvas.setCursor(8, SCREEN_H - 14);
    canvas.printf("F%d: %s (Btn B: Next)", bytebeat_formula + 1, fnames[bytebeat_formula]);
}

void drawRandeSolarHUD() {
    canvas.setTextSize(1);
    canvas.setTextColor(TFT_CYAN);
    canvas.setCursor(6, 6);
    canvas.printf(">> RANDELAB STAMPLC <<");

    canvas.setTextColor(live_telemetry.online ? TFT_GREEN : TFT_RED);
    canvas.setCursor(160, 6);
    canvas.printf("[%s]", live_telemetry.online ? "LIVE" : "NET ERR");

    canvas.drawFastHLine(4, 18, SCREEN_W - 8, TFT_DARKCYAN);

    float v = live_telemetry.online ? live_telemetry.battery_voltage : 12.64f;
    canvas.setTextColor(TFT_WHITE);
    canvas.setCursor(8, 24);
    canvas.printf("BAT: %.2fV  (4x VOLTIC)", v);

    uint16_t bar_color = (v >= 12.5f) ? TFT_GREEN : (v >= 12.0f ? TFT_YELLOW : TFT_RED);
    int bar_w = constrain((int)((v - 11.4f) / 1.4f * 150.0f), 4, 150);

    canvas.drawRect(8, 36, 154, 11, TFT_DARKGREY);
    canvas.fillRect(10, 38, bar_w, 7, bar_color);

    canvas.setTextColor(TFT_YELLOW);
    canvas.setCursor(8, 52);
    canvas.printf("SOLAR: %u W  |  YIELD: %lu Wh", live_telemetry.solar_power, live_telemetry.yield_today_wh);

    canvas.setTextColor(relay1_state ? TFT_GREEN : TFT_RED);
    canvas.setCursor(8, 68);
    canvas.printf("R1 [INVERTER]: %s", relay1_state ? "ACTIVE (ON)" : "SLEEP (OFF)");

    canvas.setTextColor(relay2_state ? TFT_GREEN : TFT_DARKGREY);
    canvas.setCursor(8, 83);
    canvas.printf("R2 [AUX]: %s", relay2_state ? "ON" : "OFF");

    canvas.setTextColor(TFT_SKYBLUE);
    canvas.setCursor(8, 98);
    if (WiFi.status() == WL_CONNECTED) {
        canvas.printf("IP: %s  (%d dBm)", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
        canvas.printf("WIFI: CONNECTING...");
    }

    canvas.setTextColor(TFT_ORANGE);
    canvas.setCursor(8, 113);
    canvas.printf("WX: %.1f C  |  ALT: 857m", live_telemetry.wx_temp);
}

// ==================== GEEKY RETRO CRT WEB DASHBOARD ====================
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RandeLab StamPLC // CRT Terminal & Bytebeat</title>
<style>
  :root {
    --crt-green: #39ff14;
    --crt-dim: #1a7a08;
    --crt-glow: rgba(57, 255, 20, 0.5);
    --crt-bg: #030804;
    --crt-panel: rgba(4, 18, 7, 0.92);
    --crt-border: #1a5712;
  }
  body.theme-amber {
    --crt-green: #ffb000;
    --crt-dim: #996800;
    --crt-glow: rgba(255, 176, 0, 0.5);
    --crt-bg: #0a0600;
    --crt-panel: rgba(22, 13, 0, 0.92);
    --crt-border: #664600;
  }
  body.theme-cyan {
    --crt-green: #00f3ff;
    --crt-dim: #007a82;
    --crt-glow: rgba(0, 243, 255, 0.5);
    --crt-bg: #00080a;
    --crt-panel: rgba(0, 18, 22, 0.92);
    --crt-border: #005a61;
  }

  * { box-sizing: border-box; }
  body {
    background: var(--crt-bg);
    color: var(--crt-green);
    font-family: "JetBrains Mono", "Courier New", Courier, monospace;
    margin: 0;
    padding: 1.2rem;
    position: relative;
    overflow-x: hidden;
  }

  body::before {
    content: " ";
    display: block;
    position: fixed;
    top: 0; left: 0; bottom: 0; right: 0;
    background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.35) 50%), linear-gradient(90deg, rgba(255,0,0,0.03), rgba(0,255,0,0.01), rgba(0,0,255,0.03));
    z-index: 100;
    background-size: 100% 3px, 6px 100%;
    pointer-events: none;
    opacity: 0.85;
  }

  body::after {
    content: " ";
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    box-shadow: inset 0 0 100px rgba(0,0,0,0.9);
    pointer-events: none;
    z-index: 101;
  }

  .container { max-width: 680px; margin: 0 auto; position: relative; z-index: 10; }
  
  .crt-glow {
    text-shadow: 0 0 2px var(--crt-green), 0 0 10px var(--crt-glow);
  }

  .ascii-banner {
    font-size: 0.65rem;
    line-height: 1.1;
    color: var(--crt-green);
    text-shadow: 0 0 5px var(--crt-glow);
    white-space: pre;
    overflow-x: auto;
    margin-bottom: 0.5rem;
  }

  .bezel-bar {
    border: 1px solid var(--crt-border);
    background: var(--crt-panel);
    padding: 0.5rem 0.8rem;
    font-size: 0.8rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .blink-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--crt-green);
    box-shadow: 0 0 8px var(--crt-green);
    animation: blink 1s infinite alternate;
    margin-right: 6px;
  }
  @keyframes blink { from { opacity: 0.2; } to { opacity: 1; } }

  .panel {
    background: var(--crt-panel);
    border: 1px solid var(--crt-border);
    box-shadow: inset 0 0 15px rgba(0,0,0,0.6), 0 0 15px rgba(0,0,0,0.5);
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .panel-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    color: var(--crt-dim);
    border-bottom: 1px dashed var(--crt-border);
    padding-bottom: 0.4rem;
    margin-bottom: 0.8rem;
    letter-spacing: 0.1em;
  }

  .val-huge {
    font-size: 2.2rem;
    font-weight: 700;
    color: var(--crt-green);
    text-shadow: 0 0 4px var(--crt-green), 0 0 14px var(--crt-glow);
  }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }

  button.crt-btn {
    background: transparent;
    color: var(--crt-green);
    border: 1px solid var(--crt-green);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: bold;
    padding: 0.8rem 1rem;
    cursor: pointer;
    text-shadow: 0 0 4px var(--crt-green);
    box-shadow: 0 0 8px rgba(0,0,0,0.5);
    transition: all 0.15s ease-in-out;
    width: 100%;
    margin-top: 0.4rem;
    text-align: center;
  }

  button.crt-btn:hover {
    background: var(--crt-green);
    color: #000;
    box-shadow: 0 0 16px var(--crt-glow);
    text-shadow: none;
  }

  button.crt-btn.active-warn {
    border-color: #ef4444;
    color: #ef4444;
    text-shadow: 0 0 5px rgba(239, 68, 68, 0.8);
  }
  button.crt-btn.active-warn:hover {
    background: #ef4444;
    color: #000;
    box-shadow: 0 0 16px rgba(239, 68, 68, 0.8);
  }

  .theme-toggle-group {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .theme-btn {
    padding: 0.3rem 0.6rem;
    font-size: 0.7rem;
    border: 1px solid var(--crt-border);
    background: transparent;
    color: var(--crt-dim);
    cursor: pointer;
  }
  .theme-btn:hover, .theme-btn.active {
    border-color: var(--crt-green);
    color: var(--crt-green);
    text-shadow: 0 0 4px var(--crt-green);
  }

  #scopeCanvas {
    width: 100%;
    height: 70px;
    background: rgba(0,0,0,0.6);
    border: 1px solid var(--crt-border);
    margin-top: 0.5rem;
  }
</style>
</head>
<body id="crtBody">
<div class="container">

  <!-- ASCII Header -->
  <pre class="ascii-banner">
  ___ ___ _   __  __ ___ _    ___ 
 / __|_ _| | |  \/  | _ \ |  / __|
 \__ \| || |_| |\/| |  _/ |_| (__ 
 |___/___|___|_|  |_|_| |____\___|
[ INDUSTRIAL DIN-RAIL UNIT // 857m // CRT & BYTEBEAT SYNTH ]</pre>

  <!-- Bezel Status Bar -->
  <div class="bezel-bar">
    <div>
      <span class="blink-dot"></span>
      <span class="crt-glow" id="netStatus">SIGINT LINK: ACTIVE</span>
    </div>
    <div style="font-size: 0.75rem; color: var(--crt-dim);" id="ipDisplay">
      IP: CONNECTING...
    </div>
  </div>

  <!-- Panel 1: Live Battery & Solar -->
  <div class="panel">
    <div class="panel-title">[ 01 // TELEMETRY LINK: VICTRON MPPT 75|15 ]</div>
    <div class="grid">
      <div>
        <div style="font-size: 0.75rem; color: var(--crt-dim);">BATTERY VOLTAGE</div>
        <div class="val-huge" id="batVolt">--.-- V</div>
        <div style="font-size: 0.75rem;" id="batBar">[░░░░░░░░░░░░░░░░░░░░]</div>
      </div>
      <div>
        <div style="font-size: 0.75rem; color: var(--crt-dim);">SOLAR HARVEST</div>
        <div class="val-huge" id="solWatt">-- W</div>
        <div style="font-size: 0.75rem; color: var(--crt-dim);" id="solYield">YIELD TODAY: -- Wh</div>
      </div>
    </div>
  </div>

  <!-- Panel 2: Inverter Interlock (Relais 1) -->
  <div class="panel">
    <div class="panel-title">[ 02 // RELAY 1: RDDSPON 6000W INTERLOCK ]</div>
    <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 0.5rem;" id="r1Status">
      STATUS: QUERYING...
    </div>
    <button class="crt-btn" id="r1Btn" onclick="toggleRelay(0)">
      [ > EXECUTE INVERTER TOGGLE < ]
    </button>
  </div>

  <!-- Panel 3: Bytebeat One-Liner Algorithmic Music Engine -->
  <div class="panel">
    <div class="panel-title">[ 03 // BYTEBEAT 8-BIT ALGORITHMIC ONELINERS ]</div>
    <div style="font-size:0.75rem; color:var(--crt-dim); margin-bottom:0.4rem;">
      FORMULA: <span style="color:var(--crt-green);" id="formulaLabel">ACID: (t>>7|t|t>>6)*10+4*(t&t>>13|t>>6)</span>
    </div>
    <canvas id="scopeCanvas" width="400" height="70"></canvas>
    <div class="grid" style="margin-top:0.6rem;">
      <button class="crt-btn" id="btnWebAudio" onclick="toggleWebBytebeat()">🕹️ [ BROWSER SOUND: OFF ]</button>
      <button class="crt-btn" id="btnHwAudio" onclick="toggleHwBytebeat()">🔊 [ HARDWARE BUZZER: OFF ]</button>
    </div>
    <div class="theme-toggle-group" style="margin-top:0.6rem;">
      <span style="font-size:0.75rem; color:var(--crt-dim); align-self:center;">FORMULA:</span>
      <button class="theme-btn formula-btn" onclick="setFormula(0, this)">SIERRA</button>
      <button class="theme-btn formula-btn" onclick="setFormula(1, this)">42-MELODY</button>
      <button class="theme-btn formula-btn" onclick="setFormula(2, this)">TECHNO</button>
      <button class="theme-btn formula-btn active" onclick="setFormula(3, this)">ACID</button>
    </div>
  </div>

  <!-- Panel 4: Hardware Deck & Themes -->
  <div class="panel">
    <div class="panel-title">[ 04 // HARDWARE DECK & CRT PHOSPHOR ]</div>
    <div class="grid">
      <button class="crt-btn" onclick="toggleRelay(1)">[ RELAY 2 AUX ]</button>
      <button class="crt-btn" onclick="cycleMode()">📺 [ LCD MODE ]</button>
    </div>
    <div class="theme-toggle-group">
      <span style="font-size:0.75rem; color:var(--crt-dim); align-self:center;">PHOSPHOR:</span>
      <button class="theme-btn active" onclick="setTheme('green')">P1-GRN</button>
      <button class="theme-btn" onclick="setTheme('amber')">P3-AMB</button>
      <button class="theme-btn" onclick="setTheme('cyan')">C64-CYN</button>
    </div>
  </div>

</div>

<script>
let audioCtx = null;
let scriptNode = null;
let isWebAudioPlaying = false;
let isHwAudioPlaying = false;
let bytebeatT = 2048; // Non-zero start so zero-intro formulas play instantly!
let currentFormula = 3; // Default to user favorite: ACID!

const formulas = [
  { name: "SIERRA: (t*((t>>9|t>>13)&15))|(t>>6)", fn: (t) => ((t * ((t >> 9 | t >> 13) & 15)) | (t >> 6)) & 0xFF },
  { name: "42-MELODY: t*(42&(t>>7|t>>10))", fn: (t) => (t * (42 & (t >> 7 | t >> 10))) & 0xFF },
  { name: "TECHNO: (t>>5|t>>8)*14+((t>>9)&3)*60", fn: (t) => (((t >> 5 | t >> 8) * 14 + ((t >> 9) & 3) * 60)) & 0xFF },
  { name: "ACID: (t>>7|t|t>>6)*10+4*(t&t>>13|t>>6)", fn: (t) => (((t >> 7 | t | t >> 6) * 10 + 4 * (t & (t >> 13) | (t >> 6)))) & 0xFF }
];

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 8000 });
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function toggleWebBytebeat() {
  initAudio();
  isWebAudioPlaying = !isWebAudioPlaying;
  const btn = document.getElementById('btnWebAudio');
  if (isWebAudioPlaying) {
    btn.innerText = "🕹️ [ BROWSER SOUND: ACTIVE ]";
    btn.style.background = "var(--crt-green)";
    btn.style.color = "#000";

    scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
    scriptNode.onaudioprocess = function(e) {
      const output = e.outputBuffer.getChannelData(0);
      const fn = formulas[currentFormula].fn;
      for (let i = 0; i < output.length; i++) {
        const val = fn(bytebeatT++);
        output[i] = ((val / 128.0) - 1.0) * 0.35;
      }
    };
    scriptNode.connect(audioCtx.destination);
  } else {
    btn.innerText = "🕹️ [ BROWSER SOUND: OFF ]";
    btn.style.background = "transparent";
    btn.style.color = "var(--crt-green)";
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode = null;
    }
  }
}

async function toggleHwBytebeat() {
  isHwAudioPlaying = !isHwAudioPlaying;
  const btn = document.getElementById('btnHwAudio');
  btn.innerText = isHwAudioPlaying ? "🔊 [ HARDWARE BUZZER: ACTIVE ]" : "🔊 [ HARDWARE BUZZER: OFF ]";
  btn.style.background = isHwAudioPlaying ? "var(--crt-green)" : "transparent";
  btn.style.color = isHwAudioPlaying ? "#000" : "var(--crt-green)";
  await fetch('/api/bytebeat?action=' + (isHwAudioPlaying ? 'on' : 'off') + '&f=' + currentFormula);
}

function setFormula(idx, btn) {
  currentFormula = idx;
  bytebeatT = 2048; // Reset with offset so it starts instantly!
  document.getElementById('formulaLabel').innerText = formulas[idx].name;
  document.querySelectorAll('.formula-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const btns = document.querySelectorAll('.formula-btn');
    if (btns[idx]) btns[idx].classList.add('active');
  }
  fetch('/api/bytebeat?action=' + (isHwAudioPlaying ? 'on' : 'keep') + '&f=' + currentFormula);
}

const canvas = document.getElementById('scopeCanvas');
const ctx = canvas.getContext('2d');
function drawScope() {
  requestAnimationFrame(drawScope);
  ctx.fillStyle = "rgba(4, 18, 7, 0.4)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--crt-green') || '#39ff14';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const fn = formulas[currentFormula].fn;
  const t_base = bytebeatT;
  for (let x = 0; x < canvas.width; x += 2) {
    const val = fn(t_base + x * 4);
    const y = (canvas.height / 2) + ((val - 128) / 128) * 28;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
drawScope();

async function updateUI() {
  try {
    const res = await fetch('/api/status');
    const d = await res.json();
    document.getElementById('batVolt').innerText = d.battery_voltage.toFixed(2) + ' V';
    document.getElementById('solWatt').innerText = d.solar_power + ' W';
    document.getElementById('solYield').innerText = 'YIELD: ' + d.yield_today_wh + ' Wh';
    document.getElementById('ipDisplay').innerText = 'IP: ' + d.ip;

    const v = d.battery_voltage;
    const pct = Math.max(0, Math.min(100, Math.round(((v - 11.6) / 1.15) * 100)));
    const filled = Math.round(pct / 5);
    const empty = 20 - filled;
    document.getElementById('batBar').innerText = '[' + '█'.repeat(filled) + '░'.repeat(empty) + '] ' + pct + '%';

    const r1 = document.getElementById('r1Status');
    const b1 = document.getElementById('r1Btn');
    if (d.relay1) {
      r1.innerText = 'STATUS: ACTIVE [INVERTER ON]';
      r1.style.color = 'var(--crt-green)';
      b1.className = 'crt-btn active-warn';
      b1.innerText = '[ CUT POWER: FORCE INVERTER OFF ]';
    } else {
      r1.innerText = 'STATUS: SLEEP [INVERTER ISOLATED]';
      r1.style.color = '#ef4444';
      b1.className = 'crt-btn';
      b1.innerText = '[ ENGAGE INVERTER (RELAY ARMED) ]';
    }

    if (d.bytebeat !== undefined && d.bytebeat !== isHwAudioPlaying) {
      isHwAudioPlaying = d.bytebeat;
      const hb = document.getElementById('btnHwAudio');
      hb.innerText = isHwAudioPlaying ? "🔊 [ HARDWARE BUZZER: ACTIVE ]" : "🔊 [ HARDWARE BUZZER: OFF ]";
      hb.style.background = isHwAudioPlaying ? "var(--crt-green)" : "transparent";
      hb.style.color = isHwAudioPlaying ? "#000" : "var(--crt-green)";
    }

    if (d.bytebeat_formula !== undefined && d.bytebeat_formula !== currentFormula) {
      currentFormula = d.bytebeat_formula;
      document.getElementById('formulaLabel').innerText = formulas[currentFormula].name;
      const fbtns = document.querySelectorAll('.formula-btn');
      fbtns.forEach((b, i) => b.classList.toggle('active', i === currentFormula));
    }
  } catch(e) {}
}

async function toggleRelay(ch) {
  await fetch('/api/relay?ch=' + ch + '&action=toggle');
  updateUI();
}

async function cycleMode() {
  await fetch('/api/mode');
}

function setTheme(theme) {
  document.body.className = (theme === 'green') ? '' : 'theme-' + theme;
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

setInterval(updateUI, 2000);
updateUI();
</script>
</body>
</html>
)rawliteral";

void handleRoot() {
    server.send_P(200, "text/html", INDEX_HTML);
}

void handleStatusApi() {
    StaticJsonDocument<512> doc;
    doc["battery_voltage"] = live_telemetry.online ? live_telemetry.battery_voltage : 12.64;
    doc["solar_power"] = live_telemetry.solar_power;
    doc["yield_today_wh"] = live_telemetry.yield_today_wh;
    doc["relay1"] = relay1_state;
    doc["relay2"] = relay2_state;
    doc["anim_mode"] = anim_mode;
    doc["bytebeat"] = bytebeat_hw_playing;
    doc["bytebeat_formula"] = bytebeat_formula;
    doc["fps"] = fps;
    doc["online"] = live_telemetry.online;
    doc["ip"] = WiFi.localIP().toString();

    String json;
    serializeJson(doc, json);
    server.send(200, "application/json", json);
}

void handleRelayApi() {
    int ch = server.hasArg("ch") ? server.arg("ch").toInt() : 0;
    String action = server.hasArg("action") ? server.arg("action") : "toggle";

    if (ch == 0) {
        if (action == "on") relay1_state = true;
        else if (action == "off") relay1_state = false;
        else relay1_state = !relay1_state;

        M5StamPLC.writePlcRelay(0, relay1_state);
        if (relay1_state) {
            M5StamPLC.setStatusLight(0, 255, 0);
            playClickBeep(1800, 60);
        } else {
            M5StamPLC.setStatusLight(255, 0, 0);
            playClickBeep(900, 80);
        }
    } else if (ch == 1) {
        if (action == "on") relay2_state = true;
        else if (action == "off") relay2_state = false;
        else relay2_state = !relay2_state;

        M5StamPLC.writePlcRelay(1, relay2_state);
        playClickBeep(1400, 50);
    }
    server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void handleBytebeatApi() {
    String action = server.hasArg("action") ? server.arg("action") : "toggle";
    if (server.hasArg("f")) {
        bytebeat_formula = server.arg("f").toInt() % 4;
        bytebeat_t = 2048; // Reset with offset
    }
    if (action == "on") bytebeat_hw_playing = true;
    else if (action == "off") {
        bytebeat_hw_playing = false;
        M5StamPLC.noTone();
    } else if (action == "toggle") {
        bytebeat_hw_playing = !bytebeat_hw_playing;
        if (!bytebeat_hw_playing) M5StamPLC.noTone();
    }

    server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void handleModeApi() {
    anim_mode = (anim_mode + 1) % 4;
    playClickBeep(1500, 40);
    server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void setup() {
    M5StamPLC.begin();

    current_rotation = 0;
    M5StamPLC.Display().setRotation(current_rotation);
    M5StamPLC.Display().setBrightness(180);

    SCREEN_W = M5StamPLC.Display().width();
    SCREEN_H = M5StamPLC.Display().height();

    canvas.setColorDepth(16);
    canvas.createSprite(SCREEN_W, SCREEN_H);

    initStars();

    M5StamPLC.writePlcRelay(0, false);
    M5StamPLC.writePlcRelay(1, false);
    M5StamPLC.setStatusLight(255, 0, 0);

    playBootJingle();

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    server.on("/", handleRoot);
    server.on("/api/status", handleStatusApi);
    server.on("/api/relay", handleRelayApi);
    server.on("/api/bytebeat", handleBytebeatApi);
    server.on("/api/mode", handleModeApi);
    server.begin();

    if (MDNS.begin(MDNS_HOST)) {
        MDNS.addService("http", "tcp", 80);
    }
}

void loop() {
    M5StamPLC.update();
    server.handleClient();

    // Button A: Toggle Relay 1
    if (M5StamPLC.BtnA().wasClicked()) {
        relay1_state = !relay1_state;
        M5StamPLC.writePlcRelay(0, relay1_state);
        if (relay1_state) {
            M5StamPLC.setStatusLight(0, 255, 0);
            playClickBeep(1800, 60);
        } else {
            M5StamPLC.setStatusLight(255, 0, 0);
            playClickBeep(900, 80);
        }
    }

    // Button B: Toggle Relay 2 OR Cycle Bytebeat Formula when in Mode 3 (Scope)
    if (M5StamPLC.BtnB().wasClicked()) {
        if (anim_mode == 3) {
            bytebeat_formula = (bytebeat_formula + 1) % 4;
            bytebeat_t = 2048;
            playClickBeep(1800, 40);
        } else {
            relay2_state = !relay2_state;
            M5StamPLC.writePlcRelay(1, relay2_state);
            playClickBeep(1400, 50);
        }
    }

    // Button C: Cycle Animation Modes (or Hold to toggle hardware Bytebeat!)
    if (M5StamPLC.BtnC().wasHold()) {
        bytebeat_hw_playing = !bytebeat_hw_playing;
        if (!bytebeat_hw_playing) {
            M5StamPLC.noTone();
        } else {
            anim_mode = 3;
            bytebeat_t = 2048;
        }
    } else if (M5StamPLC.BtnC().wasClicked()) {
        anim_mode = (anim_mode + 1) % 4;
        playClickBeep(1500, 40);
    }

    // Hardware Bytebeat Audio Loop (Fast 12ms tick rate, advancing t by 16 per tick)
    if (bytebeat_hw_playing) {
        if (millis() - last_bytebeat_tick >= 12) {
            last_bytebeat_tick = millis();
            bytebeat_t += 16; // Fast clock progression
            uint8_t sample = calcBytebeat(bytebeat_t, bytebeat_formula);

            // Resonant piezo frequency mapping
            if (sample > 6) {
                int freq = 350 + (sample * 10);
                M5StamPLC.tone(freq, 11);
            } else {
                M5StamPLC.noTone();
            }
        }
    }

    // Fetch live telemetry from cellar station every 4 seconds
    if (millis() - last_telemetry_fetch >= 4000) {
        last_telemetry_fetch = millis();
        fetchLiveTelemetry();
    }

    // Render Canvas
    canvas.fillScreen(TFT_BLACK);

    if (anim_mode == 0) {
        drawCyberCube();
    } else if (anim_mode == 1) {
        drawPlasmaWaves();
    } else if (anim_mode == 2) {
        drawRandeSolarHUD();
    } else {
        drawBytebeatScope();
    }

    // Top/Bottom HUD overlays (Mode 0 & 1)
    if (anim_mode < 2) {
        canvas.setTextSize(1);
        canvas.setTextColor(TFT_CYAN);
        canvas.setCursor(6, 6);
        canvas.printf("STAMPLC");

        canvas.setTextColor(live_telemetry.online ? TFT_GREEN : TFT_YELLOW);
        canvas.setCursor(140, 6);
        if (live_telemetry.online) {
            canvas.printf("%.2fV", live_telemetry.battery_voltage);
        } else {
            canvas.printf("[NET...]");
        }

        canvas.drawFastHLine(0, SCREEN_H - 17, SCREEN_W, TFT_DARKCYAN);

        canvas.setTextColor(relay1_state ? TFT_GREEN : TFT_RED);
        canvas.setCursor(6, SCREEN_H - 12);
        canvas.printf("R1:%s", relay1_state ? "ON " : "OFF");

        canvas.setTextColor(relay2_state ? TFT_GREEN : TFT_DARKGREY);
        canvas.setCursor(55, SCREEN_H - 12);
        canvas.printf("R2:%s", relay2_state ? "ON " : "OFF");

        canvas.setTextColor(TFT_SKYBLUE);
        canvas.setCursor(105, SCREEN_H - 12);
        canvas.printf("M%d", anim_mode + 1);

        canvas.setTextColor(TFT_YELLOW);
        canvas.setCursor(170, SCREEN_H - 12);
        canvas.printf("%2.0fFPS", fps);
    }

    canvas.pushSprite(0, 0);

    frame_count++;
    if (millis() - last_fps_time >= 500) {
        fps = (frame_count * 1000.0f) / (millis() - last_fps_time);
        frame_count = 0;
        last_fps_time = millis();
    }

    delay(10);
}
