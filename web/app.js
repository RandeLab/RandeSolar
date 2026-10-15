// RandeSolar - openBrushograph Studio Edition
let chartInstance = null;
let currentLimit = 50;
let lastBeaconTime = null;
let currentTheme = localStorage.getItem('openbrushograph-studio-theme') || 'pinkograph';

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
  rssiValue: document.getElementById('rssiValue'),
  deviceModel: document.getElementById('deviceModel'),
  lastSeenTimer: document.getElementById('lastSeenTimer'),
  diagMac: document.getElementById('diagMac'),
  diagTotalRecords: document.getElementById('diagTotalRecords'),
  themeSelector: document.getElementById('theme-selector'),
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
  'dresden-dark': {
    solar: '#ffffff',
    solarFill: 'rgba(255, 255, 255, 0.2)',
    volt: '#dddddd',
    voltFill: 'rgba(221, 221, 221, 0.1)',
    curr: '#aaaaaa',
    grid: 'rgba(102, 102, 102, 0.25)',
    text: '#aaaaaa'
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

// Function called by theme selector dropdown
window.setTheme = function(theme) {
  currentTheme = theme;
  document.body.className = `theme-${theme}`;
  localStorage.setItem('openbrushograph-studio-theme', theme);

  if (el.themeSelector) {
    el.themeSelector.value = theme;
  }

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

// Initialize Chart
function initChart() {
  const ctx = document.getElementById('solarChart').getContext('2d');
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

  // Solar Values
  const solarW = Number(data.solar_power || 0);
  el.solarPower.textContent = solarW.toFixed(0);

  const yieldWh = Number(data.yield_today || 0);
  el.yieldToday.textContent = (yieldWh / 1000).toFixed(2) + ' kWh';

  // Battery Values
  const v = Number(data.battery_voltage || 0);
  el.batteryVoltage.textContent = v.toFixed(2);

  let soc = Math.round(Math.min(100, Math.max(0, ((v - 11.8) / (12.8 - 11.8)) * 100)));
  el.batteryBar.style.width = soc + '%';
  el.estSoc.textContent = `${soc}% (~12V)`;

  // Current & Flow
  const i = Number(data.battery_charging_current || 0);
  el.batteryCurrent.textContent = i.toFixed(1);
  const flowW = (v * i).toFixed(1);
  el.batteryPowerFlow.textContent = `${flowW} W`;

  // State pill
  const state = (data.charge_state || 'off').toLowerCase();
  el.chargeStatePill.textContent = state.toUpperCase();
  el.chargeStatePill.className = `state-pill state-${state}`;

  // Error Badge
  const err = data.charger_error || 'no_error';
  el.errorBadge.textContent = err === 'no_error' ? 'Normal' : err.replace('_', ' ').toUpperCase();

  // External load
  if (data.external_device_load !== undefined && data.external_device_load !== null) {
    el.externalLoad.textContent = Number(data.external_device_load).toFixed(1) + ' A';
  }

  // Signal & Info
  if (data.rssi) {
    el.rssiValue.textContent = `${data.rssi} dBm`;
  }
  if (data.model_name) {
    el.deviceModel.textContent = `${data.model_name}`;
  }
  if (data.address) {
    el.diagMac.textContent = data.address;
  }

  setOnlineStatus(true);
}

function setOnlineStatus(online) {
  if (online) {
    el.connectionStatus.className = 'status-indicator';
    el.connectionStatus.innerHTML = '<span class="dot"></span><span class="status-text">BLE Active</span>';
  } else {
    el.connectionStatus.className = 'status-indicator offline';
    el.connectionStatus.innerHTML = '<span class="dot"></span><span class="status-text">No Beacon</span>';
  }
}

function appendChartPoint(item) {
  if (!chartInstance) return;
  const timeLabel = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  chartInstance.data.labels.push(timeLabel);
  chartInstance.data.datasets[0].data.push(item.solar_power || 0);
  chartInstance.data.datasets[1].data.push(item.battery_voltage || 0);
  chartInstance.data.datasets[2].data.push(item.battery_charging_current || 0);

  while (chartInstance.data.labels.length > currentLimit) {
    chartInstance.data.labels.shift();
    chartInstance.data.datasets[0].data.shift();
    chartInstance.data.datasets[1].data.shift();
    chartInstance.data.datasets[2].data.shift();
  }

  chartInstance.update('none');
}

async function loadHistory(limit) {
  try {
    const res = await fetch(`/api/history?limit=${limit}`);
    const data = await res.json();
    if (!Array.isArray(data)) return;

    el.diagTotalRecords.textContent = data.length;

    if (chartInstance) {
      chartInstance.data.labels = [];
      chartInstance.data.datasets[0].data = [];
      chartInstance.data.datasets[1].data = [];
      chartInstance.data.datasets[2].data = [];

      data.forEach(item => {
        const timeLabel = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        chartInstance.data.labels.push(timeLabel);
        chartInstance.data.datasets[0].data.push(item.solar_power || 0);
        chartInstance.data.datasets[1].data.push(item.battery_voltage || 0);
        chartInstance.data.datasets[2].data.push(item.battery_charging_current || 0);
      });
      chartInstance.update();
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function connectSSE() {
  const eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    setOnlineStatus(true);
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateDashboard(data);
      appendChartPoint(data);
    } catch (e) {
      // Ping
    }
  };

  eventSource.onerror = () => {
    setOnlineStatus(false);
    eventSource.close();
    setTimeout(connectSSE, 3000);
  };
}

setInterval(() => {
  if (!lastBeaconTime) {
    el.lastSeenTimer.textContent = 'Waiting...';
    return;
  }
  const sec = Math.floor((Date.now() - lastBeaconTime) / 1000);
  if (sec < 3) {
    el.lastSeenTimer.textContent = 'Live';
  } else if (sec < 60) {
    el.lastSeenTimer.textContent = `${sec}s ago`;
  } else {
    el.lastSeenTimer.textContent = `${Math.floor(sec / 60)}m ago`;
    setOnlineStatus(false);
  }
}, 1000);

document.querySelectorAll('#timeframeSelector button').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('#timeframeSelector button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentLimit = parseInt(e.target.dataset.limit, 10);
    loadHistory(currentLimit);
  });
});

window.addEventListener('DOMContentLoaded', () => {
  initChart();
  window.setTheme(currentTheme);
  loadHistory(currentLimit);
  connectSSE();
});
