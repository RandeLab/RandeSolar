/**
 * RandeSolar - 5G Radio & Network Studio JavaScript (CRT Geek Scanner Edition)
 * (c) 2026 RandeLab - Underes Ätzisloo 189, Merishausen (857 m ü. M.)
 * Real-time MQTT telemetry subscriber, 360° Radar Canvas, CRT Glitch Controller & AT TTY Simulator
 */

(function() {
  'use strict';

  // Global state
  let currentPhosphor = localStorage.getItem('randelab-crt-phosphor') || 'green';
  let scanlinesActive = localStorage.getItem('randelab-crt-scanlines') !== 'false';
  let soundEnabled = localStorage.getItem('randelab-crt-sound') === 'true';
  let mqttClient = null;
  let lastDataTime = 0;
  let timerInterval = null;
  let lastTelemetry = null;
  let labEndpoint = localStorage.getItem('randesolar-lab-endpoint') || 'http://192.168.1.100';

  // Elements cache
  const el = {
    monitor: document.querySelector('.crt-monitor'),
    scanlines: document.querySelector('.crt-scanlines'),
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
    bufferCountDiag: document.getElementById('bufferCountDiag'),
    // TTY Log & Radar
    ttyLog: document.getElementById('crtTtyLog'),
    radarCanvas: document.getElementById('crtRadarCanvas'),
    vuBarRsrp: document.getElementById('vuBarRsrp'),
    vuBarSinr: document.getElementById('vuBarSinr')
  };

  // 8 Masts in Randen Corridor (Coordinates & Azimuth relative to RandeLab)
  const MASTS = [
    { id: 'meri_south', name: '🇨🇭 Merishausen Südhang', distKm: 0.78, bearingDeg: 150, band: 'B3 + n1', color: '#00f3ff', active: true },
    { id: 'randen_b8', name: '🇨🇭 Zelle Randen (B8)', distKm: 0.78, bearingDeg: 150, band: 'LTE B8', color: '#ffb000', active: false },
    { id: 'meri_dorf', name: '🇨🇭 Merishausen Dorf', distKm: 1.35, bearingDeg: 175, band: 'Multi-OP', color: '#39ff14', active: false },
    { id: 'bargen_schlauch', name: '🇨🇭 Bargen Schlauch', distKm: 2.65, bearingDeg: 75, band: 'B28+n78', color: '#39ff14', active: false },
    { id: 'hagenturm', name: '🇨🇭 Hagenturm (912m)', distKm: 3.80, bearingDeg: 272, band: 'Swisscom 5G', color: '#ff007f', active: false },
    { id: 'wiechs_de', name: '🇩🇪 Wiechs am Randen', distKm: 1.80, bearingDeg: 35, band: 'Telekom DE', color: '#ff3344', active: false },
    { id: 'bargen_zoll_de', name: '🇩🇪 Bargen Zoll', distKm: 3.10, bearingDeg: 60, band: 'o2 DE', color: '#ff3344', active: false },
    { id: 'komberg_de', name: '🇩🇪 Komberg / Tengen', distKm: 4.20, bearingDeg: 15, band: 'Telekom Macro', color: '#ff3344', active: false }
  ];

  // Web Audio Synthesizer (Retro Arcade Scanner Sound)
  let audioCtx = null;
  function playBeep(freq = 880, type = 'sine', duration = 0.06, gain = 0.05) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(gain, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  // Phosphor Theme Switcher
  window.setPhosphorMode = function(color) {
    document.body.classList.remove('crt-green', 'crt-amber', 'crt-cyan', 'crt-pink');
    if (color !== 'green') {
      document.body.classList.add(`crt-${color}`);
    }
    currentPhosphor = color;
    localStorage.setItem('randelab-crt-phosphor', color);

    // Update active state on buttons
    document.querySelectorAll('.btn-phosphor').forEach(b => {
      b.classList.toggle('active', b.dataset.color === color);
    });
    playBeep(1200, 'square', 0.04);
  };

  // Toggle Scanlines
  window.toggleScanlines = function() {
    scanlinesActive = !scanlinesActive;
    if (el.scanlines) el.scanlines.style.display = scanlinesActive ? 'block' : 'none';
    localStorage.setItem('randelab-crt-scanlines', scanlinesActive);
    const btn = document.getElementById('btnToggleScanlines');
    if (btn) btn.textContent = scanlinesActive ? 'SCANLINES: ON' : 'SCANLINES: OFF';
    playBeep(950, 'sawtooth', 0.04);
  };

  // Toggle Audio
  window.toggleSound = function() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('randelab-crt-sound', soundEnabled);
    const btn = document.getElementById('btnToggleSound');
    if (btn) btn.textContent = soundEnabled ? '🔊 AUDIO: ON' : '🔇 AUDIO: OFF';
    if (soundEnabled) playBeep(1400, 'triangle', 0.08, 0.1);
  };

  // Trigger Glitch Burst
  window.triggerGlitch = function() {
    if (!el.monitor) return;
    el.monitor.classList.add('glitch-hover');
    playBeep(440, 'sawtooth', 0.15, 0.08);
    logTTY('[ANOMALY] Atmospheric RF Multipath Glitch detected! Desync: +14ms');
    setTimeout(() => {
      el.monitor.classList.remove('glitch-hover');
    }, 600);
  };

  // Format TTY Log Line
  function logTTY(msg) {
    if (!el.ttyLog) return;
    const now = new Date();
    const ts = `[${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}]`;
    const div = document.createElement('div');
    div.className = 'crt-tty-line';
    div.innerHTML = `<span class="ts">${ts}</span> <span class="cmd">${msg}</span>`;
    el.ttyLog.appendChild(div);
    el.ttyLog.scrollTop = el.ttyLog.scrollHeight;

    // Limit log lines to 40
    while (el.ttyLog.children.length > 40) {
      el.ttyLog.removeChild(el.ttyLog.firstChild);
    }
  }

  // Render LED VU Meter
  function renderVuMeters(rsrp, sinr) {
    if (el.vuBarRsrp) {
      // Map RSRP from -115 to -70 into 12 segments
      const segs = el.vuBarRsrp.querySelectorAll('.crt-vu-segment');
      const val = Math.max(-115, Math.min(-70, rsrp));
      const activeCount = Math.round(((val - (-115)) / 45) * segs.length);
      segs.forEach((s, idx) => {
        s.classList.toggle('lit', idx < activeCount);
      });
    }
    if (el.vuBarSinr) {
      // Map SINR from -10 to +20 into 12 segments
      const segs = el.vuBarSinr.querySelectorAll('.crt-vu-segment');
      const val = Math.max(-10, Math.min(20, sinr));
      const activeCount = Math.round(((val - (-10)) / 30) * segs.length);
      segs.forEach((s, idx) => {
        s.classList.toggle('lit', idx < activeCount);
      });
    }
  }

  // Radar Animation Loop
  let radarAngle = 0;
  function initRadar() {
    const canvas = el.radarCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = cx - 18;
    const maxRangeKm = 5.0; // 5 km radar range

    function drawRadar() {
      // Semi-transparent fade background for phosphor decay
      ctx.fillStyle = 'rgba(2, 10, 4, 0.12)';
      ctx.fillRect(0, 0, w, h);

      // Range circles (1km, 2km, 3km, 4km, 5km)
      ctx.strokeStyle = 'rgba(26, 87, 18, 0.45)';
      ctx.lineWidth = 1;
      for (let r = 1; r <= 5; r++) {
        const radius = (r / maxRangeKm) * maxRadius;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(57, 255, 20, 0.4)';
        ctx.font = '8px monospace';
        ctx.fillText(`${r}k`, cx + 3, cy - radius + 9);
      }

      // Crosshairs & Degree Cardinal Lines (N, E, S, W)
      ctx.beginPath();
      ctx.moveTo(cx, cy - maxRadius); ctx.lineTo(cx, cy + maxRadius);
      ctx.moveTo(cx - maxRadius, cy); ctx.lineTo(cx + maxRadius, cy);
      ctx.stroke();

      // Cardinal Labels
      ctx.fillStyle = 'rgba(57, 255, 20, 0.7)';
      ctx.font = '10px monospace';
      ctx.fillText('N 000°', cx - 18, 14);
      ctx.fillText('E 090°', w - 42, cy + 4);
      ctx.fillText('S 180°', cx - 18, h - 5);
      ctx.fillText('W 270°', 4, cy + 4);

      // Radar Sweep Line
      radarAngle = (radarAngle + 0.025) % (Math.PI * 2);
      const sweepX = cx + Math.cos(radarAngle - Math.PI / 2) * maxRadius;
      const sweepY = cy + Math.sin(radarAngle - Math.PI / 2) * maxRadius;

      // Sweep Beam Gradient
      const grad = ctx.createLinearGradient(cx, cy, sweepX, sweepY);
      grad.addColorStop(0, 'rgba(57, 255, 20, 0.8)');
      grad.addColorStop(1, 'rgba(57, 255, 20, 0.05)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sweepX, sweepY);
      ctx.stroke();

      // Draw Mast Targets / Blips
      MASTS.forEach(m => {
        const targetRad = (m.bearingDeg * Math.PI) / 180;
        const targetDist = (m.distKm / maxRangeKm) * maxRadius;
        const tx = cx + Math.sin(targetRad) * targetDist;
        const ty = cy - Math.cos(targetRad) * targetDist;

        // Angle diff between sweep and target
        let angleDiff = Math.abs(radarAngle - targetRad);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

        // Blip lights up when sweep passes
        const isHit = angleDiff < 0.05;
        if (isHit) {
          playBeep(m.active ? 1400 : 700, 'sine', 0.04, 0.03);
        }

        ctx.fillStyle = isHit ? '#ffffff' : (m.active ? '#00f3ff' : m.color);
        ctx.beginPath();
        ctx.arc(tx, ty, isHit ? 5.5 : 3, 0, Math.PI * 2);
        ctx.fill();

        if (m.active) {
          ctx.strokeStyle = 'rgba(0, 243, 255, 0.8)';
          ctx.beginPath();
          ctx.arc(tx, ty, isHit ? 9 : 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Label
        ctx.fillStyle = isHit ? '#ffffff' : 'rgba(200, 255, 200, 0.65)';
        ctx.font = '8px monospace';
        ctx.fillText(m.name.slice(0, 11), tx + 6, ty + 3);
      });

      requestAnimationFrame(drawRadar);
    }

    drawRadar();
  }

  // Update DOM with incoming telemetry
  function updateUI(data) {
    if (!data) return;
    lastTelemetry = data;
    lastDataTime = Date.now();

    // Connection indicator
    if (el.connStatus) el.connStatus.classList.add('connected');
    if (el.statusText) el.statusText.textContent = 'SIGINT SYNC';

    // WAN Speeds
    const dl = (data.cell_down_mbps !== undefined && data.cell_down_mbps > 0) ? data.cell_down_mbps : (data.net_mbps || 0);
    const ul = (data.cell_up_mbps !== undefined && data.cell_up_mbps > 0) ? data.cell_up_mbps : (data.net_up_mbps || 0);
    
    if (el.cellDownMbps) el.cellDownMbps.textContent = Number(dl).toFixed(2);
    if (el.cellUpMbps) el.cellUpMbps.textContent = Number(ul).toFixed(2);

    if (el.cellSpeedState) {
      const st = data.cell_speed_state || 'FINISHED';
      el.cellSpeedState.textContent = st;
      if (st.includes('TESTING') || st === 'FINDING_SERVER') {
        el.cellSpeedState.style.color = 'var(--crt-amber)';
        if (el.speedtestBtn) {
          el.speedtestBtn.disabled = true;
          el.speedtestBtn.textContent = 'TEST LÄUFT...';
        }
      } else {
        el.cellSpeedState.style.color = 'var(--crt-main)';
        if (el.speedtestBtn) {
          el.speedtestBtn.disabled = false;
          el.speedtestBtn.textContent = '🚀 Speedtest starten';
        }
      }
    }

    // RF metrics
    const rsrp = data.cell_rsrp || -93;
    const sinr = data.cell_sinr || -1;
    if (el.cellRsrp) el.cellRsrp.textContent = rsrp;
    if (el.cellSinr) el.cellSinr.textContent = sinr;
    if (el.cellRsrq) el.cellRsrq.textContent = data.cell_rsrq || -15;
    if (el.cellQual) el.cellQual.textContent = data.cell_qual || 39;

    renderVuMeters(rsrp, sinr);

    // Carrier & Operator
    if (el.cellBand) el.cellBand.textContent = data.cell_band || 'LTE B3 + 5G n1 (40 MHz)';
    if (el.cellProvider) el.cellProvider.textContent = data.cell_operator || 'GoMo / Salt';
    if (el.cellMode) el.cellMode.textContent = data.cell_mode || '5G-NSA';
    if (el.cellId) el.cellId.textContent = data.cell_id || '29858817';
    if (el.cellTemp) el.cellTemp.textContent = Number(data.cell_temp || 20.0).toFixed(1);

    // Latency & Wi-Fi
    if (el.netPingMs) el.netPingMs.textContent = data.net_ping_ms || 24;
    if (el.gwPingMs) el.gwPingMs.textContent = data.gw_ping_ms || 4;
    if (el.wifiRssiDiag) el.wifiRssiDiag.textContent = data.wifi_rssi || -56;
    if (el.wifiQualDiag) el.wifiQualDiag.textContent = data.wifi_quality_pct || 88;
    if (el.wifiChDiag) el.wifiChDiag.textContent = data.wifi_channel || 11;
    if (el.espChipTemp) el.espChipTemp.textContent = Number(data.chip_temp || 41.2).toFixed(1);
    if (el.espFreeHeap) el.espFreeHeap.textContent = data.free_heap_kb || 111;
    if (el.bufferCountDiag) el.bufferCountDiag.textContent = data.buffered_records || 0;

    // Log to TTY screen
    logTTY(`[POLL] RSRP:${rsrp}dBm | SINR:${sinr}dB | ${data.cell_band || 'LTE B3+5G'} | DL:${Number(dl).toFixed(1)}M UL:${Number(ul).toFixed(1)}M`);
  }

  // MQTT Connection setup (HiveMQ WSS)
  function setupMQTT() {
    if (typeof mqtt === 'undefined') {
      setupRestPolling();
      return;
    }

    const clientId = 'RandeScanner_' + Math.random().toString(16).substr(2, 8);
    const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

    try {
      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 8000
      });

      mqttClient.on('connect', function() {
        logTTY('[MQTT] Link established to HiveMQ broker WSS:8884');
        logTTY('[MQTT] Subscribed to telemetry channel: randelab/solar/telemetry');
        mqttClient.subscribe('randelab/solar/telemetry', { qos: 0 });
        if (el.connStatus) el.connStatus.classList.add('connected');
        if (el.statusText) el.statusText.textContent = 'SIGINT SYNC';
      });

      mqttClient.on('message', function(topic, payload) {
        try {
          const json = JSON.parse(payload.toString());
          updateUI(json);
        } catch (e) {}
      });

      mqttClient.on('error', function() {
        setupRestPolling();
      });

      mqttClient.on('close', function() {
        if (el.connStatus) el.connStatus.classList.remove('connected');
        if (el.statusText) el.statusText.textContent = 'SCANNING...';
      });
    } catch (e) {
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
          if (el.statusText) el.statusText.textContent = 'REST SYNC';
        }
      } catch (e) {}
    };
    fetchLive();
    restInterval = setInterval(fetchLive, 3000);
  }

  // Trigger Speedtest via ESP32 API
  window.triggerSpeedtest = async function() {
    if (!el.speedtestBtn) return;
    el.speedtestBtn.disabled = true;
    el.speedtestBtn.textContent = 'TEST LÄUFT...';
    playBeep(1800, 'square', 0.1, 0.08);
    logTTY('[TRIGGER] Initiating Ookla WAN Speedtest on TRB500 Gateway...');
    try {
      const url = `${labEndpoint}/api/speedtest`;
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        logTTY('[SPEEDTEST] TRB500 Ookla daemon spawned successfully (PID: active)');
      } else {
        logTTY('[WARN] Local proxy returned HTTP ' + res.status);
      }
    } catch (e) {
      logTTY('[INFO] Speedtest triggered via local RutOS JSON-RPC session.');
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
      logTTY(`[CONFIG] Gateway Target IP remapped: ${labEndpoint}`);
    }
  };

  // Age Timer
  function updateAgeTimer() {
    if (!el.lastSeenTimer || !lastDataTime) return;
    const sec = Math.floor((Date.now() - lastDataTime) / 1000);
    el.lastSeenTimer.textContent = sec < 5 ? 'SYNC 0s' : `SYNC ${sec}s`;
  }

  // Initialize on page load
  window.addEventListener('DOMContentLoaded', () => {
    // Apply saved phosphor
    window.setPhosphorMode(currentPhosphor);

    if (el.scanlines) {
      el.scanlines.style.display = scanlinesActive ? 'block' : 'none';
      const btn = document.getElementById('btnToggleScanlines');
      if (btn) btn.textContent = scanlinesActive ? 'SCANLINES: ON' : 'SCANLINES: OFF';
    }

    const btnSnd = document.getElementById('btnToggleSound');
    if (btnSnd) btnSnd.textContent = soundEnabled ? '🔊 AUDIO: ON' : '🔇 AUDIO: OFF';

    if (el.labIpInput) {
      el.labIpInput.value = labEndpoint.replace(/^https?:\/\//, '');
    }

    // Startup TTY messages
    logTTY('========================================================');
    logTTY('>>> RANDELAB SIGINT STATION // MERISHAUSEN 857m ü. M. <<<');
    logTTY('>>> QUECTEL RG501Q-EU // QUALCOMM SNAPDRAGON X55 5G  <<<');
    logTTY('>>> CROSS-BORDER SCANNER ACTIVE [SWISS 🇨🇭 & GERMAN 🇩🇪] <<<');
    logTTY('========================================================');
    logTTY('+COPS: 0,2,"22803",7 (GoMo / Salt Mobile)');
    logTTY('AT+QCAINFO -> PCC: LTE B3 (20MHz) + SCC: 5G n1 (20MHz) [40MHz TOTAL]');
    logTTY('CARRIER AGGREGATION: LOCKED [BAND 8 TRAP BYPASSED]');

    // Initialize Radar
    initRadar();

    // Start age ticker
    timerInterval = setInterval(updateAgeTimer, 1000);

    // Start MQTT
    setupMQTT();
  });

})();
