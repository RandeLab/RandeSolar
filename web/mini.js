// M5Stack StamPLC 1.14" Hardware Display Simulator ("Mini")
// Pixel-accurate replication of StamPLC firmware graphics, states & sound

const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 135;

// Audio Context for Piezo Buzzer Emulation
let audioCtx = null;
let soundEnabled = true;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, durationMs) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle'; // Crisp retro piezoelectric buzzer
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (durationMs / 1000));

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + (durationMs / 1000));
  } catch (e) {
    console.warn('Audio tone error:', e);
  }
}

// Hardware State Variables (Mirrors stamplc_main.cpp)
let g_lcd_page = 0; // 0=Coconut, 1=Solar, 2=Network, 3=5G, 4=Meteo, 5=Temp
let g_relay1_inverter = false;
let g_led_strip_on = true;
let g_autarkyMode = true;
let g_lastActivity = "";
let g_lastActivityColor = "#00f5ff";
let g_lastActivityTime = 0;
let g_lastSyncEpochMs = Date.now();
let g_mqttConnected = false;

// Telemetry State
let g_data = {
  solar_power: 0,
  battery_voltage: 12.85,
  battery_current: 0.0,
  yield_today_wh: 0,
  external_load: 0.0,
  charge_state: 0,
  state_str: 'OFF',
  rssi: -74,
  wifi_ssid: 'RandeLab-Main',
  ip: '192.168.1.100',
  gw_ping_ms: 12,
  buffered_records: 0,
  cell_operator: 'GoMo',
  cell_mode: '5G NSA',
  cell_band: 'n78/B3',
  cell_rsrp: -78,
  cell_sinr: 18,
  cell_temp: 34.2,
  cell_down_mbps: 0,
  cell_up_mbps: 0,
  wx_temp: 8.4,
  wx_solar_wm2: 0,
  wx_cloud_pct: 75,
  wx_rain_mm: 0.0,
  wx_humidity: 78,
  wx_wind_kmh: 12.4,
  wx_pressure: 924.5,
  temp_dallas1: 10.9,
  temp_dallas2: -999,
  temp_plc: 24.5
};

// Colors (Matches TFT_* colors from ST7789 display)
const TFT_BLACK     = "#000000";
const TFT_WHITE     = "#FFFFFF";
const TFT_YELLOW    = "#FFD400";
const TFT_GREEN     = "#00E676";
const TFT_DARKGREEN = "#007A3D";
const TFT_CYAN      = "#00F5FF";
const TFT_RED       = "#FF1744";
const TFT_MAROON    = "#800000";
const TFT_NAVY      = "#0b1d3a";
const TFT_LIGHTGREY = "#D4D4D4";
const TFT_DARKGREY  = "#4a5568";
const TFT_ORANGE    = "#FF9100";

// RandeChistli 7-Segment Color Table (Pixel 7 Bottom to Pixel 1 Top)
const CHISTLI_COLORS = [
  "rgb(0, 30, 225)",   // Pixel 7 (~4°C):  Deep Electric Blue
  "rgb(0, 111, 144)",  // Pixel 6 (~8°C):  Cyan-Blue
  "rgb(0, 189, 66)",   // Pixel 5 (~13°C): Teal / Aqua-Green
  "rgb(15, 240, 0)",   // Pixel 4 (~17°C): Lime Green
  "rgb(93, 162, 0)",   // Pixel 3 (~21°C): Yellow-Amber
  "rgb(174, 81, 0)",   // Pixel 2 (~25°C): Orange-Flame
  "rgb(252, 3, 0)"     // Pixel 1 (~30°C): Hot Red
];

function setLcdActivity(text, color = "#00f5ff") {
  g_lastActivity = text;
  g_lastActivityColor = color;
  g_lastActivityTime = Date.now();
  renderLcdDashboard();
}

