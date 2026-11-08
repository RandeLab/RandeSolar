/**
 * RandeLab Wi-Fi 2.4/5GHz SIGINT & War-Driving Studio (web/wifi.js)
 * High-performance CRT spectrum visualizer, 360° tactical wardriving radar,
 * Web Audio procedural Wi-Fi Geiger counter, 4 retro synth soundscapes,
 * ESP32-S3 hardware integration (/api/wifi/scan) with offline Randen fallback.
 */

(function () {
  'use strict';

  // --- OUI Vendor Database (Common Local & Industrial Vendors) ---
  const OUI_TABLE = [
    { prefix: '00:1e:42', vendor: 'Teltonika Networks' },
    { prefix: '34:85:18', vendor: 'Espressif Systems (ESP32-S3)' },
    { prefix: '24:0a:c4', vendor: 'Espressif Systems' },
    { prefix: 'dc:39:6f', vendor: 'AVM Fritz!Box' },
    { prefix: '24:a4:3c', vendor: 'Ubiquiti Networks' },
    { prefix: '78:8a:20', vendor: 'Ubiquiti Networks' },
    { prefix: '48:8f:5a', vendor: 'MikroTik RouterBOARD' },
    { prefix: '7c:26:34', vendor: 'Swisscom / Arcadyan' },
    { prefix: 'b8:27:eb', vendor: 'Raspberry Pi Foundation' },
    { prefix: 'dc:a6:32', vendor: 'Raspberry Pi Foundation' },
    { prefix: '10:d0:7a', vendor: 'Tuya Smart / IoT' },
    { prefix: 'ac:1f:0f', vendor: 'RAKwireless LoRaWAN' },
    { prefix: 'e4:5f:01', vendor: 'Raspberry Pi 4' },
    { prefix: 'f0:18:98', vendor: 'Apple Inc.' },
    { prefix: '3c:22:fb', vendor: 'Apple Inc.' },
    { prefix: '00:0c:29', vendor: 'VMware Virtual AP' },
    { prefix: 'b4:fb:e4', vendor: 'Intel Wireless' },
  ];

  function lookupVendor(bssid) {
    if (!bssid) return 'Unknown Vendor';
    const clean = bssid.toLowerCase().replace(/[:-]/g, '');
    for (const entry of OUI_TABLE) {
      const p = entry.prefix.toLowerCase().replace(/[:-]/g, '');
      if (clean.startsWith(p)) return entry.vendor;
    }
    return 'Generic 802.11';
  }

  // --- Wi-Fi State (Real Scanned Hardware Data Only) ---
  let networks = [];
  let selectedNetwork = null;
  let isScanning = false;
  let autoScanTimer = null;
  let autoScanIntervalSec = 5;
  let radarSweepAngle = 0;
  let radarSpeedMultiplier = 1.0;
  let radarAnimId = null;
  let isMuted = false;
  let isGeigerActive = true;
  let currentSoundscape = 'analog'; // 'analog', 'sid', 'fm', 'tube'
  let audioCtx = null;
  let geigerTimer = null;
  let mqttClient = null;

  // --- Procedural Web Audio Engine ---
  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Mechanical Switch Click
  function playClickSound() {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.02);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.025);
    } catch (e) {}
  }

  // Wi-Fi Geiger Counter Pulse
  function playGeigerPulse() {
    if (isMuted || !isGeigerActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;

      // Realistic GM tube click: tiny high-pass noise burst
      const bufferSize = ctx.sampleRate * 0.003; // 3ms burst
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(2200, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.003);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(t);

      // Flash the Geiger indicator LED in the UI
      const geigerLed = document.getElementById('geigerLed');
      if (geigerLed) {
        geigerLed.classList.add('flash');
        setTimeout(() => geigerLed.classList.remove('flash'), 50);
      }
    } catch (e) {}
  }

  // Radar Ping Soundscape Engine (4 Modes)
  function playRadarPing(distKm = 0.5, isTarget = false) {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;
      const baseFreq = isTarget ? 880 : 660;

      if (currentSoundscape === 'analog') {
        // Moog Sub-Osc Sonar Ping
        const osc = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = 'sine';
        sub.type = 'triangle';
        osc.frequency.setValueAtTime(baseFreq, t);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, t + 0.35);
        sub.frequency.setValueAtTime(baseFreq * 0.5, t);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2400, t);
        filter.frequency.exponentialRampToValueAtTime(400, t + 0.35);
        filter.Q.setValueAtTime(7.0, t);

        const vol = isTarget ? 0.22 : 0.12;
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);

        osc.connect(filter);
        sub.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        sub.start(t);
        osc.stop(t + 0.45);
        sub.stop(t + 0.45);

      } else if (currentSoundscape === 'sid') {
        // 8-Bit C64 Arpeggio
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';

        const arpSpeed = 0.028;
        const notes = isTarget ? [880, 1108.73, 1318.51, 1760] : [659.25, 830.61, 987.77, 1318.51];
        notes.forEach((freq, idx) => {
          osc.frequency.setValueAtTime(freq, t + (idx * arpSpeed));
        });

        const vol = isTarget ? 0.14 : 0.08;
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);

      } else if (currentSoundscape === 'fm') {
        // Cyber Yamaha DX7 Metallic Chime
        const carrier = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        const masterGain = ctx.createGain();

        carrier.type = 'sine';
        mod.type = 'sine';
        carrier.frequency.setValueAtTime(baseFreq * 1.5, t);
        mod.frequency.setValueAtTime(baseFreq * 3.5, t);

        modGain.gain.setValueAtTime(baseFreq * 2.2, t);
        modGain.gain.exponentialRampToValueAtTime(1.0, t + 0.3);

        const vol = isTarget ? 0.18 : 0.10;
        masterGain.gain.setValueAtTime(vol, t);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);

        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(masterGain);
        masterGain.connect(ctx.destination);

        mod.start(t);
        carrier.start(t);
        mod.stop(t + 0.42);
        carrier.stop(t + 0.42);

      } else if (currentSoundscape === 'tube') {
        // Shortwave Heterodyne Beat (BFO)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(baseFreq, t);
        osc2.frequency.setValueAtTime(baseFreq + 14, t);

        const vol = isTarget ? 0.12 : 0.07;
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.4);
        osc2.stop(t + 0.4);
      }
    } catch (e) {}
  }

  // Update Geiger Clicking Schedule based on Target AP RSSI
  function updateGeigerRate() {
    if (geigerTimer) {
      clearTimeout(geigerTimer);
      geigerTimer = null;
    }
    if (!isGeigerActive || isMuted || !selectedNetwork) return;

    // RSSI between -30 dBm (immediate fast clicks) to -90 dBm (sparse clicks)
    const rssi = selectedNetwork.rssi || -75;
    const clampedRssi = Math.max(-95, Math.min(-30, rssi));
    // Normalization: -95dBm -> 0.0, -30dBm -> 1.0
    const norm = (clampedRssi - (-95)) / 65.0; 
    
    // Interval between 30ms (super close, buzzing) and 900ms (distant faint clicks)
    const baseInterval = 900 - Math.pow(norm, 1.6) * 860;
    // Add jitter (Poisson distribution simulation)
    const jitter = (Math.random() - 0.5) * (baseInterval * 0.4);
    const interval = Math.max(25, baseInterval + jitter);

    playGeigerPulse();

    geigerTimer = setTimeout(updateGeigerRate, interval);
  }

  // --- Channel Frequencies (2.4 GHz) ---
  function getChannelCenterFreq(ch) {
    if (ch >= 1 && ch <= 13) return 2412 + (ch - 1) * 5;
    if (ch === 14) return 2484;
    return 2412;
  }

  // --- 2.4 GHz Spectrum Analyzer Canvas Renderer ---
  function renderSpectrum() {
    const canvas = document.getElementById('spectrumCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Clean black CRT backing
    ctx.fillStyle = '#030804';
    ctx.fillRect(0, 0, w, h);

    // Spectrum Bounds: 2400 MHz to 2500 MHz
    const freqMin = 2400;
    const freqMax = 2495;
    const freqRange = freqMax - freqMin;

    function freqToX(freq) {
      return ((freq - freqMin) / freqRange) * (w - 70) + 50;
    }

    // dBm Bounds: -100 dBm (bottom) to -20 dBm (top)
    const dbmMin = -100;
    const dbmMax = -20;
    const dbmRange = dbmMax - dbmMin;

    function dbmToY(dbm) {
      const clamped = Math.max(dbmMin, Math.min(dbmMax, dbm));
      return h - 35 - ((clamped - dbmMin) / dbmRange) * (h - 60);
    }

    // Draw Grid Lines (dBm)
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.12)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(57, 255, 20, 0.5)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';

    for (let dbm = -90; dbm <= -20; dbm += 10) {
      const y = dbmToY(dbm);
      ctx.beginPath();
      ctx.moveTo(50, y);
      ctx.lineTo(w - 15, y);
      ctx.stroke();
      ctx.fillText(`${dbm} dBm`, 44, y + 3);
    }

    // Draw Channel Guidelines & Labels (1 to 14)
    ctx.textAlign = 'center';
    for (let ch = 1; ch <= 14; ch++) {
      const f = getChannelCenterFreq(ch);
      const x = freqToX(f);

      const isKeyChannel = (ch === 1 || ch === 6 || ch === 11);

      // Subtle vertical grid line
      ctx.strokeStyle = isKeyChannel ? 'rgba(57, 255, 20, 0.25)' : 'rgba(57, 255, 20, 0.06)';
      ctx.setLineDash(isKeyChannel ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x, 15);
      ctx.lineTo(x, h - 30);
      ctx.stroke();
      ctx.setLineDash([]);

      // Channel Number at bottom
      ctx.fillStyle = isKeyChannel ? '#39ff14' : 'rgba(57, 255, 20, 0.6)';
      ctx.font = isKeyChannel ? 'bold 10px "JetBrains Mono"' : '9px "JetBrains Mono"';
      ctx.fillText(`CH ${ch}`, x, h - 16);
      ctx.font = '7.5px "JetBrains Mono"';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(`${f}`, x, h - 6);
    }

    // Recommended Non-overlapping highlights at top
    ctx.fillStyle = 'rgba(57, 255, 20, 0.8)';
    ctx.font = '8px "JetBrains Mono"';
    ctx.textAlign = 'left';
    ctx.fillText('★ NON-OVERLAPPING: CH 1 (2412) • CH 6 (2437) • CH 11 (2462)', 55, 12);

    if (networks.length === 0) {
      ctx.fillStyle = 'rgba(57, 255, 20, 0.6)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('[ KEINE WI-FI NETZWERKE • WARTE AUF ECHTEN ESP32 SCAN ]', w / 2, h / 2 - 8);
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText('Klicke auf [ 📡 RESCAN ] um /api/wifi/scan am ESP32 abzufragen', w / 2, h / 2 + 10);
      return;
    }

    // Render AP Parabolic Curves
    // Sort networks so weaker ones are drawn behind stronger ones
    const sorted = [...networks].sort((a, b) => a.rssi - b.rssi);

    sorted.forEach((net) => {
      const ch = net.channel || 1;
      const fCenter = getChannelCenterFreq(ch);
      const halfWidth = 11.0; // 22 MHz channel span
      const peakDbm = net.rssi;
      const isSelected = (selectedNetwork && selectedNetwork.bssid === net.bssid);

      const steps = 30;
      ctx.beginPath();

      // Color scheme
      let strokeColor = 'rgba(57, 255, 20, 0.7)';
      let fillColor = 'rgba(57, 255, 20, 0.12)';

      if (net.auth === 'OPEN') {
        strokeColor = 'rgba(239, 68, 68, 0.8)';
        fillColor = 'rgba(239, 68, 68, 0.12)';
      } else if (net.auth === 'WPA3') {
        strokeColor = 'rgba(0, 243, 255, 0.8)';
        fillColor = 'rgba(0, 243, 255, 0.15)';
      } else if (ch === 11) {
        strokeColor = 'rgba(255, 176, 0, 0.8)';
        fillColor = 'rgba(255, 176, 0, 0.12)';
      }

      if (isSelected) {
        strokeColor = '#ffffff';
        fillColor = 'rgba(57, 255, 20, 0.35)';
      }

      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = fillColor;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      const baseY = dbmToY(dbmMin);
      ctx.moveTo(freqToX(fCenter - halfWidth), baseY);

      for (let i = 0; i <= steps; i++) {
        const delta = -halfWidth + (i / steps) * (2 * halfWidth);
        const curFreq = fCenter + delta;
        // Parabolic attenuation curve: (1 - (delta/halfWidth)^2)
        const curveFactor = Math.max(0, 1 - Math.pow(delta / halfWidth, 2));
        const curDbm = dbmMin + (peakDbm - dbmMin) * curveFactor;
        const x = freqToX(curFreq);
        const y = dbmToY(curDbm);
        ctx.lineTo(x, y);
      }

      ctx.lineTo(freqToX(fCenter + halfWidth), baseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Peak label for AP
      const peakX = freqToX(fCenter);
      const peakY = dbmToY(peakDbm);

      ctx.fillStyle = isSelected ? '#ffffff' : strokeColor;
      ctx.font = isSelected ? 'bold 10px "JetBrains Mono"' : '9px "JetBrains Mono"';
      ctx.textAlign = 'center';

      // Slight vertical offset to prevent clutter
      const labelY = Math.max(25, peakY - 8);
      ctx.fillText(`${net.ssid} (${net.rssi}dBm)`, peakX, labelY);

      // Peak dot
      ctx.beginPath();
      ctx.arc(peakX, peakY, isSelected ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#ffffff' : strokeColor;
      ctx.fill();
    });
  }

  // --- 360° Wardriving Radar Renderer ---
  function renderRadarCanvas(canvasId, isPopup = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.min(w, h) / 2 - (isPopup ? 30 : 18);

    // Dark radar screen
    ctx.fillStyle = '#020603';
    ctx.fillRect(0, 0, w, h);

    // Range rings: 10m, 25m, 50m, 100m, 150m
    const rings = [
      { r: 0.15, label: '10m' },
      { r: 0.35, label: '25m' },
      { r: 0.60, label: '50m' },
      { r: 0.85, label: '100m' },
      { r: 1.00, label: '150m' }
    ];

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.18)';
    ctx.fillStyle = 'rgba(57, 255, 20, 0.4)';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    rings.forEach((ring) => {
      const radius = maxRadius * ring.r;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(ring.label, cx + 4, cy - radius + 9);
    });

    // Crosshairs & Compass Axes
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.25)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - maxRadius);
    ctx.lineTo(cx, cy + maxRadius);
    ctx.moveTo(cx - maxRadius, cy);
    ctx.lineTo(cx + maxRadius, cy);
    ctx.stroke();

    // Cardinal Points
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(57, 255, 20, 0.85)';
    ctx.textAlign = 'center';
    ctx.fillText('N 000°', cx, cy - maxRadius - 4);
    ctx.fillText('S 180°', cx, cy + maxRadius + 12);
    ctx.textAlign = 'left';
    ctx.fillText('E 090°', cx + maxRadius + 4, cy + 3);
    ctx.textAlign = 'right';
    ctx.fillText('W 270°', cx - maxRadius - 4, cy + 3);

    // Draw Rotating Sweep Beam (Phosphor gradient trail)
    const sweepRad = (radarSweepAngle * Math.PI) / 180;
    const trailAngle = 0.35; // radians of phosphor afterglow

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
    grad.addColorStop(0, 'rgba(57, 255, 20, 0.05)');
    grad.addColorStop(1, 'rgba(57, 255, 20, 0.25)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxRadius, sweepRad - trailAngle, sweepRad, false);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Sweep leading line
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepRad) * maxRadius, cy + Math.sin(sweepRad) * maxRadius);
    ctx.stroke();
    ctx.restore();

    // Plot AP Blips
    networks.forEach((net) => {
      // Map estimated distance (1m - 150m) to radius
      const dist = net.distM || 20;
      const normDist = Math.min(1.0, Math.max(0.08, dist / 150.0));
      const r = normDist * maxRadius;

      // Bearing in degrees (0 = North, 90 = East)
      // Screen angle: 0 = East, -90 = North
      const bearing = net.bearingDeg || 0;
      const rad = ((bearing - 90) * Math.PI) / 180;

      const bx = cx + Math.cos(rad) * r;
      const by = cy + Math.sin(rad) * r;

      // Check if sweep line passed over blip
      const angleDeg = (bearing + 360) % 360;
      const curSweepNorm = (radarSweepAngle + 90 + 360) % 360;
      const angleDiff = Math.abs(curSweepNorm - angleDeg);

      const isHit = (angleDiff < 4.0 || angleDiff > 356.0);
      if (isHit && !net._lastPing) {
        net._lastPing = Date.now();
        playRadarPing(net.distM / 1000.0, net === selectedNetwork);
        triggerLogFrame(`RADAR DETECT // BSSID ${net.bssid} [${net.ssid}] @ ${net.distM}m AZ ${net.bearingDeg}°`);
      } else if (!isHit && net._lastPing && Date.now() - net._lastPing > 800) {
        net._lastPing = null;
      }

      // Blip Color
      const isSelected = (selectedNetwork && selectedNetwork.bssid === net.bssid);
      let blipColor = isSelected ? '#ffffff' : (net.auth === 'OPEN' ? '#ef4444' : '#39ff14');

      // Draw Blip
      ctx.beginPath();
      ctx.arc(bx, by, isSelected ? 5.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = blipColor;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#39ff14';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Blip Label
      ctx.font = isSelected ? 'bold 9px "JetBrains Mono"' : '8px "JetBrains Mono"';
      ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(57, 255, 20, 0.85)';
      ctx.textAlign = bx > cx ? 'left' : 'right';
      const labelX = bx > cx ? bx + 7 : bx - 7;
      ctx.fillText(`${net.ssid} (${net.rssi}dBm)`, labelX, by + 3);
    });

    // Center Dot: RandeLab Station
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00f3ff';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Radar Animation Loop
  function animateRadar() {
    radarSweepAngle = (radarSweepAngle + 1.2 * radarSpeedMultiplier) % 360;
    renderRadarCanvas('radarCanvas', false);
    renderRadarCanvas('bigRadarCanvas', true);
    radarAnimId = requestAnimationFrame(animateRadar);
  }

  // --- Live AP Wardriving Table Renderer ---
  function renderTable() {
    const tbody = document.getElementById('wifiTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (networks.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding:28px 10px; color:var(--crt-dim);">
            <div style="font-size:0.85rem; margin-bottom:6px; color:var(--crt-main);">⚠️ KEINE WI-FI NETZWERKE IM SPEICHER</div>
            <div style="font-size:0.72rem; color:var(--crt-dim);">Keine erfundenen Signale. Warte auf echten Hardware-Scan vom ESP32-S3 im RandeLab...</div>
            <div style="margin-top:10px;">
              <button class="crt-btn" onclick="triggerWifiScan()" style="padding:4px 12px; font-weight:700;">📡 JETZT SCANNEN</button>
            </div>
          </td>
        </tr>
      `;
      const totalCountEl = document.getElementById('totalApsCount');
      if (totalCountEl) totalCountEl.innerText = '0';
      const peakSignalEl = document.getElementById('peakSignalDisplay');
      if (peakSignalEl) peakSignalEl.innerText = '--';
      const openApsEl = document.getElementById('openApsCount');
      if (openApsEl) {
        openApsEl.innerText = '0';
        openApsEl.style.color = 'var(--crt-main)';
      }
      return;
    }

    networks.forEach((net, idx) => {
      const tr = document.createElement('tr');
      if (selectedNetwork && selectedNetwork.bssid === net.bssid) {
        tr.classList.add('selected');
      }

      // Quality bar % (converts -95 to -30 dBm to 0-100%)
      const qual = Math.max(0, Math.min(100, Math.round(((net.rssi + 95) / 65) * 100)));

      // Auth badge class
      let authBadge = '<span class="wifi-badge wifi-badge-wpa">WPA2</span>';
      if (net.auth === 'OPEN') {
        authBadge = '<span class="wifi-badge wifi-badge-open">OPEN</span>';
      } else if (net.auth === 'WPA3') {
        authBadge = '<span class="wifi-badge wifi-badge-wpa3">WPA3</span>';
      }

      // Channel clean/crowded flag
      const isClean = (net.channel === 1 || net.channel === 6 || net.channel === 11);
      const chanClass = isClean ? 'clean' : 'crowded';

      const vendor = lookupVendor(net.bssid);

      tr.innerHTML = `
        <td style="font-weight:700; color:var(--crt-main);">
          ${net.bssid === selectedNetwork?.bssid ? '🎯 ' : ''}${net.ssid}
        </td>
        <td style="color:var(--crt-dim); font-size:0.7rem;">${net.bssid}</td>
        <td><span class="wifi-chan-pill ${chanClass}">CH ${net.channel}</span></td>
        <td>
          <b style="color:${net.rssi > -60 ? '#39ff14' : (net.rssi > -75 ? '#ffb000' : '#ef4444')};">
            ${net.rssi} dBm
          </b>
          <div class="wifi-sparkline" style="margin-left:6px;">
            <div class="wifi-sparkline-fill" style="width:${qual}%;"></div>
          </div>
        </td>
        <td>${authBadge}</td>
        <td style="color:var(--crt-dim); font-size:0.7rem;">${vendor}</td>
        <td style="font-size:0.7rem;">~${net.distM || 20}m</td>
        <td>
          <button class="crt-btn" style="padding:2px 6px; font-size:0.65rem;" onclick="window.selectWifiNetwork('${net.bssid}')">
            ${net.bssid === selectedNetwork?.bssid ? 'LOCKED' : 'TRACK'}
          </button>
        </td>
      `;

      tr.addEventListener('click', () => {
        window.selectWifiNetwork(net.bssid);
      });

      tbody.appendChild(tr);
    });

    // Update Top Summary Stats
    const totalCountEl = document.getElementById('totalApsCount');
    if (totalCountEl) totalCountEl.innerText = networks.length;

    const strongest = [...networks].sort((a, b) => b.rssi - a.rssi)[0];
    const peakSignalEl = document.getElementById('peakSignalDisplay');
    if (peakSignalEl && strongest) {
      peakSignalEl.innerHTML = `${strongest.ssid} (<b class="crt-glow-text">${strongest.rssi} dBm</b>)`;
    }

    const openCount = networks.filter(n => n.auth === 'OPEN').length;
    const openApsEl = document.getElementById('openApsCount');
    if (openApsEl) {
      openApsEl.innerText = openCount > 0 ? `${openCount} (UNPROTECTED)` : '0 (SECURE)';
      openApsEl.style.color = openCount > 0 ? '#ef4444' : 'var(--crt-main)';
    }
  }

  // Select Network & Update HUD
  window.selectWifiNetwork = function (bssid) {
    const net = networks.find(n => n.bssid === bssid);
    if (!net) return;
    selectedNetwork = net;
    playClickSound();

    // Update HUD display
    const hudSsid = document.getElementById('hudSsid');
    const hudBssid = document.getElementById('hudBssid');
    const hudRssi = document.getElementById('hudRssi');
    const hudDist = document.getElementById('hudDist');
    const hudVendor = document.getElementById('hudVendor');
    const hudDesc = document.getElementById('hudDesc');

    if (hudSsid) hudSsid.innerText = net.ssid;
    if (hudBssid) hudBssid.innerText = net.bssid;
    if (hudRssi) hudRssi.innerText = `${net.rssi} dBm`;
    if (hudDist) hudDist.innerText = `~${net.distM}m (AZ ${net.bearingDeg}°)`;
    if (hudVendor) hudVendor.innerText = lookupVendor(net.bssid);
    if (hudDesc) hudDesc.innerText = net.desc || `802.11 b/g/n Frame Beacon. Freq: ${getChannelCenterFreq(net.channel)} MHz.`;

    renderTable();
    renderSpectrum();
    updateGeigerRate();
    triggerLogFrame(`TARGET LOCKED // ${net.ssid} [${net.bssid}] RSSI: ${net.rssi}dBm CH: ${net.channel}`);
  };

  // --- 802.11 TTY Packet Frame Streaming ---
  function triggerLogFrame(msg) {
    const tty = document.getElementById('wifiTtyLog');
    if (!tty) return;

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const line = document.createElement('div');
    line.className = 'crt-tty-line';
    line.innerHTML = `<span style="color:var(--crt-dim);">[${timeStr}]</span> <span style="color:var(--crt-main);">${msg}</span>`;

    tty.appendChild(line);

    // Keep log limited to 60 lines
    while (tty.children.length > 60) {
      tty.removeChild(tty.firstChild);
    }

    tty.scrollTop = tty.scrollHeight;
  }

  // --- Shared Scanned Networks Processor ---
  function applyScannedNetworks(foundData) {
    if (!foundData || !Array.isArray(foundData)) return;

    networks = foundData.map((ap, i) => {
      const f = getChannelCenterFreq(ap.channel || 1);
      const fspl = 27.55;
      const d = Math.pow(10, (Math.abs(ap.rssi) - fspl - 20 * Math.log10(f)) / 20.0);
      const estDist = Math.max(1.0, Math.round(d * 10) / 10);

      return {
        ssid: (ap.ssid && ap.ssid.trim()) ? ap.ssid : '<Verstecktes Netz>',
        bssid: ap.bssid || `02:00:00:00:00:${i.toString(16).padStart(2, '0')}`,
        rssi: ap.rssi || -70,
        channel: ap.channel || 1,
        auth: ap.auth || 'WPA2',
        distM: estDist,
        bearingDeg: (i * 53) % 360,
        desc: `Echter Hardware-Scan via ESP32-S3 Antenne. Pegel: ${ap.rssi} dBm auf Kanal ${ap.channel}.`
      };
    });

    if (!selectedNetwork || !networks.some(n => n.bssid === selectedNetwork.bssid)) {
      selectedNetwork = networks[0] || null;
    }

    renderTable();
    renderSpectrum();
    updateGeigerRate();
  }

  // --- MQTT WebSockets Link (For GitHub Pages & Remote Clients) ---
  function setupMQTT() {
    if (typeof mqtt === 'undefined') return;

    const clientId = 'RandeWifi_' + Math.random().toString(16).substr(2, 8);
    const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

    try {
      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 8000
      });

      mqttClient.on('connect', function() {
        triggerLogFrame('[MQTT] Link aufgebaut: wss://broker.hivemq.com:8884');
        triggerLogFrame('[MQTT] Subscribed zu Topic: randelab/solar/wifi');
        mqttClient.subscribe('randelab/solar/wifi', { qos: 0 });

        const statusEl = document.getElementById('scanStatus');
        if (statusEl && networks.length === 0) statusEl.innerText = 'MQTT LINK';
      });

      mqttClient.on('message', function(topic, message) {
        if (topic === 'randelab/solar/wifi') {
          try {
            const json = JSON.parse(message.toString());
            if (json.networks && Array.isArray(json.networks)) {
              triggerLogFrame(`[MQTT RX 📶] ${json.networks.length} reale Funknetze vom ESP32 empfangen!`);
              applyScannedNetworks(json.networks);
              const statusEl = document.getElementById('scanStatus');
              if (statusEl) statusEl.innerText = `MQTT LIVE (${json.networks.length} APs)`;
            }
          } catch (e) {
            console.error('MQTT JSON parse error:', e);
          }
        }
      });

      mqttClient.on('error', function(err) {
        console.warn('MQTT error:', err);
      });
    } catch (e) {
      console.warn('MQTT connect error:', e);
    }
  }

  // --- Hardware Wi-Fi Scan API Fetcher (REST + MQTT) ---
  window.triggerWifiScan = async function () {
    if (isScanning) return;
    isScanning = true;
    playClickSound();

    const scanBtn = document.getElementById('btnTriggerScan');
    const scanStatus = document.getElementById('scanStatus');
    if (scanBtn) scanBtn.classList.add('active');
    if (scanStatus) scanStatus.innerText = 'SCANNING...';

    // 1. If MQTT is connected, publish scan command to ESP32 (works anywhere on GitHub Pages)
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish('randelab/solar/wifi/cmd', JSON.stringify({ action: 'scan', t: Date.now() }));
      triggerLogFrame('WIFI_SCAN_CMD // Scan-Befehl via MQTT an ESP32 gesendet...');
    }

    triggerLogFrame('WIFI_SCAN_REQ // Sende Scan-Befehl an ESP32 /api/wifi/scan...');

    const storedEp = localStorage.getItem('randesolar-lab-endpoint') || 'http://192.168.1.100';
    const cleanStored = storedEp.replace(/\/+$/, '');
    const endpoints = [
      '/api/wifi/scan',
      `${cleanStored}/api/wifi/scan`,
      'http://192.168.1.100/api/wifi/scan',
      'http://randesolar.local/api/wifi/scan'
    ];

    // Remove duplicates
    const uniqueEndpoints = [...new Set(endpoints)];

    let foundData = null;
    for (const ep of uniqueEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // Allow full 13-channel scan time
        const res = await fetch(ep, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const json = await res.json();
          if (json.networks && Array.isArray(json.networks)) {
            foundData = json.networks;
            triggerLogFrame(`WIFI_SCAN_OK // ${foundData.length} reale Funknetze von ${ep} empfangen.`);
            break;
          }
        }
      } catch (err) {
        // Fall through to next endpoint
      }
    }

    if (foundData && foundData.length > 0) {
      applyScannedNetworks(foundData);
    } else if (!mqttClient || !mqttClient.connected) {
      triggerLogFrame('WIFI_SCAN_OFFLINE // ESP32 offline (192.168.1.100 nicht erreichbar).');
    }

    if (scanBtn) scanBtn.classList.remove('active');
    if (scanStatus) scanStatus.innerText = networks.length > 0 ? `LIVE (${networks.length} APs)` : 'READY';
    isScanning = false;
  };

  // --- Auto-Scan Timer Setup ---
  window.setAutoScanInterval = function (sec) {
    autoScanIntervalSec = parseInt(sec, 10);
    playClickSound();
    if (autoScanTimer) {
      clearInterval(autoScanTimer);
      autoScanTimer = null;
    }
    if (autoScanIntervalSec > 0) {
      autoScanTimer = setInterval(window.triggerWifiScan, autoScanIntervalSec * 1000);
      triggerLogFrame(`AUTO_SCAN // Configured interval: ${autoScanIntervalSec}s`);
    } else {
      triggerLogFrame('AUTO_SCAN // Disabled (Manual Mode)');
    }
  };

  // --- Radar Speed Control ---
  window.setRadarSpeed = function (speed) {
    radarSpeedMultiplier = parseFloat(speed);
    const label = document.getElementById('radarSpeedDisplay');
    if (label) label.innerText = `${radarSpeedMultiplier.toFixed(1)}x`;
  };

  // --- Soundscape Engine Selector ---
  window.setSoundscape = function (mode) {
    currentSoundscape = mode;
    playClickSound();
    document.querySelectorAll('.btn-soundscape').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-sound') === mode);
    });
    playRadarPing(0.5, true);
    triggerLogFrame(`AUDIO_ENGINE // Switched soundscape to: ${mode.toUpperCase()}`);
  };

  // --- Wi-Fi Geiger Counter Toggle ---
  window.toggleGeiger = function () {
    isGeigerActive = !isGeigerActive;
    playClickSound();
    const btn = document.getElementById('btnToggleGeiger');
    if (btn) {
      btn.classList.toggle('active', isGeigerActive);
      btn.innerHTML = isGeigerActive ? '☢️ GEIGER: ON' : '☢️ GEIGER: OFF';
    }
    updateGeigerRate();
    triggerLogFrame(`GEIGER_COUNTER // ${isGeigerActive ? 'ENABLED' : 'MUTED'}`);
  };

  // --- Master Audio Toggle ---
  window.toggleAudio = function () {
    isMuted = !isMuted;
    const btn = document.getElementById('btnAudioToggle');
    if (btn) {
      btn.innerHTML = isMuted ? '🔇 MUTE: ON' : '🔊 AUDIO: ON';
      btn.classList.toggle('active', !isMuted);
    }
    if (!isMuted) {
      getAudioContext();
      playClickSound();
      updateGeigerRate();
    }
  };

  // --- Scanlines Toggle ---
  let scanlinesActive = localStorage.getItem('randelab-crt-scanlines') !== 'false';

  window.toggleScanlines = function () {
    scanlinesActive = !scanlinesActive;
    document.body.classList.toggle('no-scanlines', !scanlinesActive);
    localStorage.setItem('randelab-crt-scanlines', scanlinesActive);
    const btn = document.getElementById('btnToggleScanlines');
    if (btn) {
      btn.innerHTML = scanlinesActive ? '📺 LINES: ON' : '📺 LINES: OFF';
      btn.classList.toggle('active', scanlinesActive);
    }
    playClickSound();
  };

  // --- Phosphor Theme Switcher ---
  window.setPhosphorMode = function (palette) {
    playClickSound();
    document.body.classList.remove('crt-green', 'crt-amber', 'crt-cyan', 'crt-pink');
    document.body.classList.add(`crt-${palette}`);
    document.querySelectorAll('.btn-phosphor').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-color') === palette);
    });
    renderSpectrum();
  };

  // --- Big Tactical Radar Modal Controls ---
  window.openBigRadar = function () {
    playClickSound();
    const modal = document.getElementById('bigRadarModal');
    if (modal) {
      modal.style.display = 'flex';
      const canvas = document.getElementById('bigRadarCanvas');
      if (canvas) {
        canvas.width = 440;
        canvas.height = 440;
      }
    }
  };

  window.closeBigRadar = function () {
    playClickSound();
    const modal = document.getElementById('bigRadarModal');
    if (modal) modal.style.display = 'none';
  };

  // --- Glitch Effect Toggle ---
  window.toggleGlitch = function () {
    playClickSound();
    const screen = document.querySelector('.crt-screen');
    if (screen) {
      screen.classList.toggle('crt-glitch-burst');
      setTimeout(() => screen.classList.remove('crt-glitch-burst'), 450);
    }
  };

  // --- Clear TTY Log ---
  window.clearTtyLog = function () {
    playClickSound();
    const tty = document.getElementById('wifiTtyLog');
    if (tty) tty.innerHTML = '';
  };

  // --- Initialization on DOM Ready ---
  document.addEventListener('DOMContentLoaded', () => {
    // Canvas sizing
    const specCanvas = document.getElementById('spectrumCanvas');
    if (specCanvas) {
      specCanvas.width = specCanvas.parentElement.clientWidth || 580;
      specCanvas.height = 240;
    }

    const radCanvas = document.getElementById('radarCanvas');
    if (radCanvas) {
      radCanvas.width = 280;
      radCanvas.height = 280;
    }

    window.addEventListener('resize', () => {
      if (specCanvas) {
        specCanvas.width = specCanvas.parentElement.clientWidth || 580;
        renderSpectrum();
      }
    });

    // Scanlines State
    document.body.classList.toggle('no-scanlines', !scanlinesActive);
    const btnScan = document.getElementById('btnToggleScanlines');
    if (btnScan) {
      btnScan.innerHTML = scanlinesActive ? '📺 LINES: ON' : '📺 LINES: OFF';
      btnScan.classList.toggle('active', scanlinesActive);
    }

    // Start Loops
    renderSpectrum();
    renderTable();
    animateRadar();

    // Connect to HiveMQ MQTT Broker (for remote / GitHub Pages access)
    setupMQTT();

    // Trigger Initial Live Hardware Scan
    window.triggerWifiScan();

    // Auto scan timer (default 5s)
    window.setAutoScanInterval(5);

    triggerLogFrame('SYSTEM_BOOT // RandeLab 802.11 Analyzer ready (Live-Only Mode).');
    triggerLogFrame('SPECTRUM // Initialized 2.4 GHz channel bounds (2400 - 2495 MHz).');
  });

})();
