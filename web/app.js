// RandeSolar - openBrushograph Studio Edition
let solarChartInstance = null;
let chargeChartInstance = null;
let netChartInstance = null;
let weatherChartInstance = null;
let lastChartAppendTime = 0;
const CHART_THROTTLE_MS = 4000; // Update charts every 4-5 seconds for calm reading
let currentLimit = 240; // Default 1 hour of history
let currentHours = 1;
let lastBeaconTime = null;
const urlParams = new URLSearchParams(window.location.search);
let currentTheme = urlParams.get('theme') || 'pinkograph'; // Start default with Pinkograph theme
let activeEndpoint = localStorage.getItem('randesolar-endpoint') || 'http://randesolar.local';
let isDemoMode = false;
let simSolarWatts = 0;
let simBattVolts = 12.72;

// DOM Elements
const el = {
  solarPower: document.getElementById('solarPower'),
  yieldToday: document.getElementById('yieldToday'),
  batteryVoltage: document.getElementById('batteryVoltage'),
  batteryBar: document.getElementById('batteryBar'),
  estSoc: document.getElementById('estSoc'),
  batteryCurrent: document.getElementById('batteryCurrent'),
  batteryPowerFlow: document.getElementById('batteryPowerFlow'),
  chargeStatePill: document.getElementById('chargeStatePill'),
  errorBadge: document.getElementById('errorBadge'),
  externalLoad: document.getElementById('externalLoad'),
  connectionStatus: document.getElementById('connectionStatus'),
  statusText: document.getElementById('statusText'),
  rssiValue: document.getElementById('rssiValue'),
  deviceModel: document.getElementById('deviceModel'),
  lastSeenTimer: document.getElementById('lastSeenTimer'),
  diagMac: document.getElementById('diagMac'),
  diagSource: document.getElementById('diagSource'),
  themeSelector: document.getElementById('theme-selector'),
  endpointInput: document.getElementById('endpointInput'),
  lblTitle: document.getElementById('main-title'),
  lblTheme: document.getElementById('lblTheme'),
  lblPanelSolar: document.getElementById('lblPanelSolar'),
  lblYield: document.getElementById('lblYield'),
  lblPanelBattery: document.getElementById('lblPanelBattery'),
  lblSoc: document.getElementById('lblSoc'),
  lblPanelCurrent: document.getElementById('lblPanelCurrent'),
  lblFlow: document.getElementById('lblFlow'),
  lblPanelState: document.getElementById('lblPanelState'),
  lblLoad: document.getElementById('lblLoad'),
  lblChartTitle1: document.getElementById('lblChartTitle1'),
  lblChartTitle2: document.getElementById('lblChartTitle2'),
  peakSolarPower: document.getElementById('peakSolarPower'),
  yieldYesterday: document.getElementById('yieldYesterday'),
  batteryMinMax: document.getElementById('batteryMinMax'),
  lblPeak: document.getElementById('lblPeak'),
  lblYesterday: document.getElementById('lblYesterday'),
  lblMinMax: document.getElementById('lblMinMax'),
  chipTempValue: document.getElementById('chipTempValue'),
  netSpeedValue: document.getElementById('netSpeedValue'),
};

// Studio Theme Palettes for Chart.js
const studioThemePalettes = {
  pinkograph: {
    solar: '#FFD400',
    solarFill: 'rgba(255, 212, 0, 0.2)',
    volt: '#00F5FF',
    voltFill: 'rgba(0, 245, 255, 0.15)',
    curr: '#FF6BB5',
    currFill: 'rgba(255, 107, 181, 0.2)',
    load: '#39FF14',
    grid: 'rgba(255, 107, 181, 0.15)',
    text: '#E3A0C0'
  },
  randen: {
    solar: '#8A6A1F',
    solarFill: 'rgba(138, 106, 31, 0.2)',
    volt: '#4A6B3D',
    voltFill: 'rgba(74, 107, 61, 0.15)',
    curr: '#8B0000',
    currFill: 'rgba(139, 0, 0, 0.15)',
    load: '#3d5a80',
    grid: 'rgba(92, 75, 58, 0.2)',
    text: '#7A6A58'
  },
  'dresden-dark': {
    solar: '#ffffff',
    solarFill: 'rgba(255, 255, 255, 0.2)',
    volt: '#dddddd',
    voltFill: 'rgba(221, 221, 221, 0.1)',
    curr: '#aaaaaa',
    currFill: 'rgba(170, 170, 170, 0.15)',
    load: '#eeeeee',
    grid: 'rgba(102, 102, 102, 0.25)',
    text: '#aaaaaa'
  },
  dresden: {
    solar: '#1a1a1a',
    solarFill: 'rgba(26, 26, 26, 0.15)',
    volt: '#4f4f4f',
    voltFill: 'rgba(79, 79, 79, 0.1)',
    curr: '#2b2b2b',
    currFill: 'rgba(43, 43, 43, 0.15)',
    load: '#616161',
    grid: 'rgba(140, 136, 126, 0.25)',
    text: '#5a574f'
  },
  tropical: {
    solar: '#facc15',
    solarFill: 'rgba(250, 204, 21, 0.2)',
    volt: '#00ffcc',
    voltFill: 'rgba(0, 255, 204, 0.15)',
    curr: '#ff00ff',
    currFill: 'rgba(255, 0, 255, 0.2)',
    load: '#33ff66',
    grid: 'rgba(46, 139, 87, 0.25)',
    text: '#5ccc5c'
  },
  coconut: {
    solar: '#FFB000',
    solarFill: 'rgba(255, 176, 0, 0.2)',
    volt: '#4DFF88',
    voltFill: 'rgba(77, 255, 136, 0.15)',
    curr: '#33FF66',
    currFill: 'rgba(51, 255, 102, 0.2)',
    load: '#B8FFD0',
    grid: 'rgba(31, 107, 60, 0.25)',
    text: '#2E9455'
  },
  bengaluru: {
    solar: '#fca311',
    solarFill: 'rgba(252, 163, 17, 0.2)',
    volt: '#2a9d8f',
    voltFill: 'rgba(42, 157, 143, 0.15)',
    curr: '#d90429',
    currFill: 'rgba(217, 4, 41, 0.2)',
    load: '#2a9d8f',
    grid: 'rgba(252, 163, 17, 0.25)',
    text: '#f3d596'
  },
  uwu: {
    solar: '#E07A00',
    solarFill: 'rgba(224, 122, 0, 0.2)',
    volt: '#8E00C9',
    voltFill: 'rgba(142, 0, 201, 0.15)',
    curr: '#E5006E',
    currFill: 'rgba(229, 0, 110, 0.2)',
    load: '#8E00C9',
    grid: 'rgba(255, 159, 213, 0.3)',
    text: '#9E5480'
  },
  light: {
    solar: '#ffb700',
    solarFill: 'rgba(255, 183, 0, 0.2)',
    volt: '#56bdff',
    voltFill: 'rgba(86, 189, 255, 0.15)',
    curr: '#005b96',
    currFill: 'rgba(0, 91, 150, 0.15)',
    load: '#32b643',
    grid: 'rgba(218, 222, 228, 0.6)',
    text: '#66758c'
  }
};

