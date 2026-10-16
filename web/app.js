// RandeSolar - openBrushograph Studio Edition
let solarChartInstance = null;
let chargeChartInstance = null;
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

  // Plot 1: Solar & Battery
  const solarCanvas = document.getElementById('solarChart');
  if (solarCanvas) {
    const ctxSolar = solarCanvas.getContext('2d');
    solarChartInstance = new Chart(ctxSolar, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Solar (W)',
            data: [],
            borderColor: pal.solar,
            backgroundColor: pal.solarFill,
            borderWidth: 2.5,
            tension: 0.25,
            fill: true,
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
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: pal.text,
              font: { family: 'JetBrains Mono', size: 11, weight: '700' },
              boxWidth: 12,
              usePointStyle: true,
            }
          },
          tooltip: {
            backgroundColor: 'rgba(10, 0, 20, 0.95)',
            titleFont: { family: 'Outfit', size: 12 },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            borderColor: 'rgba(255, 107, 181, 0.4)',
            borderWidth: 1,
            padding: 8,
          }
        },
        scales: {
          x: {
            grid: { color: pal.grid },
            ticks: { color: pal.text, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 6 }
          },
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
        labels: [],
        datasets: [
          {
            label: 'Ladestrom (A)',
            data: [],
            borderColor: pal.curr,
            backgroundColor: pal.currFill || 'rgba(255, 107, 181, 0.2)',
            borderWidth: 2.2,
            tension: 0.25,
            fill: true,
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
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: pal.text,
              font: { family: 'JetBrains Mono', size: 11, weight: '700' },
              boxWidth: 12,
              usePointStyle: true,
            }
          },
          tooltip: {
            backgroundColor: 'rgba(10, 0, 20, 0.95)',
            titleFont: { family: 'Outfit', size: 12 },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            borderColor: 'rgba(255, 107, 181, 0.4)',
            borderWidth: 1,
            padding: 8,
          }
        },
        scales: {
          x: {
            grid: { color: pal.grid },
            ticks: { color: pal.text, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 6 }
          },
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

  const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 1. Solar Power (W) & Battery Voltage (V)
  if (solarChartInstance) {
    solarChartInstance.data.labels.push(timeLabel);
    solarChartInstance.data.datasets[0].data.push(item.solar_power || 0);
    solarChartInstance.data.datasets[1].data.push(item.battery_voltage || 0);

    while (solarChartInstance.data.labels.length > currentLimit) {
      solarChartInstance.data.labels.shift();
      solarChartInstance.data.datasets[0].data.shift();
      solarChartInstance.data.datasets[1].data.shift();
    }
    solarChartInstance.update('none');
  }

  // 2. Charging Current (A) & External Load (A)
  if (chargeChartInstance) {
    chargeChartInstance.data.labels.push(timeLabel);
    chargeChartInstance.data.datasets[0].data.push(item.battery_charging_current || item.battery_current || 0);
    chargeChartInstance.data.datasets[1].data.push(item.external_load || 0);

    while (chargeChartInstance.data.labels.length > currentLimit) {
      chargeChartInstance.data.labels.shift();
      chargeChartInstance.data.datasets[0].data.shift();
      chargeChartInstance.data.datasets[1].data.shift();
    }
    chargeChartInstance.update('none');
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
    endpointsToTry.push('http://192.168.1.101/api/live');
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

    if (solarChartInstance) {
      solarChartInstance.data.labels = [];
      solarChartInstance.data.datasets[0].data = [];
      solarChartInstance.data.datasets[1].data = [];
    }

    if (chargeChartInstance) {
      chargeChartInstance.data.labels = [];
      chargeChartInstance.data.datasets[0].data = [];
      chargeChartInstance.data.datasets[1].data = [];
    }

    // Downsample chart data points if dataset is dense (e.g. 1 week), keeps 60fps rendering
    let displayRows = rows;
    if (rows.length > 500) {
      const step = Math.ceil(rows.length / 500);
      displayRows = rows.filter((_, idx) => idx % step === 0 || idx === rows.length - 1);
    }

    displayRows.forEach(item => {
      const d = new Date(item.created_at);
      let timeLabel;
      if (currentHours >= 48) {
        // Multi-day format (e.g. "Fr 09:15" or "16.10 09:15")
        const dayStr = d.toLocaleDateString([], { weekday: 'short' });
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeLabel = `${dayStr} ${timeStr}`;
      } else if (currentHours >= 2) {
        // 6h, 24h: show "HH:MM"
        timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        // 10 min, 1h: show "HH:MM:SS" with seconds
        timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      if (solarChartInstance) {
        solarChartInstance.data.labels.push(timeLabel);
        solarChartInstance.data.datasets[0].data.push(item.solar_power || 0);
        solarChartInstance.data.datasets[1].data.push(item.battery_voltage || 0);
      }

      if (chargeChartInstance) {
        chargeChartInstance.data.labels.push(timeLabel);
        chargeChartInstance.data.datasets[0].data.push(item.battery_current || 0);
        chargeChartInstance.data.datasets[1].data.push(item.external_load || 0);
      }
    });

    if (solarChartInstance) solarChartInstance.update('none');
    if (chargeChartInstance) chargeChartInstance.update('none');

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

// Startup
window.addEventListener('DOMContentLoaded', () => {
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

