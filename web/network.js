/**
 * RandeSolar - 5G Radio & Network Studio JavaScript
 * (c) 2026 RandeLab - Underes Ätzisloo 189, Merishausen (857 m ü. M.)
 * Real-time MQTT telemetry subscriber & REST API client for Teltonika TRB500 / ESP32-S3
 */

(function() {
  'use strict';

  // Global state
  let currentTheme = localStorage.getItem('openbrushograph-studio-theme') || 'pinkograph';
  let currentLang = (currentTheme.startsWith('dresden') || currentTheme === 'randen') ? 'de' : 'en';
  let mqttClient = null;
  let lastDataTime = 0;
  let timerInterval = null;
  let lastTelemetry = null;
  let labEndpoint = localStorage.getItem('randesolar-lab-endpoint') || 'http://192.168.1.100';

  // Elements cache
  const el = {
    themeSelector: document.getElementById('theme-selector'),
    connStatus: document.getElementById('connectionStatus'),
    statusText: document.getElementById('statusText'),
    lastSeenTimer: document.getElementById('lastSeenTimer'),
    labIpInput: document.getElementById('endpointInput'),
    // WAN Speed
    cellDownMbps: document.getElementById('cellDownMbps'),
    cellUpMbps: document.getElementById('cellUpMbps'),
    cellSpeedState: document.getElementById('cellSpeedState'),
    speedtestBtn: document.getElementById('btnTriggerSpeedtest'),
    // RF Metrics
    cellRsrp: document.getElementById('cellRsrp'),
    cellSinr: document.getElementById('cellSinr'),
    cellRsrq: document.getElementById('cellRsrq'),
    cellQual: document.getElementById('cellQual'),
    cellBand: document.getElementById('cellBand'),
    cellProvider: document.getElementById('cellProvider'),
    cellMode: document.getElementById('cellMode'),
    cellId: document.getElementById('cellId'),
    cellTemp: document.getElementById('cellTemp'),
    // Network & Wi-Fi
    netPingMs: document.getElementById('netPingMs'),
    gwPingMs: document.getElementById('gwPingMs'),
    wifiRssiDiag: document.getElementById('wifiRssiDiag'),
    wifiQualDiag: document.getElementById('wifiQualDiag'),
    wifiChDiag: document.getElementById('wifiChDiag'),
    espChipTemp: document.getElementById('espChipTemp'),
    espFreeHeap: document.getElementById('espFreeHeap'),
    bufferCountDiag: document.getElementById('bufferCountDiag')
  };

  // Translations
  const i18n = {
    de: {
      statusConnecting: 'Verbinde...',
      statusConnected: 'MQTT Live',
      statusOffline: 'Offline',
      statusRest: 'REST API',
      triggerTest: 'Speedtest starten',
      testRunning: 'Test läuft...'
    },
    en: {
      statusConnecting: 'Connecting...',
      statusConnected: 'MQTT Live',
      statusOffline: 'Offline',
      statusRest: 'REST API',
      triggerTest: 'Run Speedtest',
      testRunning: 'Testing...'
    }
  };

  // Theme switcher
  window.setTheme = function(theme) {
    currentTheme = theme;
    document.body.className = `theme-${theme}`;
    localStorage.setItem('openbrushograph-studio-theme', theme);
    if (el.themeSelector) el.themeSelector.value = theme;
    currentLang = (theme.startsWith('dresden') || theme === 'randen') ? 'de' : 'en';
  };

  // Format age timer
  function updateAgeTimer() {
    if (!el.lastSeenTimer || !lastDataTime) return;
    const sec = Math.floor((Date.now() - lastDataTime) / 1000);
    if (sec < 5) {
      el.lastSeenTimer.textContent = currentLang === 'de' ? 'Live' : 'Live';
    } else if (sec < 60) {
      el.lastSeenTimer.textContent = `${sec}s`;
    } else {
      const min = Math.floor(sec / 60);
      el.lastSeenTimer.textContent = `${min}m ${sec % 60}s`;
    }
  }

  // Update DOM with incoming telemetry
  function updateUI(data) {
    if (!data) return;
    lastTelemetry = data;
    lastDataTime = Date.now();

    // Connection indicator
    if (el.connStatus) el.connStatus.classList.add('connected');
    if (el.statusText) el.statusText.textContent = i18n[currentLang].statusConnected;

    // WAN Speeds
    const dl = (data.cell_down_mbps !== undefined && data.cell_down_mbps > 0) ? data.cell_down_mbps : (data.net_mbps || 0);
    const ul = (data.cell_up_mbps !== undefined && data.cell_up_mbps > 0) ? data.cell_up_mbps : (data.net_up_mbps || 0);
    
    if (el.cellDownMbps) el.cellDownMbps.textContent = Number(dl).toFixed(2);
    if (el.cellUpMbps) el.cellUpMbps.textContent = Number(ul).toFixed(2);

    if (el.cellSpeedState) {
      const st = data.cell_speed_state || 'FINISHED';
      el.cellSpeedState.textContent = st;
      if (st.includes('TESTING') || st === 'FINDING_SERVER') {
        el.cellSpeedState.style.color = 'var(--accent-yellow)';
        if (el.speedtestBtn) {
          el.speedtestBtn.disabled = true;
          el.speedtestBtn.textContent = i18n[currentLang].testRunning;
        }
      } else {
        el.cellSpeedState.style.color = 'var(--accent-green)';
        if (el.speedtestBtn) {
          el.speedtestBtn.disabled = false;
          el.speedtestBtn.textContent = i18n[currentLang].triggerTest;
        }
      }
    }

    // RF metrics
    if (el.cellRsrp && data.cell_rsrp !== undefined) {
      el.cellRsrp.textContent = data.cell_rsrp;
      el.cellRsrp.style.color = data.cell_rsrp >= -85 ? 'var(--accent-green)' : (data.cell_rsrp >= -98 ? 'var(--accent-yellow)' : 'var(--accent-pink)');
    }
    if (el.cellSinr && data.cell_sinr !== undefined) {
      el.cellSinr.textContent = data.cell_sinr;
      el.cellSinr.style.color = data.cell_sinr >= 5 ? 'var(--accent-green)' : (data.cell_sinr >= 0 ? 'var(--accent-yellow)' : 'var(--accent-pink)');
    }
    if (el.cellRsrq && data.cell_rsrq !== undefined) el.cellRsrq.textContent = data.cell_rsrq;
    if (el.cellQual && data.cell_qual !== undefined) el.cellQual.textContent = data.cell_qual;

    // Carrier & Operator
    if (el.cellBand && data.cell_band) el.cellBand.textContent = data.cell_band;
    if (el.cellProvider && data.cell_operator) el.cellProvider.textContent = data.cell_operator;
    if (el.cellMode && data.cell_mode) el.cellMode.textContent = data.cell_mode;
    if (el.cellId && data.cell_id) el.cellId.textContent = data.cell_id;
    if (el.cellTemp && data.cell_temp !== undefined) el.cellTemp.textContent = Number(data.cell_temp).toFixed(1);

    // Latency & Wi-Fi
    if (el.netPingMs && data.net_ping_ms !== undefined) el.netPingMs.textContent = data.net_ping_ms;
    if (el.gwPingMs && data.gw_ping_ms !== undefined) el.gwPingMs.textContent = data.gw_ping_ms;
    if (el.wifiRssiDiag && data.wifi_rssi !== undefined) el.wifiRssiDiag.textContent = data.wifi_rssi;
    if (el.wifiQualDiag && data.wifi_quality_pct !== undefined) el.wifiQualDiag.textContent = data.wifi_quality_pct;
    if (el.wifiChDiag && data.wifi_channel !== undefined) el.wifiChDiag.textContent = data.wifi_channel;
    if (el.espChipTemp && data.chip_temp !== undefined) el.espChipTemp.textContent = Number(data.chip_temp).toFixed(1);
    if (el.espFreeHeap && data.free_heap_kb !== undefined) el.espFreeHeap.textContent = data.free_heap_kb;
    if (el.bufferCountDiag && data.buffered_records !== undefined) el.bufferCountDiag.textContent = data.buffered_records;
  }

  // MQTT Connection setup (HiveMQ WSS)
  function setupMQTT() {
    if (typeof mqtt === 'undefined') {
      console.warn('[MQTT] library not loaded, falling back to REST');
      setupRestPolling();
      return;
    }

    const clientId = 'RandeNetStudio_' + Math.random().toString(16).substr(2, 8);
    const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

    try {
      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 8000
      });

      mqttClient.on('connect', function() {
        console.log('[MQTT] Connected to HiveMQ Broker');
        mqttClient.subscribe('randelab/solar/telemetry', { qos: 0 }, function(err) {
          if (!err) console.log('[MQTT] Subscribed to randelab/solar/telemetry');
        });
        if (el.connStatus) el.connStatus.classList.add('connected');
        if (el.statusText) el.statusText.textContent = i18n[currentLang].statusConnected;
      });

      mqttClient.on('message', function(topic, payload) {
        try {
          const json = JSON.parse(payload.toString());
          updateUI(json);
        } catch (e) {
          console.error('[MQTT] JSON parse error', e);
        }
      });

      mqttClient.on('error', function(err) {
        console.warn('[MQTT] Error:', err);
        setupRestPolling();
      });

      mqttClient.on('close', function() {
        if (el.connStatus) el.connStatus.classList.remove('connected');
        if (el.statusText) el.statusText.textContent = i18n[currentLang].statusConnecting;
      });
    } catch (e) {
      console.error('[MQTT] Connection setup failed', e);
      setupRestPolling();
    }
  }

  // Fallback REST Polling from local Lab ESP32
  let restInterval = null;
  function setupRestPolling() {
    if (restInterval) return;
    const fetchLive = async () => {
      try {
        const url = `${labEndpoint}/api/live`;
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          updateUI(data);
          if (el.statusText) el.statusText.textContent = i18n[currentLang].statusRest;
        }
      } catch (e) {
        // Silent catch for network hiccups
      }
    };
    fetchLive();
    restInterval = setInterval(fetchLive, 3000);
  }

  // Trigger Speedtest via ESP32 API
  window.triggerSpeedtest = async function() {
    if (!el.speedtestBtn) return;
    el.speedtestBtn.disabled = true;
    el.speedtestBtn.textContent = i18n[currentLang].testRunning;
    try {
      const url = `${labEndpoint}/api/speedtest`;
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        console.log('[Speedtest] Triggered successfully');
      } else {
        alert('Speedtest konnte nicht ausgelöst werden (HTTP ' + res.status + ')');
      }
    } catch (e) {
      console.warn('[Speedtest] Local trigger failed, trying ubus direct...', e);
      alert('Tipp: Speedtest kann im lokalen Netz direkt über die Station oder das TRB500 WebUI ausgelöst werden.');
    }
  };

  // Lab Endpoint config change
  window.saveEndpoint = function() {
    if (el.labIpInput && el.labIpInput.value) {
      let val = el.labIpInput.value.trim();
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        val = 'http://' + val;
      }
      labEndpoint = val;
      localStorage.setItem('randesolar-lab-endpoint', labEndpoint);
      if (restInterval) {
        clearInterval(restInterval);
        restInterval = null;
      }
      setupRestPolling();
    }
  };

  // Initialize on page load
  window.addEventListener('DOMContentLoaded', () => {
    // Apply saved theme
    window.setTheme(currentTheme);

    if (el.labIpInput) {
      el.labIpInput.value = labEndpoint.replace(/^https?:\/\//, '');
    }

    // Start age ticker
    timerInterval = setInterval(updateAgeTimer, 1000);

    // Start MQTT
    setupMQTT();
  });

})();