// Language Dictionary (English & German)
const i18n = {
  de: {
    title: "RandeSolar Kraftwerk",
    theme: "STIL:",
    panelSolar: "Solarmodul (Photovoltaik)",
    yield: "Tagesertrag",
    panelBattery: "Batteriespeicher (12V)",
    soc: "Ladezustand",
    panelCurrent: "Ladestrom & Fluß",
    flow: "Leistung",
    panelState: "Regler-Zustand",
    load: "Lastanschluß",
    chartTitle1: "Solarmodul (W) & Batteriespeicher (V)",
    chartTitle2: "Ladestrom & Laststrom (A)",
    peak: "Spitze heute",
    yesterday: "Gestern",
    minMax: "Min / Max",
    states: { 0: "AUS", 2: "FEHLER", 3: "HAUPTLADUNG", 4: "NACHLADUNG", 5: "ERHALTUNG", 252: "EXT. STEUERUNG" },
    ledTitle: "💡 ESP32-S3 Status-LED (WS2812 Farbcodes)",
    ledSubtitle: "Die integrierte RGB-LED auf GPIO 48 zeigt den aktuellen Betriebszustand und die Funkübertragung in Echtzeit an:",
    ledSolar: { name: "☀️ Sonnengelb / Gold", desc: "<b>Solar-Erzeugung aktiv (> 0W):</b> Photovoltaik produziert Strom. Helligkeit passt sich der Wattzahl an." },
    ledFloat: { name: "🔋 Smaragdgrün", desc: "<b>Erhaltungsladung (Float):</b> Speicher ist vollständig geladen (100%). Erhaltungsspannung." },
    ledAbs: { name: "⚡ Helles Türkis", desc: "<b>Nachladephase (Absorption):</b> Akku nähert sich Ladeschlussspannung. Konstantspannung." },
    ledBulk: { name: "💜 Purpur / Violett", desc: "<b>Hauptladung (Bulk):</b> Maximal verfügbarer Solarstrom lädt die entladene Batterie." },
    ledStandby: { name: "🌙 Dezentes Petrol", desc: "<b>Nachtbetrieb / Standby (0W):</b> Ruhemodus bei Dunkelheit. Ruhiges, unaufdringliches Glimmen." },
    ledMqtt: { name: "📡 Cyan-Puls (40ms alle 5s)", desc: "<b>Heartbeat:</b> Kurzes Zwinkern alle 5 Sekunden bestätigt das erfolgreiche Senden des Live-Telemetriepakets." },
    ledScan: { name: "⚠️ Warmes Bernstein", desc: "<b>Suchlauf:</b> Wartet auf Bluetooth Instant-Readout Beacons des Victron Reglers." },
    ledOffline: { name: "🔴 Dezentes Rot", desc: "<b>WLAN getrennt:</b> ESP32 verbindet sich mit dem RandeLab WLAN oder arbeitet offline." }
  },
  en: {
    title: "RandeSolar Studio",
    theme: "THEME:",
    panelSolar: "Solar Array (PV)",
    yield: "Yield Today",
    panelBattery: "Storage Pack (12V)",
    soc: "Est. SOC",
    panelCurrent: "Charge Flow",
    flow: "Pack Flow",
    panelState: "Controller State",
    load: "Load Port",
    chartTitle1: "Solar Power (W) & Battery Voltage (V)",
    chartTitle2: "Charging & Load Current (A)",
    peak: "Peak Today",
    yesterday: "Yesterday",
    minMax: "Min / Max",
    states: { 0: "OFF", 2: "FAULT", 3: "BULK", 4: "ABSORPTION", 5: "FLOAT", 252: "EXT CONTROL" },
    ledTitle: "💡 ESP32-S3 Status LED (WS2812 Color Codes)",
    ledSubtitle: "The onboard RGB LED on GPIO 48 displays real-time controller state and radio telemetry transmission:",
    ledSolar: { name: "☀️ Solar Gold / Yellow", desc: "<b>Solar Power Active (> 0W):</b> Solar panel is generating power. Brightness scales with wattage." },
    ledFloat: { name: "🔋 Emerald Green", desc: "<b>Float Charge:</b> Battery pack is fully charged (100%). Maintaining float voltage." },
    ledAbs: { name: "⚡ Vivid Cyan", desc: "<b>Absorption Charge:</b> Battery approaching full charge. Constant absorption voltage." },
    ledBulk: { name: "💜 Deep Violet / Purple", desc: "<b>Bulk Charge:</b> Maximum available solar current is charging the battery." },
    ledStandby: { name: "🌙 Soft Petrol / Teal", desc: "<b>Night Standby (0W):</b> Idle night mode. Dim, calm ambient glow." },
    ledMqtt: { name: "📡 Cyan Wink (40ms / 5s)", desc: "<b>Heartbeat Pip:</b> Brief 40ms pulse every 5 seconds confirms live packet sent to HiveMQ." },
    ledScan: { name: "⚠️ Warm Amber", desc: "<b>Beacon Scan:</b> Scanning for Victron BLE Instant Readout advertisements." },
    ledOffline: { name: "🔴 Soft Red", desc: "<b>Wi-Fi Offline:</b> Connecting to RandeLab Wi-Fi or operating offline." }
  }
};

let currentLang = "de";

// Derived Statistics Trackers
let peakWattsToday = 0;
let minVoltsToday = 999;
let maxVoltsToday = 0;
let lastTelemetryData = null;

function updateDerivedStats(power, volt) {
  if (power !== undefined && power > peakWattsToday) {
    peakWattsToday = power;
    if (el.peakSolarPower) el.peakSolarPower.textContent = `${peakWattsToday} W`;
  }
  if (volt && volt > 5) {
    if (volt < minVoltsToday) minVoltsToday = volt;
    if (volt > maxVoltsToday) maxVoltsToday = volt;
    if (el.batteryMinMax && minVoltsToday < 900) {
      el.batteryMinMax.textContent = `${minVoltsToday.toFixed(2)} / ${maxVoltsToday.toFixed(2)} V`;
    }
  }
}

function getHumanMoodText(data, lang = 'de') {
  if (!data) return '';
  const w = Number(data.solar_power || 0);
  const v = Number(data.battery_voltage || 0);
  const kwh = Number(data.yield_today_wh || 0) / 1000.0;
  const a = Number(data.battery_charging_current || data.battery_current || 0);
  const load = Number(data.external_load || 0);
  const state = Number(data.charge_state || 0);

  if (lang === 'de') {
    if (w === 0) {
      if (v >= 12.45) {
        return `»Entspannter Feierabend im RandeLab! 🌙 Meine Solarzellen schlafen tief und fest (0 W). Mein Akkumulator fühlt sich mit gemächlichen ${v.toFixed(2)} V pudelwohl – kein Stress, keine Hektik. Heute durfte ich ${kwh.toFixed(2)} kWh Sonnenlicht einfangen. Ich träume schon von der Morgensonne!«`;
      } else {
        return `»Puh, ganz schön geschlaucht... 🥱 Es ist finster draussen (0 W) und meine Batterie hat heute einiges leisten müssen (nur noch ${v.toFixed(2)} V). Meine Kondensatoren sehnen sich nach neuer Energie bei Sonnenaufgang!«`;
      }
    } else if (w >= 30) {
      return `»Boah, mir ist herrlich warm! ☀️🔥 Die Sonne knallt gerade mit satten ${w} Watt auf mein Panel! Mein MPPT jagt den maximalen Arbeitspunkt und schaufelt fleissig ${a.toFixed(1)} A in den Akku (${v.toFixed(2)} V). So macht das mechatronische Leben Spass!«`;
    } else {
      return `»Gemütliches Schaffen im Halbschatten ⛅ Ein paar schüchterne Sonnenstrahlen schaffen es durch die Wolken (${w} W). Bei ${v.toFixed(2)} V nuckelt die Batterie entspannt an ${a.toFixed(1)} A. Bisher sind ${kwh.toFixed(2)} kWh im Kasten!«`;
    }
  } else {
    // English
    if (w === 0) {
      if (v >= 12.45) {
        return `»Peaceful night at RandeLab! 🌙 Solar cells are sleeping deeply (0 W). My battery pack is cruising comfortably at ${v.toFixed(2)} V – zero stress. Gathered ${kwh.toFixed(2)} kWh of sunlight today. Dreaming of morning photons!«`;
      } else {
        return `»Phew, feeling a bit drained... 🥱 It's dark outside (0 W) and my battery had a heavy day (${v.toFixed(2)} V). Resting quietly until tomorrow's sunrise brings fresh energy!«`;
      }
    } else if (w >= 30) {
      return `»Blissfully warm! ☀️🔥 Sun is pounding with a solid ${w} Watts on my panels! MPPT is tracking the sweet spot and pushing ${a.toFixed(1)} A into storage (${v.toFixed(2)} V). Pure solar joy!«`;
    } else {
      return `»Cruising gently in the overcast shade ⛅ Catching stray photons through the clouds (${w} W). Battery is sipping ${a.toFixed(1)} A at ${v.toFixed(2)} V. ${kwh.toFixed(2)} kWh harvested so far!«`;
    }
  }
}