function getChargeStateName(state) {
  switch (Number(state)) {
    case 0: return "OFF";
    case 2: return "FAULT";
    case 3: return "BULK";
    case 4: return "ABSORPTION";
    case 5: return "FLOAT";
    case 252: return "EXT CONTROL";
    default: return "OFF";
  }
}

// ==================== LCD GRAPHICS RENDERING ====================
let canvas, ctx;

function initDisplay() {
  canvas = document.getElementById('lcdCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  renderLcdDashboard();
}

function drawLcdHeader(title, pageStr) {
  ctx.fillStyle = TFT_BLACK;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Top Left Header
  ctx.fillStyle = TFT_CYAN;
  ctx.font = '700 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${title} ${pageStr}`, 4, 12);

  // Top Right Activity / Autarky Tag (x=136..238)
  const now = Date.now();
  if (now - g_lastActivityTime < 3000) {
    ctx.fillStyle = g_lastActivityColor;
    ctx.fillRect(136, 2, 100, 14);
    ctx.fillStyle = TFT_BLACK;
    ctx.font = '800 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(g_lastActivity, 186, 12);
  } else {
    // Autarky Timer Header
    const elapsedSec = Math.max(0, Math.floor((now - g_lastSyncEpochMs) / 1000));
    const cycleSec = 3600;
    const burstSec = 300;
    const inBurst = g_relay1_inverter || (elapsedSec < burstSec);

    if (inBurst) {
      ctx.fillStyle = TFT_DARKGREEN;
      ctx.fillRect(136, 2, 100, 14);
      ctx.fillStyle = TFT_WHITE;
      ctx.font = '800 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const remSec = Math.max(0, burstSec - (elapsedSec % burstSec));
      ctx.fillText(`AUTARK: ${remSec}s`, 186, 12);
    } else {
      ctx.fillStyle = TFT_NAVY;
      ctx.fillRect(136, 2, 100, 14);
      ctx.fillStyle = TFT_CYAN;
      ctx.font = '800 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const remMin = Math.ceil(Math.max(0, cycleSec - (elapsedSec % cycleSec)) / 60);
      ctx.fillText(`AUTARK: in ${remMin}m`, 186, 12);
    }
  }

  // Header Divider
  ctx.fillStyle = TFT_DARKGREY;
  ctx.fillRect(0, 18, CANVAS_WIDTH, 1);
}

function drawRandeChistliTempBar(barX, startY, barW, segH, segGap, temp) {
  let tLong = Math.round(temp);
  if (tLong < 4) tLong = 4;
  if (tLong > 30) tLong = 30;
  let showPixel = Math.round((tLong - 4) * (1 - 7) / (30 - 4) + 7);
  if (showPixel < 1) showPixel = 1;
  if (showPixel > 7) showPixel = 7;
  let activeFromBottom = 7 - showPixel + 1;

  for (let i = 0; i < 7; i++) {
    const segIdx = 6 - i;
    const y = startY + i * (segH + segGap);
    const color = CHISTLI_COLORS[segIdx];

    if (segIdx + 1 <= activeFromBottom) {
      ctx.fillStyle = color;
      ctx.fillRect(barX, y, barW, segH);
      if (segIdx + 1 === activeFromBottom) {
        // Top active segment highlight
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, y, barW, segH);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(barX + 3, y + 2, barW - 6, segH - 4);
      }
    } else {
      ctx.fillStyle = '#17202a';
      ctx.fillRect(barX, y, barW, segH);
      ctx.strokeStyle = '#2c3e50';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, y, barW, segH);
    }
  }

  // Pixel 0 Status LED at bottom
  const statusY = startY + 7 * (segH + segGap) + 1;
  ctx.fillStyle = '#55ff55';
  ctx.fillRect(barX, statusY, barW, segH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(barX + 4, statusY + 2, barW - 8, segH - 4);

  // Temperature readout above VU bar
  if (temp > -40) {
    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(temp)}C`, barX - 1, startY - 4);
  }
}

function drawNeonCoconutLogo(cx, cy, v, a, load, state) {
  // Determine active teeth based on battery voltage / state
  let activeTeeth = 0;
  if (state === 5 || v >= 13.0) activeTeeth = 7;
  else if (v >= 12.6) activeTeeth = 6;
  else if (v >= 12.4) activeTeeth = 5;
  else if (v >= 12.2) activeTeeth = 4;
  else if (v >= 12.0) activeTeeth = 3;
  else if (v >= 11.8) activeTeeth = 2;
  else activeTeeth = 1;

  // Colors
  const brightPink = '#ff1e96';
  const dimPink    = '#661a40';

  let cocoColor = '#00dcff'; // Default standby ice blue
  if (state === 3) cocoColor = '#39ff14'; // Bulk neon spring green
  else if (state === 4) cocoColor = '#ffdc00'; // Absorption gold
  else if (state === 5) cocoColor = '#00ffff'; // Float cyan

  // Pinion Wheel Teeth (7 teeth around coconut)
  const teethDeg = [135, 180, 225, 270, 315, 360, 405];
  const R_OUT = 47;
  const R_IN  = 36;
  const DEG_TO_RAD = Math.PI / 180;

  for (let i = 0; i < 7; i++) {
    const isBright = i < activeTeeth;
    ctx.strokeStyle = isBright ? brightPink : dimPink;
    ctx.lineWidth = isBright ? 2.5 : 1.5;

    const tRad = teethDeg[i] * DEG_TO_RAD;
    const hw = 9 * DEG_TO_RAD;
    const rw = 14 * DEG_TO_RAD;

    const pV1X = cx + R_IN  * Math.cos(tRad - rw);
    const pV1Y = cy + R_IN  * Math.sin(tRad - rw);
    const pC1X = cx + R_OUT * Math.cos(tRad - hw);
    const pC1Y = cy + R_OUT * Math.sin(tRad - hw);
    const pC2X = cx + R_OUT * Math.cos(tRad + hw);
    const pC2Y = cy + R_OUT * Math.sin(tRad + hw);
    const pV2X = cx + R_IN  * Math.cos(tRad + rw);
    const pV2Y = cy + R_IN  * Math.sin(tRad + rw);

    ctx.beginPath();
    ctx.moveTo(pV1X, pV1Y);
    ctx.lineTo(pC1X, pC1Y);
    ctx.lineTo(pC2X, pC2Y);
    ctx.lineTo(pV2X, pV2Y);
    ctx.stroke();
  }

  // Coconut Outline Body
  ctx.strokeStyle = cocoColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0.3 * Math.PI, 1.8 * Math.PI);
  ctx.stroke();

  // Straw in Electric Yellow
  ctx.strokeStyle = '#ffff32';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx + 8, cy - 14);
  ctx.lineTo(cx + 28, cy - 42);
  ctx.stroke();
}

function renderLcdDashboard() {
  if (!ctx) return;

  if (g_lcd_page === 0) {
    // ==================== PAGE 0: COCONUT ====================
    ctx.fillStyle = TFT_BLACK;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Neon Coconut Logo in Center
    drawNeonCoconutLogo(120, 56, g_data.battery_voltage, g_data.battery_current, g_data.external_load, g_data.charge_state);

    // RandeChistli 8-pixel Temperature Bar on Left
    const currentTemp = (g_data.temp_dallas1 > -50) ? g_data.temp_dallas1 : g_data.temp_plc;
    drawRandeChistliTempBar(10, 17, 12, 9, 3, currentTemp);

    // Bottom Navigation Line
    ctx.fillStyle = TFT_DARKGREY;
    ctx.fillRect(0, 118, CANVAS_WIDTH, 1);

    ctx.font = '800 10px "JetBrains Mono", monospace';
    // Btn A: Inverter State
    ctx.fillStyle = g_relay1_inverter ? TFT_GREEN : TFT_RED;
    ctx.textAlign = 'left';
    ctx.fillText(`[A]INV:${g_relay1_inverter ? 'ON' : 'OFF'}`, 4, 129);

    // Btn B: Next
    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.textAlign = 'center';
    ctx.fillText("[B] Next >", 120, 129);

    // Btn C: Strip State
    ctx.fillStyle = g_led_strip_on ? TFT_YELLOW : TFT_DARKGREY;
    ctx.textAlign = 'right';
    ctx.fillText(`[C]STRIP:${g_led_strip_on ? 'ON' : 'OFF'}`, 236, 129);

  } else if (g_lcd_page === 1) {
    // ==================== PAGE 1: SOLAR & BATTERY ====================
    drawLcdHeader("RANDESOLAR", "[P1/5]");

    // Row 1: Solar Power (Watts) & Daily Yield (Wh)
    ctx.fillStyle = TFT_YELLOW;
    ctx.font = '900 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(g_data.solar_power)}W`, 4, 42);

    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.font = '700 14px "JetBrains Mono", monospace';
    ctx.fillText(`${Math.round(g_data.yield_today_wh)}Wh`, 115, 38);

    // Row 2: Battery Voltage & Current
    const v = g_data.battery_voltage;
    const vColor = (v >= 12.8) ? TFT_GREEN : ((v >= 11.8) ? TFT_ORANGE : TFT_RED);
    ctx.fillStyle = vColor;
    ctx.font = '900 24px "JetBrains Mono", monospace';
    ctx.fillText(`${v.toFixed(2)}V`, 4, 72);

    ctx.fillStyle = TFT_WHITE;
    ctx.font = '700 14px "JetBrains Mono", monospace';
    const currStr = (g_data.battery_current >= 0 ? '+' : '') + Number(g_data.battery_current).toFixed(1) + 'A';
    ctx.fillText(currStr, 120, 68);

    ctx.fillStyle = TFT_DARKGREY;
    ctx.fillRect(0, 80, CANVAS_WIDTH, 1);

    // Row 3: Charge State & BLE RSSI
    ctx.fillStyle = TFT_CYAN;
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillText(getChargeStateName(g_data.charge_state), 4, 98);

    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.textAlign = 'right';
    ctx.fillText(`${g_data.rssi}dBm`, 236, 98);

    // Footer
    ctx.fillStyle = TFT_DARKGREY;
    ctx.fillRect(0, 108, CANVAS_WIDTH, 1);
    ctx.font = '800 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = g_relay1_inverter ? TFT_GREEN : TFT_RED;
    ctx.fillText(`[A]INV:${g_relay1_inverter ? 'ON' : 'OFF'}`, 4, 124);
    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.textAlign = 'center';
    ctx.fillText("[B] Next P2", 120, 124);
    ctx.fillStyle = TFT_GREEN;
    ctx.textAlign = 'right';
    ctx.fillText("[C] Refresh", 236, 124);

  } else if (g_lcd_page === 2) {
    // ==================== PAGE 2: NETWORK & SYNC ====================
    drawLcdHeader("NETWORK & SYNC", "[P2/5]");

    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = TFT_WHITE;
    ctx.fillText(`WiFi: ${g_data.wifi_ssid}`, 4, 36);

    ctx.fillText(`IP: ${g_data.ip}`, 4, 56);

    ctx.fillStyle = g_mqttConnected ? TFT_GREEN : TFT_RED;
    ctx.fillText(`MQTT: ${g_mqttConnected ? 'CONNECTED' : 'STANDBY'}`, 4, 76);

    ctx.fillStyle = TFT_WHITE;
    ctx.fillText(`Buf:${g_data.buffered_records}rec Ping:${g_data.gw_ping_ms}ms`, 4, 96);

    // Footer
    ctx.fillStyle = TFT_DARKGREY;
    ctx.fillRect(0, 108, CANVAS_WIDTH, 1);
    ctx.font = '800 10px "JetBrains Mono", monospace';
    ctx.fillStyle = TFT_YELLOW;
    ctx.fillText("[A] Menu", 4, 124);
    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.textAlign = 'center';
    ctx.fillText("[B] Next P3", 120, 124);
    ctx.fillStyle = TFT_GREEN;
    ctx.textAlign = 'right';
    ctx.fillText("[C] Refresh", 236, 124);

  } else if (g_lcd_page === 3) {
    // ==================== PAGE 3: TELTONIKA 5G ====================
    drawLcdHeader("TELTONIKA 5G", "[P3/5]");

    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = TFT_CYAN;
    ctx.fillText(`${g_data.cell_operator} • ${g_data.cell_mode}`, 4, 36);

    ctx.fillStyle = TFT_WHITE;
    ctx.fillText(`Band: ${g_data.cell_band}`, 4, 56);

    ctx.fillStyle = TFT_GREEN;
    ctx.fillText(`RSRP:${g_data.cell_rsrp} SINR:${g_data.cell_sinr}dB`, 4, 76);

    ctx.fillStyle = TFT_YELLOW;
    if (g_data.cell_down_mbps > 0) {
      ctx.fillText(`Spd: ${Math.round(g_data.cell_down_mbps)}M v / ${Math.round(g_data.cell_up_mbps)}M ^`, 4, 96);
    } else {
      ctx.fillText(`Modem Temp: ${Number(g_data.cell_temp).toFixed(1)} C`, 4, 96);
    }

    // Footer
    ctx.fillStyle = TFT_DARKGREY;
    ctx.fillRect(0, 108, CANVAS_WIDTH, 1);
    ctx.font = '800 10px "JetBrains Mono", monospace';
    ctx.fillStyle = TFT_YELLOW;
    ctx.fillText("[A] Ping", 4, 124);
    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.textAlign = 'center';
    ctx.fillText("[B] Next P4", 120, 124);
    ctx.fillStyle = TFT_GREEN;
    ctx.textAlign = 'right';
    ctx.fillText("[C] Refresh", 236, 124);

  } else if (g_lcd_page === 4) {
    // ==================== PAGE 4: WEATHER & MICROCLIMATE ====================
    drawLcdHeader("METEO • 857m", "[P4/5]");

    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = TFT_CYAN;
    ctx.fillText(`Temp: ${Number(g_data.wx_temp).toFixed(1)} C`, 4, 36);

    ctx.fillStyle = TFT_YELLOW;
    ctx.fillText(`${Math.round(g_data.wx_solar_wm2)}W/m2`, 130, 36);

    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.fillText(`Cloud:${g_data.wx_cloud_pct}% Rain:${Number(g_data.wx_rain_mm).toFixed(1)}`, 4, 56);

    ctx.fillStyle = TFT_WHITE;
    ctx.fillText(`Hum:${g_data.wx_humidity}% Wind:${Number(g_data.wx_wind_kmh).toFixed(1)}`, 4, 76);

    ctx.fillStyle = TFT_GREEN;
    ctx.fillText(`Baro: ${Number(g_data.wx_pressure).toFixed(1)} hPa`, 4, 96);

    // Footer
    ctx.fillStyle = TFT_DARKGREY;
    ctx.fillRect(0, 108, CANVAS_WIDTH, 1);
    ctx.font = '800 10px "JetBrains Mono", monospace';
    ctx.fillStyle = TFT_YELLOW;
    ctx.fillText("[A] Sync WX", 4, 124);
    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.textAlign = 'center';
    ctx.fillText("[B] Next P5", 120, 124);
    ctx.fillStyle = TFT_GREEN;
    ctx.textAlign = 'right';
    ctx.fillText("[C] Refresh", 236, 124);

  } else if (g_lcd_page === 5) {
    // ==================== PAGE 5: DALLAS 1-WIRE TEMPERATURES ====================
    drawLcdHeader("TEMPERATURE • 857m", "[P5/5]");

    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = TFT_YELLOW;
    ctx.fillText("PROBE 1 (STUBLI)", 4, 30);

    ctx.fillStyle = TFT_GREEN;
    ctx.font = '900 28px "JetBrains Mono", monospace';
    const t1 = (g_data.temp_dallas1 > -50) ? Number(g_data.temp_dallas1).toFixed(1) + ' C' : '--.- C';
    ctx.fillText(t1, 4, 60);

    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.fillText("ID: 28AA4567000000FF • DS18B20", 4, 76);

    ctx.fillStyle = TFT_CYAN;
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillText(`PLC Board: ${Number(g_data.temp_plc).toFixed(1)} C`, 4, 96);

    // Footer
    ctx.fillStyle = TFT_DARKGREY;
    ctx.fillRect(0, 108, CANVAS_WIDTH, 1);
    ctx.font = '800 10px "JetBrains Mono", monospace';
    ctx.fillStyle = TFT_YELLOW;
    ctx.fillText("[A] Scan", 4, 124);
    ctx.fillStyle = TFT_LIGHTGREY;
    ctx.textAlign = 'center';
    ctx.fillText("[B] Next P0", 120, 124);
    ctx.fillStyle = TFT_GREEN;
    ctx.textAlign = 'right';
    ctx.fillText("[C] Refresh", 236, 124);
  }

  updateHardwareControlsUI();
}

