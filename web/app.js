// RandeSolar - openBrushograph Studio Edition
let chartInstance = null;
let currentLimit = 50;
let lastBeaconTime = null;
let currentTheme = localStorage.getItem('openbrushograph-studio-theme') || 'pinkograph';
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
  lblChartTitle: document.getElementById('lblChartTitle'),
};

// Studio Theme Palettes for Chart.js
const studioThemePalettes = {
  pinkograph: {
    solar: '#FFD400',
    solarFill: 'rgba(255, 212, 0, 0.2)',
    volt: '#00F5FF',
    voltFill: 'rgba(0, 245, 255, 0.15)',
    curr: '#FF6BB5',
    grid: 'rgba(255, 107, 181, 0.15)',
    text: '#E3A0C0'
  },
  randen: {
    solar: '#8A6A1F',
    solarFill: 'rgba(138, 106, 31, 0.2)',
    volt: '#4A6B3D',
    voltFill: 'rgba(74, 107, 61, 0.15)',
    curr: '#8B0000',
    grid: 'rgba(92, 75, 58, 0.2)',
    text: '#7A6A58'
  },
  'dresden-dark': {
    solar: '#ffffff',
    solarFill: 'rgba(255, 255, 255, 0.2)',
    volt: '#dddddd',
    voltFill: 'rgba(221, 221, 221, 0.1)',
    curr: '#aaaaaa',
    grid: 'rgba(102, 102, 102, 0.25)',
    text: '#aaaaaa'
  },
  dresden: {
    solar: '#1a1a1a',
    solarFill: 'rgba(26, 26, 26, 0.15)',
    volt: '#4f4f4f',
    voltFill: 'rgba(79, 79, 79, 0.1)',
    curr: '#2b2b2b',
    grid: 'rgba(140, 136, 126, 0.25)',
    text: '#5a574f'
  },
  tropical: {
    solar: '#facc15',
    solarFill: 'rgba(250, 204, 21, 0.2)',
    volt: '#00ffcc',
    voltFill: 'rgba(0, 255, 204, 0.15)',
    curr: '#ff00ff',
    grid: 'rgba(46, 139, 87, 0.25)',
    text: '#5ccc5c'
  },
  coconut: {
    solar: '#FFB000',
    solarFill: 'rgba(255, 176, 0, 0.2)',
    volt: '#4DFF88',
    voltFill: 'rgba(77, 255, 136, 0.15)',
    curr: '#33FF66',
    grid: 'rgba(31, 107, 60, 0.25)',
    text: '#2E9455'
  },
  bengaluru: {
    solar: '#fca311',
    solarFill: 'rgba(252, 163, 17, 0.2)',
    volt: '#2a9d8f',
    voltFill: 'rgba(42, 157, 143, 0.15)',
    curr: '#d90429',
    grid: 'rgba(252, 163, 17, 0.25)',
    text: '#f3d596'
  },
  uwu: {
    solar: '#E07A00',
    solarFill: 'rgba(224, 122, 0, 0.2)',
    volt: '#8E00C9',
    voltFill: 'rgba(142, 0, 201, 0.15)',
    curr: '#E5006E',
    grid: 'rgba(255, 159, 213, 0.3)',
    text: '#9E5480'
  },
  light: {
    solar: '#ffb700',
    solarFill: 'rgba(255, 183, 0, 0.2)',
    volt: '#56bdff',
    voltFill: 'rgba(86, 189, 255, 0.15)',
    curr: '#005b96',
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
    chartTitle: "Echtzeit-Telemetrie",
    states: { 0: "AUS", 2: "FEHLER", 3: "HAUPTLADUNG", 4: "NACHLADUNG", 5: "ERHALTUNG", 252: "EXT. STEUERUNG" }
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
    chartTitle: "Live Power Stream",
    states: { 0: "OFF", 2: "FAULT", 3: "BULK", 4: "ABSORPTION", 5: "FLOAT", 252: "EXT CONTROL" }
  }
};

let currentLang = "de";

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
  if (el.lblChartTitle) el.lblChartTitle.textContent = l.chartTitle;

  // Update Chart colors
  if (chartInstance) {
    const pal = studioThemePalettes[theme] || studioThemePalettes.pinkograph;
    chartInstance.data.datasets[0].borderColor = pal.solar;
    chartInstance.data.datasets[0].backgroundColor = pal.solarFill;
    chartInstance.data.datasets[1].borderColor = pal.volt;
    chartInstance.data.datasets[1].backgroundColor = pal.voltFill;
    chartInstance.data.datasets[2].borderColor = pal.curr;

    chartInstance.options.scales.x.grid.color = pal.grid;
    chartInstance.options.scales.x.ticks.color = pal.text;
    chartInstance.options.scales.yPower.grid.color = pal.grid;
    chartInstance.options.scales.yPower.ticks.color = pal.solar;
    chartInstance.options.scales.yPower.title.color = pal.solar;
    chartInstance.options.scales.yVoltage.ticks.color = pal.volt;
    chartInstance.options.scales.yVoltage.title.color = pal.volt;
    chartInstance.update();
  }
};