// Function called by theme selector dropdown
window.setTheme = function(theme) {
  currentTheme = theme;
  document.body.className = `theme-${theme}`;
  localStorage.setItem('openbrushograph-studio-theme', theme);

  if (el.themeSelector) {
    el.themeSelector.value = theme;
  }

  // Language selection: Dresden and Randen are German!
  currentLang = (theme.startsWith('dresden') || theme === 'randen') ? 'de' : 'en';
  const l = i18n[currentLang];
  if (el.lblTitle) el.lblTitle.textContent = l.title;
  if (el.lblTheme) el.lblTheme.textContent = l.theme;
  if (el.lblPanelSolar) el.lblPanelSolar.textContent = l.panelSolar;
  if (el.lblYield) el.lblYield.textContent = l.yield;
  if (el.lblPanelBattery) el.lblPanelBattery.textContent = l.panelBattery;
  if (el.lblSoc) el.lblSoc.textContent = l.soc;
  if (el.lblPanelCurrent) el.lblPanelCurrent.textContent = l.panelCurrent;
  if (el.lblFlow) el.lblFlow.textContent = l.flow;
  if (el.lblPanelState) el.lblPanelState.textContent = l.panelState;
  if (el.lblLoad) el.lblLoad.textContent = l.load;
  if (el.lblChartTitle1) el.lblChartTitle1.textContent = l.chartTitle1;
  if (el.lblChartTitle2) el.lblChartTitle2.textContent = l.chartTitle2;
  if (el.lblPeak && l.peak) el.lblPeak.textContent = l.peak;
  if (el.lblYesterday && l.yesterday) el.lblYesterday.textContent = l.yesterday;
  if (el.lblMinMax && l.minMax) el.lblMinMax.textContent = l.minMax;

  // Mood Heading & Live Text
  const headingEl = document.getElementById('lblMoodHeading');
  if (headingEl) {
    headingEl.textContent = currentLang === 'de' ? 'RandeSolar Tagebuch • Live-Gefühlslage' : 'RandeSolar Diary • Live Feelings';
  }
  const moodEl = document.getElementById('liveMoodText');
  if (moodEl && lastTelemetryData) {
    moodEl.textContent = getHumanMoodText(lastTelemetryData, currentLang);
  }

  // Timeframe Week button translation
  const btnWeek = document.getElementById('btnTimeWeek');
  if (btnWeek) {
    btnWeek.textContent = currentLang === 'de' ? '1 Woche' : '1 week';
  }

  // Diagnostics Footer Signal/Reception label
  const lblDiagSeen = document.getElementById('lblDiagSeen');
  if (lblDiagSeen) {
    lblDiagSeen.textContent = currentLang === 'de' ? 'EMPFANG:' : 'SIGNAL:';
  }

  // LED Legend translation
  const ledTitle = document.getElementById("lblLedTitle");
  const ledSub = document.getElementById("lblLedSubtitle");
  if (ledTitle && l.ledTitle) ledTitle.textContent = l.ledTitle;
  if (ledSub && l.ledSubtitle) ledSub.textContent = l.ledSubtitle;
  
  const updateLedEl = (idName, idDesc, data) => {
    const elN = document.getElementById(idName);
    const elD = document.getElementById(idDesc);
    if (elN && data) elN.textContent = data.name;
    if (elD && data) elD.innerHTML = data.desc;
  };
  if (l.ledSolar) updateLedEl("ledNameSolar", "ledDescSolar", l.ledSolar);
  if (l.ledFloat) updateLedEl("ledNameFloat", "ledDescFloat", l.ledFloat);
  if (l.ledAbs) updateLedEl("ledNameAbs", "ledDescAbs", l.ledAbs);
  if (l.ledBulk) updateLedEl("ledNameBulk", "ledDescBulk", l.ledBulk);
  if (l.ledStandby) updateLedEl("ledNameStandby", "ledDescStandby", l.ledStandby);
  if (l.ledMqtt) updateLedEl("ledNameMqtt", "ledDescMqtt", l.ledMqtt);
  if (l.ledScan) updateLedEl("ledNameScan", "ledDescScan", l.ledScan);
  if (l.ledOffline) updateLedEl("ledNameOffline", "ledDescOffline", l.ledOffline);

  const pal = studioThemePalettes[theme] || studioThemePalettes.pinkograph;

  // Update Solar & Battery Chart colors
  if (solarChartInstance) {
    solarChartInstance.data.datasets[0].borderColor = pal.solar;
    solarChartInstance.data.datasets[0].backgroundColor = pal.solarFill;
    solarChartInstance.data.datasets[1].borderColor = pal.volt;
    solarChartInstance.data.datasets[1].backgroundColor = pal.voltFill;

    solarChartInstance.options.scales.x.grid.color = pal.grid;
    solarChartInstance.options.scales.x.ticks.color = pal.text;
    solarChartInstance.options.scales.yPower.grid.color = pal.grid;
    solarChartInstance.options.scales.yPower.ticks.color = pal.solar;
    solarChartInstance.options.scales.yPower.title.color = pal.solar;
    solarChartInstance.options.scales.yVoltage.ticks.color = pal.volt;
    solarChartInstance.options.scales.yVoltage.title.color = pal.volt;
    solarChartInstance.update();
  }

  // Update Charge & Current Chart colors
  if (chargeChartInstance) {
    chargeChartInstance.data.datasets[0].borderColor = pal.curr;
    chargeChartInstance.data.datasets[0].backgroundColor = pal.currFill || 'rgba(255, 107, 181, 0.2)';
    chargeChartInstance.data.datasets[1].borderColor = pal.load || '#39FF14';

    chargeChartInstance.options.scales.x.grid.color = pal.grid;
    chargeChartInstance.options.scales.x.ticks.color = pal.text;
    chargeChartInstance.options.scales.yCurrent.grid.color = pal.grid;
    chargeChartInstance.options.scales.yCurrent.ticks.color = pal.curr;
    chargeChartInstance.options.scales.yCurrent.title.color = pal.curr;
    chargeChartInstance.update();
  }

  // Update Network Speed Chart colors
  if (netChartInstance) {
    netChartInstance.data.datasets[0].borderColor = pal.volt || '#00F5FF';
    netChartInstance.data.datasets[0].backgroundColor = pal.voltFill || 'rgba(0, 245, 255, 0.15)';
    netChartInstance.data.datasets[1].borderColor = pal.curr || '#FF6BB5';
    netChartInstance.data.datasets[1].backgroundColor = pal.currFill || 'rgba(255, 107, 181, 0.15)';
    netChartInstance.data.datasets[2].borderColor = pal.load || '#39FF14';
    netChartInstance.data.datasets[3].borderColor = pal.solar || '#FFD400';

    netChartInstance.options.scales.x.grid.color = pal.grid;
    netChartInstance.options.scales.x.ticks.color = pal.text;
    netChartInstance.options.scales.ySpeed.grid.color = pal.grid;
    netChartInstance.options.scales.ySpeed.ticks.color = pal.volt || '#00F5FF';
    netChartInstance.options.scales.ySpeed.title.color = pal.volt || '#00F5FF';
    netChartInstance.options.scales.yPing.ticks.color = pal.load || '#39FF14';
    netChartInstance.options.scales.yPing.title.color = pal.load || '#39FF14';
    netChartInstance.update();
  }

  // Update Weather & Microclimate Chart colors
  if (weatherChartInstance) {
    weatherChartInstance.data.datasets[0].borderColor = pal.solar || '#FFD400';
    weatherChartInstance.data.datasets[0].backgroundColor = pal.solarFill || 'rgba(255, 212, 0, 0.12)';
    weatherChartInstance.data.datasets[1].borderColor = '#FF7A00';
    weatherChartInstance.data.datasets[3].borderColor = pal.volt || '#00F5FF';
    weatherChartInstance.data.datasets[3].backgroundColor = pal.voltFill || 'rgba(0, 245, 255, 0.25)';

    weatherChartInstance.options.scales.x.grid.color = pal.grid;
    weatherChartInstance.options.scales.x.ticks.color = pal.text;
    weatherChartInstance.options.scales.ySolar.grid.color = pal.grid;
    weatherChartInstance.options.scales.ySolar.ticks.color = pal.solar || '#FFD400';
    weatherChartInstance.options.scales.ySolar.title.color = pal.solar || '#FFD400';
    weatherChartInstance.options.scales.yTemp.ticks.color = '#FF7A00';
    weatherChartInstance.options.scales.yTemp.title.color = '#FF7A00';
    weatherChartInstance.update();
  }
};

window.connectToCustomEndpoint = function() {
  if (el.endpointInput) {
    activeEndpoint = el.endpointInput.value.trim().replace(/\/$/, '');
    localStorage.setItem('randesolar-endpoint', activeEndpoint);
    fetchLiveTelemetry(true);
  }
};