function updateHardwareControlsUI() {
  // Update WS2812 RGB LED indicator
  const ledPip = document.getElementById('ws2812Led');
  if (ledPip) {
    let color = '#00dcff'; // Standby petrol
    let shadow = '0 0 12px #00dcff';
    if (g_data.solar_power > 0) {
      color = '#ffd400';
      shadow = '0 0 14px #ffd400';
    } else if (g_data.charge_state === 5) {
      color = '#00e676';
      shadow = '0 0 14px #00e676';
    } else if (g_data.charge_state === 4) {
      color = '#00f5ff';
      shadow = '0 0 14px #00f5ff';
    } else if (g_data.charge_state === 3) {
      color = '#a855f7';
      shadow = '0 0 14px #a855f7';
    }
    ledPip.style.backgroundColor = color;
    ledPip.style.boxShadow = shadow;
  }

  // Update quick pills
  for (let i = 0; i < 6; i++) {
    const pill = document.getElementById(`pillP${i}`);
    if (pill) {
      if (i === g_lcd_page) pill.classList.add('active');
      else pill.classList.remove('active');
    }
  }

  // Update button sub-labels
  const subA = document.getElementById('subLabelA');
  if (subA) {
    if (g_lcd_page === 0 || g_lcd_page === 1) {
      subA.textContent = g_relay1_inverter ? "[A] 230V INVERTER: ON" : "[A] 230V INVERTER: OFF";
    } else if (g_lcd_page === 2) {
      subA.textContent = "[A] WI-FI MENU";
    } else if (g_lcd_page === 3) {
      subA.textContent = "[A] PING TEST";
    } else if (g_lcd_page === 4) {
      subA.textContent = "[A] WX SYNC";
    } else if (g_lcd_page === 5) {
      subA.textContent = "[A] SCAN 1-WIRE";
    }
  }

  const subB = document.getElementById('subLabelB');
  if (subB) {
    subB.textContent = `[B] NEXT SCREEN (${g_lcd_page}/5)`;
  }

  const subC = document.getElementById('subLabelC');
  if (subC) {
    if (g_lcd_page === 0) {
      subC.textContent = g_led_strip_on ? "[C] 12V STRIP: ON" : "[C] 12V STRIP: OFF";
    } else {
      subC.textContent = "[C] CLOUD REFRESH";
    }
  }
}