window.connectToCustomEndpoint = function() {
  if (el.endpointInput) {
    activeEndpoint = el.endpointInput.value.trim().replace(/\/$/, '');
    localStorage.setItem('randesolar-endpoint', activeEndpoint);
    fetchLiveTelemetry(true);
  }
};

// Initialize Chart
function initChart() {
  const canvas = document.getElementById('solarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pal = studioThemePalettes[currentTheme] || studioThemePalettes.pinkograph;

  chartInstance = new Chart(ctx, {
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
          label: 'Battery (V)',
          data: [],
          borderColor: pal.volt,
          backgroundColor: pal.voltFill,
          borderWidth: 2,
          tension: 0.25,
          fill: false,
          yAxisID: 'yVoltage',
          pointRadius: 2,
          pointHoverRadius: 5,
        },
        {
          label: 'Charging (A)',
          data: [],
          borderColor: pal.curr,
          borderWidth: 1.5,
          borderDash: [3, 3],
          tension: 0.2,
          fill: false,
          yAxisID: 'yCurrent',
          pointRadius: 1,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: {
        mode: 'index',
        intersect: false,
      },
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
          ticks: { color: pal.text, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 7 }
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
          title: { display: true, text: 'Battery (V)', color: pal.volt, font: { family: 'Outfit', size: 11 } },
          grid: { drawOnChartArea: false },
          ticks: { color: pal.volt, font: { family: 'JetBrains Mono', size: 10 } },
          suggestedMin: 11.5,
          suggestedMax: 14.5,
        },
        yCurrent: {
          type: 'linear',
          display: false,
          suggestedMin: 0,
        }
      }
    }
  });
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

  let soc = Math.round(Math.min(100, Math.max(0, ((v - 11.8) / 1.0) * 100)));
  if (el.batteryBar) el.batteryBar.style.width = soc + '%';
  if (el.estSoc) el.estSoc.textContent = `${soc}% (~12V)`;

  const i = Number(data.battery_charging_current || data.battery_current || 0);
  if (el.batteryCurrent) el.batteryCurrent.textContent = i.toFixed(1);
  const flowW = (v * i).toFixed(1);
  if (el.batteryPowerFlow) el.batteryPowerFlow.textContent = `${flowW} W`;

  // State translation
  const stateCode = data.charge_state || 0;
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

function appendChartPoint(item) {
  if (!chartInstance) return;
  const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  chartInstance.data.labels.push(timeLabel);
  chartInstance.data.datasets[0].data.push(item.solar_power || 0);
  chartInstance.data.datasets[1].data.push(item.battery_voltage || 0);
  chartInstance.data.datasets[2].data.push(item.battery_charging_current || item.battery_current || 0);

  while (chartInstance.data.labels.length > currentLimit) {
    chartInstance.data.labels.shift();
    chartInstance.data.datasets[0].data.shift();
    chartInstance.data.datasets[1].data.shift();
    chartInstance.data.datasets[2].data.shift();
  }

  chartInstance.update('none');
}

// Fetch live telemetry (try local API, custom endpoint, or demo mode)
async function fetchLiveTelemetry(explicit = false) {
  const isHttps = window.location.protocol === 'https:';

  // When loaded over HTTPS (like GitHub Pages), do NOT automatically ping private HTTP network IPs
  // because modern browsers will show a "Local Network Access" security prompt.
  // MQTT over WebSocket handles live data seamlessly on HTTPS.
  if (isHttps && !explicit) {
    if (!mqttClient || !mqttClient.connected) {
      runSimulationStep();
    }
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

  // Fallback if no endpoint answered
  if (!mqttClient || !mqttClient.connected) {
    runSimulationStep();
  }
}

// Live interactive simulation for public GitHub Pages visitors
function runSimulationStep() {
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
  appendChartPoint(demoData);
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

// Setup Timeframe selector buttons
document.querySelectorAll('#timeframeSelector button').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('#timeframeSelector button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentLimit = parseInt(e.target.dataset.limit, 10);
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

  // Pre-seed chart with initial points
  for (let k = 0; k < 12; k++) {
    runSimulationStep();
  }

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