// Initialize Dual Charts (Plot 1: Solar W & Battery V, Plot 2: Charge A & Load A)
function initChart() {
  const pal = studioThemePalettes[currentTheme] || studioThemePalettes.pinkograph;

  const formatTime24h = (dt, withSeconds = false) => {
    const pad = (n) => String(n).padStart(2, '0');
    const h = pad(dt.getHours());
    const m = pad(dt.getMinutes());
    return withSeconds ? `${h}:${m}:${pad(dt.getSeconds())}` : `${h}:${m}`;
  };

  const formatDatePrefix = (dt, withDay = false) => {
    const loc = (typeof currentLang !== 'undefined' && currentLang === 'de') ? 'de-CH' : 'en-GB';
    const opt = withDay ? { weekday: 'short', day: '2-digit', month: '2-digit' } : { weekday: 'short' };
    return dt.toLocaleDateString(loc, opt);
  };

  const createXScaleConfig = (p) => ({
    type: 'linear',
    grid: { color: p.grid },
    ticks: {
      color: p.text,
      font: { family: 'JetBrains Mono', size: 10 },
      maxTicksLimit: 7,
      callback: function(val) {
        const dt = new Date(val);
        if (currentHours >= 48) {
          return `${formatDatePrefix(dt, false)} ${formatTime24h(dt, false)}`;
        } else if (currentHours >= 2) {
          return formatTime24h(dt, false);
        } else {
          return formatTime24h(dt, true);
        }
      }
    }
  });

  const createTooltipConfig = (borderColor) => ({
    backgroundColor: 'rgba(10, 0, 20, 0.95)',
    titleFont: { family: 'Outfit', size: 12 },
    bodyFont: { family: 'JetBrains Mono', size: 12 },
    borderColor: borderColor,
    borderWidth: 1,
    padding: 8,
    callbacks: {
      title: function(items) {
        if (!items || !items.length) return '';
        const dt = new Date(items[0].parsed.x);
        return `${formatDatePrefix(dt, true)} ${formatTime24h(dt, true)}`;
      }
    }
  });

  // Plot 1: Solar & Battery
  const solarCanvas = document.getElementById('solarChart');
  if (solarCanvas) {
    const ctxSolar = solarCanvas.getContext('2d');
    solarChartInstance = new Chart(ctxSolar, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Solar (W)',
            data: [],
            borderColor: pal.solar,
            backgroundColor: pal.solarFill,
            borderWidth: 2.5,
            tension: 0.25,
            fill: true,
            spanGaps: true,
            yAxisID: 'yPower',
            pointRadius: 2,
            pointHoverRadius: 5,
          },
          {
            label: 'Batterie (V)',
            data: [],
            borderColor: pal.volt,
            backgroundColor: pal.voltFill,
            borderWidth: 2,
            tension: 0.25,
            fill: false,
            spanGaps: true,
            yAxisID: 'yVoltage',
            pointRadius: 2,
            pointHoverRadius: 5,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: pal.text,
              font: { family: 'JetBrains Mono', size: 11, weight: '700' },
              boxWidth: 12,
              usePointStyle: true,
            }
          },
          tooltip: createTooltipConfig('rgba(255, 107, 181, 0.4)')
        },
        scales: {
          x: createXScaleConfig(pal),
          yPower: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Solar (W)', color: pal.solar, font: { family: 'Outfit', size: 11 } },
            grid: { color: pal.grid },
            ticks: { color: pal.solar, font: { family: 'JetBrains Mono', size: 10 } },
            suggestedMin: 0,
            suggestedMax: 50,
          },
          yVoltage: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Batterie (V)', color: pal.volt, font: { family: 'Outfit', size: 11 } },
            grid: { drawOnChartArea: false },
            ticks: { color: pal.volt, font: { family: 'JetBrains Mono', size: 10 } },
            suggestedMin: 11.5,
            suggestedMax: 14.5,
          }
        }
      }
    });
  }

  // Plot 2: Charge & Current
  const chargeCanvas = document.getElementById('chargeChart');
  if (chargeCanvas) {
    const ctxCharge = chargeCanvas.getContext('2d');
    chargeChartInstance = new Chart(ctxCharge, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Ladestrom (A)',
            data: [],
            borderColor: pal.curr,
            backgroundColor: pal.currFill || 'rgba(255, 107, 181, 0.2)',
            borderWidth: 2.2,
            tension: 0.25,
            fill: true,
            spanGaps: true,
            yAxisID: 'yCurrent',
            pointRadius: 2,
            pointHoverRadius: 5,
          },
          {
            label: 'Lastanschluss (A)',
            data: [],
            borderColor: pal.load || '#39FF14',
            borderWidth: 1.8,
            borderDash: [4, 4],
            tension: 0.2,
            fill: false,
            spanGaps: true,
            yAxisID: 'yCurrent',
            pointRadius: 1,
            pointHoverRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: pal.text,
              font: { family: 'JetBrains Mono', size: 11, weight: '700' },
              boxWidth: 12,
              usePointStyle: true,
            }
          },
          tooltip: createTooltipConfig('rgba(255, 107, 181, 0.4)')
        },
        scales: {
          x: createXScaleConfig(pal),
          yCurrent: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Strom (A)', color: pal.curr, font: { family: 'Outfit', size: 11 } },
            grid: { color: pal.grid },
            ticks: { color: pal.curr, font: { family: 'JetBrains Mono', size: 10 } },
            suggestedMin: 0,
            suggestedMax: 10,
          }
        }
      }
    });
  }

  // Plot 3: Internet Speed & Network Latency (Mbit/s & ms)
  const netCanvas = document.getElementById('netChart');
  if (netCanvas) {
    const ctxNet = netCanvas.getContext('2d');
    netChartInstance = new Chart(ctxNet, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Download (Mbit/s)',
            data: [],
            borderColor: pal.volt || '#00F5FF',
            backgroundColor: pal.voltFill || 'rgba(0, 245, 255, 0.15)',
            borderWidth: 2.2,
            tension: 0.25,
            fill: true,
            spanGaps: true,
            yAxisID: 'ySpeed',
            pointRadius: 2.5,
            pointHoverRadius: 5,
          },
          {
            label: 'Upload (Mbit/s)',
            data: [],
            borderColor: pal.curr || '#FF6BB5',
            backgroundColor: pal.currFill || 'rgba(255, 107, 181, 0.15)',
            borderWidth: 1.8,
            tension: 0.25,
            fill: false,
            spanGaps: true,
            yAxisID: 'ySpeed',
            pointRadius: 2,
            pointHoverRadius: 4,
          },
          {
            label: 'Internet Ping (ms)',
            data: [],
            borderColor: pal.load || '#39FF14',
            borderWidth: 1.8,
            borderDash: [3, 3],
            tension: 0.2,
            fill: false,
            spanGaps: true,
            yAxisID: 'yPing',
            pointRadius: 1.5,
            pointHoverRadius: 4,
          },
          {
            label: 'Router GW Ping (ms)',
            data: [],
            borderColor: pal.solar || '#FFD400',
            borderWidth: 1.5,
            borderDash: [2, 2],
            tension: 0.2,
            fill: false,
            spanGaps: true,
            yAxisID: 'yPing',
            pointRadius: 1.5,
            pointHoverRadius: 4,
          },
          {
            label: 'Niederschlag (mm)',
            data: [],
            borderColor: '#00B4D8',
            backgroundColor: 'rgba(0, 180, 216, 0.2)',
            borderWidth: 1.8,
            tension: 0.1,
            fill: true,
            spanGaps: true,
            yAxisID: 'yRain',
            pointRadius: 2,
            pointHoverRadius: 4,
          },
          {
            label: 'Bewölkung (%)',
            data: [],
            borderColor: '#94A3B8',
            borderWidth: 1.5,
            borderDash: [2, 2],
            tension: 0.2,
            fill: false,
            spanGaps: true,
            yAxisID: 'yCloud',
            pointRadius: 1,
            pointHoverRadius: 3,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: pal.text,
              font: { family: 'JetBrains Mono', size: 11, weight: '700' },
              boxWidth: 12,
              usePointStyle: true,
            }
          },
          tooltip: createTooltipConfig('rgba(0, 245, 255, 0.4)')
        },
        scales: {
          x: createXScaleConfig(pal),
          ySpeed: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Speed (Mbit/s)', color: pal.volt || '#00F5FF', font: { family: 'Outfit', size: 11 } },
            grid: { color: pal.grid },
            ticks: { color: pal.volt || '#00F5FF', font: { family: 'JetBrains Mono', size: 10 } },
            suggestedMin: 0,
            suggestedMax: 10,
          },
          yPing: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Latenz (ms)', color: pal.load || '#39FF14', font: { family: 'Outfit', size: 11 } },
            grid: { drawOnChartArea: false },
            ticks: { color: pal.load || '#39FF14', font: { family: 'JetBrains Mono', size: 10 } },
            suggestedMin: 0,
            suggestedMax: 100,
          },
          yRain: {
            type: 'linear',
            position: 'right',
            display: false,
            grid: { drawOnChartArea: false },
            suggestedMin: 0,
            suggestedMax: 5,
          },
          yCloud: {
            type: 'linear',
            position: 'right',
            display: false,
            grid: { drawOnChartArea: false },
            min: 0,
            max: 100,
          }
        }
      }
    });
  }

  // Plot 4: Local Weather & Microclimate History (Regen, Bewölkung, Temp & Einstrahlung)
  const wxCanvas = document.getElementById('weatherChart');
  if (wxCanvas) {
    const ctxWx = wxCanvas.getContext('2d');
    weatherChartInstance = new Chart(ctxWx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Solar-Strahlung (W/m²)',
            data: [],
            borderColor: pal.solar || '#FFD400',
            backgroundColor: pal.solarFill || 'rgba(255, 212, 0, 0.12)',
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            spanGaps: true,
            yAxisID: 'ySolar',
            pointRadius: 2,
            pointHoverRadius: 5,
          },
          {
            label: 'Aussentemp (°C)',
            data: [],
            borderColor: '#FF7A00',
            backgroundColor: 'rgba(255, 122, 0, 0.1)',
            borderWidth: 2,
            tension: 0.25,
            fill: false,
            spanGaps: true,
            yAxisID: 'yTemp',
            pointRadius: 2,
            pointHoverRadius: 4,
          },
          {
            label: 'Bewölkung (%)',
            data: [],
            borderColor: '#94A3B8',
            backgroundColor: 'rgba(148, 163, 184, 0.15)',
            borderWidth: 1.5,
            borderDash: [3, 3],
            tension: 0.2,
            fill: false,
            spanGaps: true,
            yAxisID: 'yPercent',
            pointRadius: 1.5,
            pointHoverRadius: 4,
          },
          {
            label: 'Niederschlag (mm)',
            data: [],
            borderColor: '#00F5FF',
            backgroundColor: 'rgba(0, 245, 255, 0.25)',
            borderWidth: 1.8,
            tension: 0.1,
            fill: true,
            spanGaps: true,
            yAxisID: 'yRain',
            pointRadius: 2,
            pointHoverRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: pal.text,
              font: { family: 'JetBrains Mono', size: 11, weight: '700' },
              boxWidth: 12,
              usePointStyle: true,
            }
          },
          tooltip: createTooltipConfig('rgba(255, 212, 0, 0.4)')
        },
        scales: {
          x: createXScaleConfig(pal),
          ySolar: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Strahlung (W/m²)', color: pal.solar || '#FFD400', font: { family: 'Outfit', size: 11 } },
            grid: { color: pal.grid },
            ticks: { color: pal.solar || '#FFD400', font: { family: 'JetBrains Mono', size: 10 } },
            suggestedMin: 0,
            suggestedMax: 400,
          },
          yTemp: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Temp (°C)', color: '#FF7A00', font: { family: 'Outfit', size: 11 } },
            grid: { drawOnChartArea: false },
            ticks: { color: '#FF7A00', font: { family: 'JetBrains Mono', size: 10 } },
            suggestedMin: 0,
            suggestedMax: 25,
          },
          yPercent: {
            type: 'linear',
            position: 'right',
            display: false,
            grid: { drawOnChartArea: false },
            min: 0,
            max: 100,
          },
          yRain: {
            type: 'linear',
            position: 'right',
            display: false,
            grid: { drawOnChartArea: false },
            suggestedMin: 0,
            suggestedMax: 5,
          }
        }
      }
    });
  }
}