// ==================== BUTTON ACTIONS (A, B, C) ====================
function handleButtonA() {
  const btnEl = document.getElementById('btnA');
  if (btnEl) btnEl.classList.add('pressed');
  setTimeout(() => { if (btnEl) btnEl.classList.remove('pressed'); }, 140);

  if (g_lcd_page === 0 || g_lcd_page === 1) {
    g_relay1_inverter = !g_relay1_inverter;
    if (g_relay1_inverter) {
      playTone(1800, 60);
      setLcdActivity("INV: ON", TFT_GREEN);
    } else {
      playTone(900, 80);
      setLcdActivity("INV: OFF", TFT_RED);
    }
  } else if (g_lcd_page === 2) {
    playTone(1600, 60);
    setLcdActivity("WIFI MENU", TFT_YELLOW);
  } else if (g_lcd_page === 3) {
    playTone(2000, 60);
    setLcdActivity("PING TEST", TFT_YELLOW);
  } else if (g_lcd_page === 4) {
    playTone(2200, 60);
    setLcdActivity("WX SYNC", TFT_CYAN);
  } else if (g_lcd_page === 5) {
    playTone(2400, 60);
    setLcdActivity("SCAN 1WIRE", TFT_YELLOW);
  }
  renderLcdDashboard();
}