// State-Aware Battery SoC Estimation (Lead-Acid / AGM with Victron 3-stage charging compensation)
function estimateSoC(v, chargeCurrent = 0, loadCurrent = 0, chargeState = 0) {
  if (!v || v < 5.0) return 0;

  // 1. Float State (5): Charger has completed bulk & absorption, battery is full
  if (chargeState === 5) {
    return 100;
  }

  // 2. Absorption State (4): Voltage held constant (~14.2V - 14.4V), current tapers down (80% - 95%)
  if (chargeState === 4) {
    const taper = Math.min(1.0, Math.max(0, chargeCurrent / 5.0));
    return Math.min(95, Math.max(80, Math.round(95 - taper * 15)));
  }

  // 3. Bulk State (3 / Active Solar Charging):
  // Terminal voltage is driven high by charging current & plate polarization.
  // Bulk charges from 0% to ~80% before absorption begins.
  if (chargeState === 3 || chargeCurrent > 0.4) {
    let bulkSoC = 15;
    if (v >= 14.2) bulkSoC = 80;
    else if (v >= 13.6) bulkSoC = 70 + ((v - 13.6) / 0.6) * 10;
    else if (v >= 13.0) bulkSoC = 55 + ((v - 13.0) / 0.6) * 15;
    else if (v >= 12.5) bulkSoC = 35 + ((v - 12.5) / 0.5) * 20;
    else if (v >= 12.0) bulkSoC = 15 + ((v - 12.0) / 0.5) * 20;
    else bulkSoC = Math.max(5, Math.round(((v - 11.2) / 0.8) * 15));

    return Math.min(80, Math.max(5, Math.round(bulkSoC)));
  }

  // 4. Resting / Discharging (State 0, Night, or no solar charging):
  // Compensate for load sag using battery internal resistance (~0.03 Ohm)
  const vComp = v + (loadCurrent * 0.03);

  // Standard 12V Lead-Acid / AGM Open Circuit Voltage (OCV) curve
  const ocvTable = [
    { v: 12.75, soc: 100 },
    { v: 12.60, soc: 90 },
    { v: 12.50, soc: 80 },
    { v: 12.40, soc: 70 },
    { v: 12.30, soc: 60 },
    { v: 12.20, soc: 50 },
    { v: 12.10, soc: 40 },
    { v: 12.00, soc: 30 },
    { v: 11.85, soc: 15 },
    { v: 11.60, soc: 0 }
  ];

  if (vComp >= ocvTable[0].v) return 100;
  if (vComp <= ocvTable[ocvTable.length - 1].v) return 0;

  for (let idx = 0; idx < ocvTable.length - 1; idx++) {
    const higher = ocvTable[idx];
    const lower = ocvTable[idx + 1];
    if (vComp <= higher.v && vComp >= lower.v) {
      const frac = (vComp - lower.v) / (higher.v - lower.v);
      return Math.round(lower.soc + frac * (higher.soc - lower.soc));
    }
  }

  return 50;
}

// Update UI
function updateDashboard(data) {
  if (!data) return;

  lastBeaconTime = Date.now();

  const solarW = Number(data.solar_power || 0);
  if (el.solarPower) el.solarPower.textContent = solarW.toFixed(0);

  const yieldWh = Number(data.yield_today_wh || data.yield_today || 0);
  if (el.yieldToday) el.yieldToday.textContent = (yieldWh / 1000).toFixed(2) + ' kWh';

  const elPvV = document.getElementById('panelVoltage');
  if (elPvV) {
    if (data.panel_voltage !== undefined && Number(data.panel_voltage) > 1.0) {
      elPvV.textContent = Number(data.panel_voltage).toFixed(1) + ' V';
    } else {
      elPvV.textContent = '-- V';
    }
  }

  const v = Number(data.battery_voltage || 0);
  if (el.batteryVoltage) el.batteryVoltage.textContent = v.toFixed(2);

  const i = Number(data.battery_charging_current || data.battery_current || 0);
  const loadA = Number(data.external_load || 0);
  const stateCode = data.charge_state || 0;

  let soc = estimateSoC(v, i, loadA, stateCode);
  if (el.batteryBar) el.batteryBar.style.width = soc + '%';

  let socStage = '';
  if (stateCode === 5) socStage = currentLang === 'de' ? 'Erhaltung' : 'Float';
  else if (stateCode === 4) socStage = currentLang === 'de' ? 'Nachladung' : 'Absorp.';
  else if (stateCode === 3 || i > 0.4) socStage = currentLang === 'de' ? 'Bulk' : 'Bulk';
  else socStage = currentLang === 'de' ? 'Ruhe' : 'Resting';

  if (el.estSoc) el.estSoc.textContent = `${soc}% (${socStage})`;

  if (el.batteryCurrent) el.batteryCurrent.textContent = i.toFixed(1);
  const flowW = (v * i).toFixed(1);
  if (el.batteryPowerFlow) el.batteryPowerFlow.textContent = `${flowW} W`;

  // State translation
  const stateMap = (i18n[currentLang] || i18n.de).states;
  const stStr = stateMap[stateCode] || data.state_str || 'OFF';
  if (el.chargeStatePill) {
    el.chargeStatePill.textContent = stStr;
    const rawClass = (data.state_str || 'off').toLowerCase();
    el.chargeStatePill.className = `state-pill state-${rawClass}`;
  }

  // Error Badge
  const err = data.charger_error || 'no_error';
  if (el.errorBadge) {
    el.errorBadge.textContent = (err === 'no_error' || err === 0) ? (currentLang === 'de' ? 'Normal' : 'Normal') : 'Fehler';
  }

  if (data.external_load !== undefined && el.externalLoad) {
    el.externalLoad.textContent = Number(data.external_load).toFixed(1) + ' A';
  }

  if (data.ble_rssi || data.rssi) {
    const rssi = data.ble_rssi || data.rssi;
    if (el.rssiValue) el.rssiValue.textContent = `${rssi} dBm`;
  }

  if (data.chip_temp !== undefined) {
    if (el.chipTempValue) el.chipTempValue.textContent = `${Number(data.chip_temp).toFixed(1)} °C`;
    const ctDiag = document.getElementById('chipTempDiag');
    if (ctDiag) ctDiag.textContent = Number(data.chip_temp).toFixed(1);
  }
  if (data.free_heap_kb !== undefined) {
    const fhDiag = document.getElementById('freeHeapDiag');
    if (fhDiag) fhDiag.textContent = data.free_heap_kb;
  }
  if (data.buffered_records !== undefined) {
    const bufDiag = document.getElementById('bufferCountDiag');
    if (bufDiag) bufDiag.textContent = data.buffered_records;
    const csvLink = document.getElementById('bufferCsvLink');
    if (csvLink && activeEndpoint) {
      csvLink.href = `${activeEndpoint}/api/buffer/csv`;
    }
  }

  const downSpeed = (data.cell_down_mbps !== undefined && Number(data.cell_down_mbps) > 0) ? data.cell_down_mbps : data.net_mbps;
  const upSpeed = (data.cell_up_mbps !== undefined && Number(data.cell_up_mbps) > 0) ? data.cell_up_mbps : data.net_up_mbps;

  if (downSpeed !== undefined && Number(downSpeed) > 0) {
    const downStr = Number(downSpeed).toFixed(2);
    const upStr = (upSpeed !== undefined && Number(upSpeed) > 0) ? ` / ⬆️ ${Number(upSpeed).toFixed(2)}` : '';
    const ping = data.net_ping_ms !== undefined ? ` (${data.net_ping_ms} ms)` : '';
    if (el.netSpeedValue) el.netSpeedValue.textContent = `⬇️ ${downStr}${upStr} Mbit/s${ping}`;

    const elDown = document.getElementById('cellDownMbps') || document.getElementById('netDownMbps');
    if (elDown) elDown.textContent = downStr;
  }
  if (upSpeed !== undefined && Number(upSpeed) > 0) {
    const elUp = document.getElementById('cellUpMbps') || document.getElementById('netUpMbps');
    if (elUp) elUp.textContent = Number(upSpeed).toFixed(2);
  }
  if (data.net_ping_ms !== undefined) {
    const elPing = document.getElementById('netPingMs');
    if (elPing) elPing.textContent = data.net_ping_ms;
  }
  if (data.gw_ping_ms !== undefined) {
    const elGw = document.getElementById('gwPingMs');
    if (elGw) elGw.textContent = data.gw_ping_ms;
  }
  if (data.dns_ms !== undefined) {
    const elDns = document.getElementById('netDnsMs');
    if (elDns) elDns.textContent = data.dns_ms;
  }
  if (data.ttfb_ms !== undefined) {
    const elTtfb = document.getElementById('netTtfbMs');
    if (elTtfb) elTtfb.textContent = data.ttfb_ms;
  }
  if (data.wifi_rssi !== undefined) {
    const elW = document.getElementById('wifiRssiDiag');
    if (elW) elW.textContent = data.wifi_rssi;
  }
  if (data.wifi_quality_pct !== undefined) {
    const elQ = document.getElementById('wifiQualDiag');
    if (elQ) elQ.textContent = data.wifi_quality_pct;
  }
  if (data.wifi_channel !== undefined) {
    const elC = document.getElementById('wifiChDiag');
    if (elC) elC.textContent = data.wifi_channel;
  }

  const hasCellData = Boolean(data.cell_has_data || data.cell_rsrp || data.cell_band || data.cell_operator);
  if (hasCellData) {
    const elRsrp = document.getElementById('cellRsrp');
    if (elRsrp && data.cell_rsrp !== undefined) elRsrp.textContent = data.cell_rsrp;
    const elSinr = document.getElementById('cellSinr');
    if (elSinr && data.cell_sinr !== undefined) elSinr.textContent = data.cell_sinr;
    const elBand = document.getElementById('cellBand');
    if (elBand && data.cell_band) elBand.textContent = data.cell_band;
    const elQual = document.getElementById('cellQual');
    if (elQual && data.cell_qual !== undefined) elQual.textContent = data.cell_qual;
    const elOp = document.getElementById('cellProvider') || document.getElementById('cellOperator');
    if (elOp && data.cell_operator) elOp.textContent = data.cell_operator;
    const elMode = document.getElementById('cellMode');
    if (elMode && data.cell_mode) elMode.textContent = data.cell_mode;
    const elId = document.getElementById('cellId');
    if (elId && data.cell_id) elId.textContent = data.cell_id;
    const elTemp = document.getElementById('cellTemp');
    if (elTemp && data.cell_temp !== undefined) elTemp.textContent = Number(data.cell_temp).toFixed(1);

    if (downSpeed !== undefined && Number(downSpeed) > 0) {
      const elCellDown = document.getElementById('cellDownMbps');
      if (elCellDown) elCellDown.textContent = Number(downSpeed).toFixed(2);
      const elCellUp = document.getElementById('cellUpMbps');
      if (elCellUp) elCellUp.textContent = Number(upSpeed).toFixed(2);
    }
  }

  if (data.ip && el.statusText) {
    el.statusText.textContent = `Live: ${data.ip}`;
  }

  lastTelemetryData = data;
  updateDerivedStats(solarW, v);

  const moodEl = document.getElementById('liveMoodText');
  if (moodEl) {
    moodEl.textContent = getHumanMoodText(data, currentLang);
  }

  setOnlineStatus(true);
}

function setOnlineStatus(online) {
  if (!el.connectionStatus) return;
  if (online) {
    el.connectionStatus.className = 'status-indicator';
    if (el.statusText && !isDemoMode) el.statusText.textContent = 'BLE Empfang';
  } else {
    el.connectionStatus.className = 'status-indicator offline';
    if (el.statusText) el.statusText.textContent = 'Kein Signal';
  }
}

function appendChartPoint(item, force = false) {
  const now = Date.now();
  if (!force && (now - lastChartAppendTime < CHART_THROTTLE_MS)) {
    return; // Calm update rate: only append points every 4-5s
  }
  lastChartAppendTime = now;

  const ptTime = item.created_at ? new Date(item.created_at).getTime() : now;
  const sinceTime = now - currentHours * 3600 * 1000;

  // 1. Solar Power (W) & Battery Voltage (V)
  if (solarChartInstance) {
    solarChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.solar_power || 0 });
    solarChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.battery_voltage || 0 });

    solarChartInstance.options.scales.x.min = sinceTime;
    solarChartInstance.options.scales.x.max = now;

    solarChartInstance.data.datasets.forEach(ds => {
      while (ds.data.length > 0 && ds.data[0].x < sinceTime) ds.data.shift();
    });
    solarChartInstance.update('none');
  }

  // 2. Charging Current (A) & External Load (A)
  if (chargeChartInstance) {
    chargeChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.battery_charging_current || item.battery_current || 0 });
    chargeChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.external_load || 0 });

    chargeChartInstance.options.scales.x.min = sinceTime;
    chargeChartInstance.options.scales.x.max = now;

    chargeChartInstance.data.datasets.forEach(ds => {
      while (ds.data.length > 0 && ds.data[0].x < sinceTime) ds.data.shift();
    });
    chargeChartInstance.update('none');
  }

  // 3. Internet Speed (Mbit/s) & Latency (ms) & Weather Overlay
  if (netChartInstance && (item.net_mbps !== undefined || item.net_ping_ms !== undefined)) {
    netChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.net_mbps || 0 });
    netChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.net_up_mbps || 0 });
    netChartInstance.data.datasets[2].data.push({ x: ptTime, y: item.net_ping_ms || 0 });
    netChartInstance.data.datasets[3].data.push({ x: ptTime, y: item.gw_ping_ms || 0 });
    if (netChartInstance.data.datasets[4]) netChartInstance.data.datasets[4].data.push({ x: ptTime, y: item.wx_rain_mm !== undefined && item.wx_rain_mm !== null ? item.wx_rain_mm : null });
    if (netChartInstance.data.datasets[5]) netChartInstance.data.datasets[5].data.push({ x: ptTime, y: item.wx_cloud_pct !== undefined && item.wx_cloud_pct !== null ? item.wx_cloud_pct : null });

    netChartInstance.options.scales.x.min = sinceTime;
    netChartInstance.options.scales.x.max = now;

    netChartInstance.data.datasets.forEach(ds => {
      while (ds.data.length > 0 && ds.data[0].x < sinceTime) ds.data.shift();
    });
    netChartInstance.update('none');
  }

  // 4. Local Weather & Microclimate History
  if (weatherChartInstance && (item.wx_temp !== undefined || item.wx_solar_wm2 !== undefined || item.wx_cloud_pct !== undefined)) {
    weatherChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.wx_solar_wm2 !== undefined && item.wx_solar_wm2 !== null ? item.wx_solar_wm2 : null });
    weatherChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.wx_temp !== undefined && item.wx_temp !== null ? item.wx_temp : null });
    weatherChartInstance.data.datasets[2].data.push({ x: ptTime, y: item.wx_cloud_pct !== undefined && item.wx_cloud_pct !== null ? item.wx_cloud_pct : null });
    weatherChartInstance.data.datasets[3].data.push({ x: ptTime, y: item.wx_rain_mm !== undefined && item.wx_rain_mm !== null ? item.wx_rain_mm : null });

    weatherChartInstance.options.scales.x.min = sinceTime;
    weatherChartInstance.options.scales.x.max = now;

    weatherChartInstance.data.datasets.forEach(ds => {
      while (ds.data.length > 0 && ds.data[0].x < sinceTime) ds.data.shift();
    });
    weatherChartInstance.update('none');
  }
}

// Fetch live telemetry (try local API, custom endpoint, or demo mode)
async function fetchLiveTelemetry(explicit = false) {
  const isHttps = window.location.protocol === 'https:';

  // When loaded over HTTPS (like GitHub Pages), do NOT automatically ping private HTTP network IPs.
  // MQTT over WebSocket handles live data seamlessly on HTTPS.
  if (isHttps && !explicit) {
    return;
  }

  const endpointsToTry = [];
  if (!isHttps) {
    endpointsToTry.push('/api/live');
    if (activeEndpoint) endpointsToTry.push(`${activeEndpoint}/api/live`);
    endpointsToTry.push('http://randesolar.local/api/live');
    endpointsToTry.push('http://192.168.1.100/api/live');
  } else if (explicit && activeEndpoint) {
    endpointsToTry.push(activeEndpoint.endsWith('/api/live') ? activeEndpoint : `${activeEndpoint}/api/live`);
  }

  for (const url of endpointsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const payload = json.data || json;
        if (payload.has_data !== false) {
          isDemoMode = false;
          if (el.diagSource) el.diagSource.textContent = url.includes('192.168') || url.includes('.local') ? 'ESP32 Lab' : 'Local Host';
          updateDashboard(payload);
          appendChartPoint(payload);
          return;
        }
      }
    } catch (e) {
      // Continue to next endpoint
    }
  }
}

// Live interactive simulation for public GitHub Pages visitors
function runSimulationStep(force = false) {
  isDemoMode = true;
  if (el.diagSource) el.diagSource.textContent = 'Demo Mode (Sim)';
  if (el.statusText) el.statusText.textContent = 'Demo Modus';

  // Smooth realistic solar dynamics
  const t = Date.now() / 10000;
  simSolarWatts = Math.max(0, Math.round(35 + 20 * Math.sin(t) + (Math.random() * 4 - 2)));
  const simCurrent = simSolarWatts > 0 ? (simSolarWatts / 13.2) : 0.0;
  simBattVolts = Number((12.65 + (simSolarWatts > 10 ? 0.35 : 0.05) + Math.sin(t * 0.5) * 0.05).toFixed(2));

  const demoData = {
    has_data: true,
    solar_power: simSolarWatts,
    battery_voltage: simBattVolts,
    battery_charging_current: Number(simCurrent.toFixed(1)),
    yield_today_wh: 850 + Math.floor((Date.now() % 3600000) / 1000),
    external_load: 0.2,
    charge_state: simSolarWatts > 25 ? 3 : (simSolarWatts > 5 ? 4 : 5),
    state_str: simSolarWatts > 25 ? 'BULK' : (simSolarWatts > 5 ? 'ABSORPTION' : 'FLOAT'),
    charger_error: 0,
    rssi: -72 + Math.floor(Math.random() * 6 - 3),
  };

  updateDashboard(demoData);
  appendChartPoint(demoData, force);
}