function handleButtonB() {
  const btnEl = document.getElementById('btnB');
  if (btnEl) btnEl.classList.add('pressed');
  setTimeout(() => { if (btnEl) btnEl.classList.remove('pressed'); }, 140);

  g_lcd_page = (g_lcd_page + 1) % 6;
  playTone(1400, 40);

  const act = (g_lcd_page === 0) ? "COCONUT" : `PAGE ${g_lcd_page}/5`;
  setLcdActivity(act, TFT_CYAN);
}

function handleButtonC() {
  const btnEl = document.getElementById('btnC');
  if (btnEl) btnEl.classList.add('pressed');
  setTimeout(() => { if (btnEl) btnEl.classList.remove('pressed'); }, 140);

  if (g_lcd_page === 0) {
    g_led_strip_on = !g_led_strip_on;
    if (g_led_strip_on) {
      playTone(2000, 60);
      setLcdActivity("STRIP: ON", TFT_YELLOW);
    } else {
      playTone(1000, 80);
      setLcdActivity("STRIP: OFF", TFT_DARKGREY);
    }
  } else {
    playTone(1500, 50);
    setLcdActivity("REFRESH...", TFT_GREEN);
    loadSupabaseLatest();
  }
  renderLcdDashboard();
}

function switchToPage(pageIdx) {
  g_lcd_page = pageIdx % 6;
  playTone(1400, 40);
  const act = (g_lcd_page === 0) ? "COCONUT" : `PAGE ${g_lcd_page}/5`;
  setLcdActivity(act, TFT_CYAN);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('btnSound');
  if (btn) {
    btn.textContent = soundEnabled ? '🔊 BUZZER: ON' : '🔇 BUZZER: OFF';
  }
  if (soundEnabled) playTone(1800, 50);
}