// Timer tick
setInterval(() => {
  if (!lastBeaconTime) {
    if (el.lastSeenTimer) el.lastSeenTimer.textContent = 'Warte...';
    return;
  }
  const sec = Math.floor((Date.now() - lastBeaconTime) / 1000);
  if (el.lastSeenTimer) {
    if (sec < 3) {
      el.lastSeenTimer.textContent = currentLang === 'de' ? 'Live' : 'Live';
    } else if (sec < 60) {
      el.lastSeenTimer.textContent = `${sec}` + (currentLang === 'de' ? 's vor' : 's ago');
    } else {
      el.lastSeenTimer.textContent = `${Math.floor(sec / 60)}` + (currentLang === 'de' ? 'm vor' : 'm ago');
    }
  }
}, 1000);

// Supabase Cloud History Integration
const SUPABASE_URL = "https://pakfuetvwpffwfrrxshz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU";

async function loadSupabaseHistory(limit = 240, hours = 1) {
  try {
    currentHours = hours || 1;
    let url = `${SUPABASE_URL}/rest/v1/solar_telemetry?select=*&order=created_at.desc&limit=${limit}`;
    if (hours && hours > 0) {
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      url = `${SUPABASE_URL}/rest/v1/solar_telemetry?select=*&created_at=gte.${since}&order=created_at.desc&limit=${limit}`;
    }

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return;

    // Sort chronologically (oldest to newest)
    rows.reverse();

    // Calculate derived daily/window stats across the full row collection
    rows.forEach(item => {
      if (item.solar_power !== undefined && item.battery_voltage) {
        updateDerivedStats(Number(item.solar_power), Number(item.battery_voltage));
      }
    });

    const nowTime = Date.now();
    const sinceTime = hours && hours > 0 ? (nowTime - hours * 3600 * 1000) : (nowTime - 3600 * 1000);

    const setChartBounds = (chart) => {
      if (!chart) return;
      chart.options.scales.x.min = sinceTime;
      chart.options.scales.x.max = nowTime;
    };
    setChartBounds(solarChartInstance);
    setChartBounds(chargeChartInstance);
    setChartBounds(netChartInstance);
    setChartBounds(weatherChartInstance);

    if (solarChartInstance) {
      solarChartInstance.data.datasets[0].data = [];
      solarChartInstance.data.datasets[1].data = [];
    }

    if (chargeChartInstance) {
      chargeChartInstance.data.datasets[0].data = [];
      chargeChartInstance.data.datasets[1].data = [];
    }

    if (netChartInstance) {
      netChartInstance.data.datasets[0].data = [];
      netChartInstance.data.datasets[1].data = [];
      netChartInstance.data.datasets[2].data = [];
      netChartInstance.data.datasets[3].data = [];
      if (netChartInstance.data.datasets[4]) netChartInstance.data.datasets[4].data = [];
      if (netChartInstance.data.datasets[5]) netChartInstance.data.datasets[5].data = [];
    }

    if (weatherChartInstance) {
      weatherChartInstance.data.datasets[0].data = [];
      weatherChartInstance.data.datasets[1].data = [];
      weatherChartInstance.data.datasets[2].data = [];
      weatherChartInstance.data.datasets[3].data = [];
    }

    // Downsample chart data points if dataset is dense (e.g. 1 week), keeps 60fps rendering
    let displayRows = rows;
    if (rows.length > 800) {
      const step = Math.ceil(rows.length / 800);
      displayRows = rows.filter((_, idx) => idx % step === 0 || idx === rows.length - 1);
    }

    displayRows.forEach(item => {
      const ptTime = new Date(item.created_at).getTime();

      if (solarChartInstance) {
        solarChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.solar_power || 0 });
        solarChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.battery_voltage || 0 });
      }

      if (chargeChartInstance) {
        chargeChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.battery_current || 0 });
        chargeChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.external_load || 0 });
      }

      if (netChartInstance && (item.net_mbps !== undefined || item.net_ping_ms !== undefined)) {
        netChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.net_mbps || 0 });
        netChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.net_up_mbps || 0 });
        netChartInstance.data.datasets[2].data.push({ x: ptTime, y: item.net_ping_ms || 0 });
        netChartInstance.data.datasets[3].data.push({ x: ptTime, y: item.gw_ping_ms || 0 });
        if (netChartInstance.data.datasets[4]) netChartInstance.data.datasets[4].data.push({ x: ptTime, y: item.wx_rain_mm !== undefined && item.wx_rain_mm !== null ? item.wx_rain_mm : null });
        if (netChartInstance.data.datasets[5]) netChartInstance.data.datasets[5].data.push({ x: ptTime, y: item.wx_cloud_pct !== undefined && item.wx_cloud_pct !== null ? item.wx_cloud_pct : null });
      }

      if (weatherChartInstance && (item.wx_temp !== undefined || item.wx_solar_wm2 !== undefined || item.wx_cloud_pct !== undefined)) {
        weatherChartInstance.data.datasets[0].data.push({ x: ptTime, y: item.wx_solar_wm2 !== undefined && item.wx_solar_wm2 !== null ? item.wx_solar_wm2 : null });
        weatherChartInstance.data.datasets[1].data.push({ x: ptTime, y: item.wx_temp !== undefined && item.wx_temp !== null ? item.wx_temp : null });
        weatherChartInstance.data.datasets[2].data.push({ x: ptTime, y: item.wx_cloud_pct !== undefined && item.wx_cloud_pct !== null ? item.wx_cloud_pct : null });
        weatherChartInstance.data.datasets[3].data.push({ x: ptTime, y: item.wx_rain_mm !== undefined && item.wx_rain_mm !== null ? item.wx_rain_mm : null });
      }
    });

    if (solarChartInstance) solarChartInstance.update('none');
    if (chargeChartInstance) chargeChartInstance.update('none');
    if (netChartInstance) netChartInstance.update('none');
    if (weatherChartInstance) weatherChartInstance.update('none');

    // Populate dashboard cards with the latest record
    const latest = rows[rows.length - 1];
    if (latest && isDemoMode) {
      isDemoMode = false;
      updateDashboard(latest);
    }
    console.log(`[Supabase ⚡] Loaded ${rows.length} historical points for ${currentHours}h!`);
  } catch (err) {
    console.warn('[Supabase] History fetch warning:', err);
  }
}

async function fetchYesterdayYield() {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const url = `${SUPABASE_URL}/rest/v1/solar_telemetry?select=yield_today_wh&created_at=lt.${todayStart.toISOString()}&order=created_at.desc&limit=1`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0 && data[0].yield_today_wh) {
        const kwh = (data[0].yield_today_wh / 1000).toFixed(2);
        if (el.yieldYesterday) el.yieldYesterday.textContent = `${kwh} kWh`;
      } else {
        if (el.yieldYesterday) el.yieldYesterday.textContent = `0.00 kWh`;
      }
    }
  } catch (e) {
    console.warn("fetchYesterdayYield:", e);
  }
}

// Setup Timeframe selector buttons (10m, 1h, 6h, 24h, 1w)
document.querySelectorAll('#timeframeSelector button').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const button = e.currentTarget || e.target;
    document.querySelectorAll('#timeframeSelector button').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    currentLimit = parseInt(button.dataset.limit || '250', 10);
    const hours = parseFloat(button.dataset.hours || '1');
    loadSupabaseHistory(currentLimit, hours);
  });
});

// HiveMQ MQTT over WebSocket (WSS) Client
const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPIC = 'randelab/solar/telemetry';
let mqttClient = null;

function initMQTT() {
  if (typeof mqtt === 'undefined') {
    console.warn('[MQTT] mqtt.js library not loaded.');
    return;
  }
  try {
    const clientId = 'RandeSolar-Web-' + Math.random().toString(16).substring(2, 8);
    mqttClient = mqtt.connect(MQTT_BROKER_URL, {
      clientId: clientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 3000
    });

    mqttClient.on('connect', () => {
      console.log('[MQTT] Connected to HiveMQ WebSocket Broker!');
      if (el.statusText) el.statusText.textContent = 'Live MQTT (HiveMQ)';
      if (el.diagSource) el.diagSource.textContent = 'HiveMQ Cloud WSS';
      mqttClient.subscribe(MQTT_TOPIC, (err) => {
        if (!err) console.log(`[MQTT] Subscribed to ${MQTT_TOPIC}`);
      });
    });

    mqttClient.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        isDemoMode = false;
        if (el.diagSource) el.diagSource.textContent = 'HiveMQ Cloud Live';
        if (el.statusText) el.statusText.textContent = 'Live MQTT (Hive)';
        updateDashboard(payload);
        appendChartPoint(payload);
      } catch (err) {
        console.error('MQTT parse error:', err);
      }
    });

    mqttClient.on('offline', () => {
      if (el.statusText && !isDemoMode) el.statusText.textContent = 'MQTT offline';
    });
  } catch (e) {
    console.error('Failed to initialize MQTT:', e);
  }
}