// Keyboard shortcuts: A, B, C or Arrows
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'a' || e.key === 'ArrowLeft') {
    e.preventDefault();
    handleButtonA();
  } else if (k === 'b' || e.key === 'ArrowDown' || e.key === ' ') {
    e.preventDefault();
    handleButtonB();
  } else if (k === 'c' || e.key === 'ArrowRight') {
    e.preventDefault();
    handleButtonC();
  } else if (k >= '0' && k <= '5') {
    switchToPage(parseInt(k));
  }
});

// ==================== SUPABASE LIVE TELEMETRY ====================
const SUPABASE_URL = "https://pakfuetvwpffwfrrxshz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU";

async function loadSupabaseLatest() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/solar_telemetry?select=*&order=created_at.desc&limit=1`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (res.ok) {
      const rows = await res.json();
      if (rows && rows.length > 0) {
        applyTelemetryRecord(rows[0]);
      }
    }
  } catch (err) {
    console.warn('[Mini 📡] Supabase fetch error:', err);
  }
}

function applyTelemetryRecord(row) {
  if (!row) return;

  if (row.created_at) {
    g_lastSyncEpochMs = new Date(row.created_at).getTime();
  }

  if (row.solar_power !== undefined) g_data.solar_power = Number(row.solar_power);
  if (row.battery_voltage !== undefined) g_data.battery_voltage = Number(row.battery_voltage);
  if (row.battery_current !== undefined) g_data.battery_current = Number(row.battery_current);
  if (row.yield_today_wh !== undefined) g_data.yield_today_wh = Number(row.yield_today_wh);
  if (row.external_load !== undefined) g_data.external_load = Number(row.external_load);
  if (row.charge_state !== undefined) g_data.charge_state = Number(row.charge_state);
  if (row.ble_rssi !== undefined) g_data.rssi = Number(row.ble_rssi);

  if (row.relay1_inverter !== undefined) g_relay1_inverter = Boolean(row.relay1_inverter);
  if (row.led_strip !== undefined) g_led_strip_on = Boolean(row.led_strip);

  if (row.cell_operator) g_data.cell_operator = row.cell_operator;
  if (row.cell_mode) g_data.cell_mode = row.cell_mode;
  if (row.cell_band) g_data.cell_band = row.cell_band;
  if (row.cell_rsrp !== undefined) g_data.cell_rsrp = Number(row.cell_rsrp);
  if (row.cell_sinr !== undefined) g_data.cell_sinr = Number(row.cell_sinr);
  if (row.cell_temp !== undefined) g_data.cell_temp = Number(row.cell_temp);
  if (row.cell_down_mbps !== undefined) g_data.cell_down_mbps = Number(row.cell_down_mbps);
  if (row.cell_up_mbps !== undefined) g_data.cell_up_mbps = Number(row.cell_up_mbps);

  if (row.wx_temp !== undefined) g_data.wx_temp = Number(row.wx_temp);
  if (row.wx_solar_wm2 !== undefined) g_data.wx_solar_wm2 = Number(row.wx_solar_wm2);
  if (row.wx_cloud_pct !== undefined) g_data.wx_cloud_pct = Number(row.wx_cloud_pct);
  if (row.wx_rain_mm !== undefined) g_data.wx_rain_mm = Number(row.wx_rain_mm);
  if (row.wx_wind_kmh !== undefined) g_data.wx_wind_kmh = Number(row.wx_wind_kmh);
  if (row.wx_humidity !== undefined) g_data.wx_humidity = Number(row.wx_humidity);
  if (row.wx_pressure !== undefined) g_data.wx_pressure = Number(row.wx_pressure);

  if (row.temp_dallas1 !== undefined && row.temp_dallas1 !== null) g_data.temp_dallas1 = Number(row.temp_dallas1);
  if (row.temp_plc !== undefined) g_data.temp_plc = Number(row.temp_plc);

  updateStatusFooter();
  renderLcdDashboard();
}

function updateStatusFooter() {
  const syncLabel = document.getElementById('lastSyncInfo');
  if (syncLabel) {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - g_lastSyncEpochMs) / 1000));
    if (elapsedSec < 60) syncLabel.textContent = `Vor ${elapsedSec}s`;
    else syncLabel.textContent = `Vor ${Math.floor(elapsedSec / 60)} Min.`;
  }
}

// 1-second display timer tick for autarky header & sync countdown
setInterval(() => {
  updateStatusFooter();
  renderLcdDashboard();
}, 1000);

// Startup
window.addEventListener('DOMContentLoaded', () => {
  initDisplay();
  loadSupabaseLatest();
  setInterval(loadSupabaseLatest, 60000); // Poll Supabase every 60s
});