// Resolve exact Telegram Bot @username dynamically from Bot API
async function resolveTelegramBotLink() {
  const btn = document.getElementById('telegramBotBtn');
  if (!btn) return;
  try {
    const res = await fetch('https://api.telegram.org/bot8600149990:AAGGHL_USsmi_PfzPFBDIvoFgQx-rmvXIkc/getMe');
    if (res.ok) {
      const json = await res.json();
      if (json.ok && json.result && json.result.username) {
        const uname = json.result.username;
        btn.href = `https://t.me/${uname}`;
        btn.title = `@${uname} auf Telegram öffnen (/status, /mood, /speed)`;
      }
    }
  } catch (e) {
    // Fallback link remains active
  }
}

// Hyper-Localized Weather & Solar Radiation for RandeLab (Underes Ätzisloo 189, 8232 Merishausen / Randen)
// High-resolution MeteoSwiss ICON-CH model via Open-Meteo API
const RANDELAB_LAT = 47.7701;
const RANDELAB_LON = 8.5738;
const RANDELAB_ELEVATION = 857;

const WMO_WEATHER_CODES = {
  0: { de: "Wolkenlos", en: "Clear sky", icon: "☀️" },
  1: { de: "Überwiegend heiter", en: "Mainly clear", icon: "🌤️" },
  2: { de: "Teilweise bewölkt", en: "Partly cloudy", icon: "⛅" },
  3: { de: "Bedeckt", en: "Overcast", icon: "☁️" },
  45: { de: "Nebel", en: "Fog", icon: "🌫️" },
  48: { de: "Reifnebel / Hochnebel", en: "Depositing rime fog", icon: "🌫️" },
  51: { de: "Leichter Nieselregen", en: "Light drizzle", icon: "🌦️" },
  53: { de: "Mässiger Nieselregen", en: "Moderate drizzle", icon: "🌧️" },
  55: { de: "Dichter Nieselregen", en: "Dense drizzle", icon: "🌧️" },
  61: { de: "Leichter Regen", en: "Slight rain", icon: "🌦️" },
  63: { de: "Mässiger Regen", en: "Moderate rain", icon: "🌧️" },
  65: { de: "Starker Regen", en: "Heavy rain", icon: "🌧️" },
  71: { de: "Leichter Schneefall", en: "Slight snow", icon: "🌨️" },
  73: { de: "Schneefall", en: "Moderate snow", icon: "🌨️" },
  75: { de: "Starker Schneefall", en: "Heavy snow", icon: "❄️" },
  77: { de: "Schneegriesel", en: "Snow grains", icon: "❄️" },
  80: { de: "Leichte Regenschauer", en: "Slight rain showers", icon: "🌦️" },
  81: { de: "Regenschauer", en: "Moderate rain showers", icon: "🌧️" },
  82: { de: "Heftige Regenschauer", en: "Violent rain showers", icon: "⛈️" },
  85: { de: "Schneeschauer", en: "Snow showers", icon: "🌨️" },
  86: { de: "Starke Schneeschauer", en: "Heavy snow showers", icon: "❄️" },
  95: { de: "Gewitter", en: "Thunderstorm", icon: "⛈️" },
  96: { de: "Gewitter mit Hagel", en: "Thunderstorm with slight hail", icon: "⛈️" },
  99: { de: "Schweres Hagelgewitter", en: "Thunderstorm with heavy hail", icon: "⛈️" }
};

function getWindCompass(deg) {
  if (deg === undefined || deg === null) return "--";
  const sectors = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return sectors[Math.round(deg / 22.5) % 16];
}

async function fetchRandeLabWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${RANDELAB_LAT}&longitude=${RANDELAB_LON}&elevation=${RANDELAB_ELEVATION}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation,global_tilted_irradiance&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,sunshine_duration,uv_index_max&timezone=Europe%2FZurich&tilt=35&azimuth=0`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const cur = data.current;
    const daily = data.daily;
    if (!cur) return;

    const wmo = WMO_WEATHER_CODES[cur.weather_code] || { de: "Unbestimmt", en: "Unknown", icon: "🌤️" };
    const desc = currentLang === 'de' ? wmo.de : wmo.en;

    const setT = (id, val) => { const node = document.getElementById(id); if (node) node.textContent = val; };

    setT('wxIcon', wmo.icon);
    setT('wxTemp', cur.temperature_2m !== undefined ? cur.temperature_2m.toFixed(1) : '--');
    setT('wxDesc', desc);
    setT('wxApparent', cur.apparent_temperature !== undefined ? cur.apparent_temperature.toFixed(1) : '--');

    // Solar Irradiance
    const gti = cur.global_tilted_irradiance !== undefined ? Math.round(cur.global_tilted_irradiance) : Math.round(cur.shortwave_radiation || 0);
    setT('wxSolarWm2', gti);
    setT('wxDirectWm2', cur.direct_normal_irradiance !== undefined ? Math.round(cur.direct_normal_irradiance) : '--');
    setT('wxDiffuseWm2', cur.diffuse_radiation !== undefined ? Math.round(cur.diffuse_radiation) : '--');

    // Cloud layers
    setT('wxCloudTotal', cur.cloud_cover !== undefined ? cur.cloud_cover : '--');
    setT('wxCloudLow', cur.cloud_cover_low !== undefined ? cur.cloud_cover_low : '--');
    setT('wxCloudMid', cur.cloud_cover_mid !== undefined ? cur.cloud_cover_mid : '--');
    setT('wxCloudHigh', cur.cloud_cover_high !== undefined ? cur.cloud_cover_high : '--');

    // Wind on the Randen
    setT('wxWindSpeed', cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : '--');
    setT('wxWindDir', getWindCompass(cur.wind_direction_10m));
    setT('wxWindGusts', cur.wind_gusts_10m !== undefined ? Math.round(cur.wind_gusts_10m) : '--');

    // Humidity, Dew Point, Pressure
    setT('wxHumidity', cur.relative_humidity_2m !== undefined ? cur.relative_humidity_2m : '--');
    setT('wxPressure', cur.surface_pressure !== undefined ? Math.round(cur.surface_pressure) : '--');
    setT('wxPrecip', cur.precipitation !== undefined ? cur.precipitation.toFixed(1) : '0.0');

    // Simple Magnus formula for dew point
    if (cur.temperature_2m !== undefined && cur.relative_humidity_2m !== undefined) {
      const a = 17.27, b = 237.7;
      const alpha = ((a * cur.temperature_2m) / (b + cur.temperature_2m)) + Math.log(cur.relative_humidity_2m / 100.0);
      const dp = (b * alpha) / (a - alpha);
      setT('wxDewPoint', dp.toFixed(1));
    }

    // Daily Forecast
    if (daily) {
      if (daily.sunrise && daily.sunrise[0]) setT('wxSunrise', daily.sunrise[0].substring(11, 16));
      if (daily.sunset && daily.sunset[0]) setT('wxSunset', daily.sunset[0].substring(11, 16));
      if (daily.temperature_2m_min && daily.temperature_2m_min[0] !== undefined) setT('wxTempMin', Math.round(daily.temperature_2m_min[0]));
      if (daily.temperature_2m_max && daily.temperature_2m_max[0] !== undefined) setT('wxTempMax', Math.round(daily.temperature_2m_max[0]));
      if (daily.sunshine_duration && daily.sunshine_duration[0] !== undefined) {
        const sunH = (daily.sunshine_duration[0] / 3600).toFixed(1);
        setT('wxSunHours', sunH);
      }
      if (daily.uv_index_max && daily.uv_index_max[0] !== undefined) setT('wxUvMax', daily.uv_index_max[0].toFixed(1));
    }
  } catch (e) {
    console.warn('[Weather] Could not fetch RandeLab microclimate:', e);
  }
}

// Startup
window.addEventListener('DOMContentLoaded', () => {
  resolveTelegramBotLink();
  fetchRandeLabWeather();
  setInterval(fetchRandeLabWeather, 120000); // Refresh weather every 2 minutes
  const isHttps = window.location.protocol === 'https:';

  if (el.endpointInput) {
    if (isHttps) {
      el.endpointInput.value = 'HiveMQ Cloud (WSS)';
      el.endpointInput.title = 'Live telemetrie über HiveMQ WSS. Für lokales IP-Polling zu http wechseln.';
    } else {
      el.endpointInput.value = activeEndpoint;
    }
  }

  initChart();
  window.setTheme(currentTheme);

  // Load cloud history from Supabase (default 1h)
  loadSupabaseHistory(currentLimit, 1);
  fetchYesterdayYield();

  // Connect to live MQTT stream from HiveMQ
  initMQTT();

  // Only poll local network HTTP endpoints if NOT loaded over HTTPS
  if (!isHttps) {
    fetchLiveTelemetry();
    setInterval(() => {
      if (!mqttClient || !mqttClient.connected) {
        fetchLiveTelemetry();
      }
    }, 2500);
  }
});

