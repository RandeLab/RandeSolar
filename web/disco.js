/**
 * RandeLab DISCO MODE // Virtual 5050 NeoPixel & Remote Controller (web/disco.js)
 * Dual MQTT HiveMQ WebSockets (randelab/solar/cmd) + Local REST API (/api/led),
 * Web Audio procedural 80s disco synthesizer & beat machine,
 * Live ACK roundtrip latency measurement, CRT scanline & phosphor toggles.
 */

(function () {
  'use strict';

  // --- State Variables ---
  let mqttClient = null;
  let audioCtx = null;
  let isSoundActive = false;
  let discoBeatTimer = null;
  let strobeTimer = null;
  let currentDurationSec = 10;
  let lastCommandSentMs = 0;
  let currentTargetColor = 'strobe';
  let isConnectedMqtt = false;

  // --- Web Audio Synthesizer Engine ---
  function getAudioContext() {
    if (!audioCtx) {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (AudioClass) audioCtx = new AudioClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Laser Zap / Synth Chime for button clicks
  function playSynthZap(freqStart, freqEnd, type, duration) {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type || 'sawtooth';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(freqStart, now);
      osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  // 4-on-the-floor Disco Bass Drum & Synth Arpeggio
  let beatStep = 0;
  const DISCO_SCALE = [130.81, 164.81, 196.00, 246.94, 261.63, 329.63, 392.00, 493.88]; // C Major / Pentatonic Synth

  function triggerBeatStep() {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Kick drum every 4 beats (step % 2 === 0)
      if (beatStep % 2 === 0) {
        const kickOsc = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kickOsc.frequency.setValueAtTime(140, now);
        kickOsc.frequency.exponentialRampToValueAtTime(32, now + 0.12);
        kickGain.gain.setValueAtTime(0.35, now);
        kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        kickOsc.connect(kickGain);
        kickGain.connect(ctx.destination);
        kickOsc.start(now);
        kickOsc.stop(now + 0.12);
      }

      // Funky Arpeggiator Synth note
      const arpOsc = ctx.createOscillator();
      const arpGain = ctx.createGain();
      arpOsc.type = 'sawtooth';
      const noteFreq = DISCO_SCALE[(beatStep * 3) % DISCO_SCALE.length];
      arpOsc.frequency.setValueAtTime(noteFreq, now);

      arpGain.gain.setValueAtTime(0.08, now);
      arpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      arpOsc.connect(arpGain);
      arpGain.connect(ctx.destination);
      arpOsc.start(now);
      arpOsc.stop(now + 0.1);

      // Bounce on-screen dancer
      const dancer = document.getElementById('discoDancer');
      if (dancer) {
        dancer.style.transform = (beatStep % 2 === 0) ? 'translateY(-6px) scale(1.05)' : 'translateY(0) scale(1)';
      }

      // Random Equalizer Bar Bounce
      const eqBars = document.querySelectorAll('.disco-eq-bar');
      eqBars.forEach((bar) => {
        const h = Math.floor(Math.random() * 85) + 10;
        bar.style.height = h + '%';
      });

      beatStep = (beatStep + 1) % 16;
    } catch (e) {}
  }

  window.toggleSound = function () {
    isSoundActive = !isSoundActive;
    const btn = document.getElementById('btnToggleSound');
    if (isSoundActive) {
      getAudioContext();
      if (!discoBeatTimer) discoBeatTimer = setInterval(triggerBeatStep, 135); // ~111 BPM funky disco beat
      if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '🔊 SOUND: ON';
      }
      playSynthZap(800, 200, 'sawtooth', 0.2);
      logTerminal('[AUDIO 🎵] Procedural Web Audio Synth & Beatbox gestartet (~111 BPM)');
    } else {
      if (discoBeatTimer) {
        clearInterval(discoBeatTimer);
        discoBeatTimer = null;
      }
      if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '🔈 SOUND: OFF';
      }
      logTerminal('[AUDIO 🔇] Sound stummgeschaltet.');
    }
  };

  // --- Terminal Logger ---
  function logTerminal(msg, type) {
    const term = document.getElementById('discoTerminal');
    if (!term) return;
    const line = document.createElement('div');
    line.className = 'disco-log-line ' + (type ? 'disco-log-' + type : '');
    const ts = new Date().toTimeString().split(' ')[0];
    line.textContent = `[${ts}] ${msg}`;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;

    // Limit log lines to 100
    while (term.children.length > 100) {
      term.removeChild(term.firstChild);
    }
  }

  // --- Virtual 5050 NeoPixel Renderer ---
  function renderVirtualPixel(r, g, b, isStrobe) {
    const pixelEl = document.getElementById('virtualNeoPixel');
    const auraEl = document.getElementById('virtualAura');
    const emitters = document.querySelectorAll('.die-emitter');
    const colorHexLabel = document.getElementById('currentColorHex');

    if (strobeTimer) {
      clearInterval(strobeTimer);
      strobeTimer = null;
    }

    if (isStrobe) {
      if (pixelEl) pixelEl.classList.add('neopixel-active');
      const rainbowColors = [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 220, 0],
        [255, 0, 220],
        [0, 245, 255]
      ];
      let step = 0;
      strobeTimer = setInterval(() => {
        const c = rainbowColors[step % rainbowColors.length];
        const colStr = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        if (auraEl) {
          auraEl.style.background = `radial-gradient(circle, ${colStr} 20%, rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.4) 60%, transparent 85%)`;
        }
        emitters.forEach(e => {
          e.style.background = colStr;
          e.style.boxShadow = `0 0 10px ${colStr}`;
        });
        if (colorHexLabel) colorHexLabel.textContent = `DISCO STROBE // ⚡ ${colStr}`;
        step++;
      }, 70); // Match firmware 70ms cycle!
      return;
    }

    const colStr = `rgb(${r}, ${g}, ${b})`;
    if (r === 0 && g === 0 && b === 0) {
      if (pixelEl) pixelEl.classList.remove('neopixel-active');
      if (auraEl) auraEl.style.opacity = '0';
      emitters.forEach(e => {
        e.style.background = '#222';
        e.style.boxShadow = 'none';
      });
      if (colorHexLabel) colorHexLabel.textContent = 'OFF // BLACKOUT';
      return;
    }

    if (pixelEl) pixelEl.classList.add('neopixel-active');
    if (auraEl) {
      auraEl.style.opacity = '0.9';
      auraEl.style.background = `radial-gradient(circle, ${colStr} 20%, rgba(${r}, ${g}, ${b}, 0.4) 60%, transparent 85%)`;
    }
    emitters.forEach(e => {
      e.style.background = colStr;
      e.style.boxShadow = `0 0 12px ${colStr}`;
    });
    if (colorHexLabel) {
      const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
      colorHexLabel.textContent = `${hex} // RGB(${r}, ${g}, ${b})`;
    }
  }

  // --- MQTT Client Setup (HiveMQ WebSockets) ---
  function setupMQTT() {
    if (typeof mqtt === 'undefined') {
      logTerminal('MQTT.js Library nicht geladen.', 'err');
      return;
    }

    const clientId = 'RandeDisco_' + Math.random().toString(16).substr(2, 8);
    const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

    try {
      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 8000
      });

      mqttClient.on('connect', function () {
        isConnectedMqtt = true;
        logTerminal('[MQTT] Verbunden mit HiveMQ Broker (wss://broker.hivemq.com:8884)', 'ack');
        logTerminal('[MQTT] Subscribed zu Topic: randelab/solar/ack & randelab/solar/cmd');
        mqttClient.subscribe('randelab/solar/ack', { qos: 0 });
        mqttClient.subscribe('randelab/solar/cmd', { qos: 0 });

        const statusEl = document.getElementById('mqttLinkStatus');
        if (statusEl) {
          statusEl.innerHTML = '<span class="crt-blink-dot" style="background:#39ff14;"></span> MQTT LIVE LINK';
          statusEl.style.color = '#39ff14';
        }
      });

      mqttClient.on('message', function (topic, message) {
        const payloadStr = message.toString();

        if (topic === 'randelab/solar/ack') {
          try {
            const ack = JSON.parse(payloadStr);
            const rtt = lastCommandSentMs > 0 ? (Date.now() - lastCommandSentMs) : 0;
            const rttStr = rtt > 0 ? ` (Roundtrip: ${rtt} ms)` : '';
            logTerminal(`[ESP32 ACK 💡] Bestätigung erhalten: ${ack.action || 'ok'} // R=${ack.r || 0} G=${ack.g || 0} B=${ack.b || 0} für ${ack.duration_sec || 10}s${rttStr}`, 'ack');

            const pingEl = document.getElementById('ackLatencyBadge');
            if (pingEl && rtt > 0) {
              pingEl.textContent = `⚡ PING: ${rtt} ms`;
              pingEl.style.display = 'inline-block';
            }

            if (ack.action === 'disco_strobe') {
              renderVirtualPixel(0, 0, 0, true);
            } else if (ack.r !== undefined && ack.g !== undefined && ack.b !== undefined) {
              renderVirtualPixel(ack.r, ack.g, ack.b, false);
            }
          } catch (e) {
            logTerminal(`[ESP32 ACK 💡] ${payloadStr}`, 'ack');
          }
        } else if (topic === 'randelab/solar/cmd') {
          try {
            const cmd = JSON.parse(payloadStr);
            if (cmd.action === 'led' && cmd.color) {
              logTerminal(`[REMOTE CMD 📡] Externer Befehl empfangen: ${cmd.color}`, 'tx');
              if (cmd.color === 'disco' || cmd.color === 'strobe' || cmd.color === 'party') {
                renderVirtualPixel(0, 0, 0, true);
              }
            }
          } catch (e) {}
        }
      });

      mqttClient.on('offline', function () {
        isConnectedMqtt = false;
        const statusEl = document.getElementById('mqttLinkStatus');
        if (statusEl) {
          statusEl.innerHTML = '<span class="crt-blink-dot" style="background:#ff3860;"></span> MQTT OFFLINE';
          statusEl.style.color = '#ff3860';
        }
      });

      mqttClient.on('error', function (err) {
        logTerminal(`[MQTT ⚠️] Fehler: ${err}`, 'err');
      });
    } catch (e) {
      logTerminal(`[MQTT ⚠️] Verbindungsfehler: ${e}`, 'err');
    }
  }

  // --- Dispatch Command (MQTT + Local REST) ---
  window.triggerDiscoColor = async function (colorName, rgbPreset) {
    currentTargetColor = colorName;
    lastCommandSentMs = Date.now();

    playSynthZap(400, 900, 'sawtooth', 0.15);

    // 1. Update on-screen virtual pixel immediately
    if (colorName === 'disco' || colorName === 'strobe' || colorName === 'party') {
      renderVirtualPixel(0, 0, 0, true);
    } else if (rgbPreset && rgbPreset.length === 3) {
      renderVirtualPixel(rgbPreset[0], rgbPreset[1], rgbPreset[2], false);
    }

    logTerminal(`[TX 🚀] Sende LED-Befehl: "${colorName.toUpperCase()}" (${currentDurationSec}s)...`, 'tx');

    // 2. Publish via MQTT (Reaches ESP32 anywhere via 5G/HiveMQ)
    if (mqttClient && mqttClient.connected) {
      const payload = {
        action: 'led',
        color: colorName,
        duration_sec: currentDurationSec,
        t: Date.now()
      };
      mqttClient.publish('randelab/solar/cmd', JSON.stringify(payload));
      logTerminal(`[MQTT 📤] randelab/solar/cmd -> ${JSON.stringify(payload)}`);
    } else {
      logTerminal('[MQTT ⚠️] HiveMQ nicht verbunden, versuche lokalen REST-Aufruf...', 'err');
    }

    // 3. Parallel REST Fallback if on local lab network (192.168.1.100 or randesolar.local)
    try {
      const endpoints = [
        `/api/led?color=${encodeURIComponent(colorName)}&duration=${currentDurationSec}`,
        `http://192.168.1.100/api/led?color=${encodeURIComponent(colorName)}&duration=${currentDurationSec}`
      ];
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, { method: 'GET', mode: 'cors', cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            const rtt = Date.now() - lastCommandSentMs;
            logTerminal(`[REST ⚡] 192.168.1.100 antwortet OK in ${rtt} ms`, 'ack');
            break;
          }
        } catch (e) {}
      }
    } catch (e) {}
  };

  // Duration Selector
  window.setDuration = function (sec, btnEl) {
    currentDurationSec = sec;
    document.querySelectorAll('.btn-dur').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    playSynthZap(300, 500, 'sine', 0.08);
    logTerminal(`[DURATION ⏱️] Leuchtdauer auf ${sec} Sekunden eingestellt.`);
  };

  // Custom Color Picker
  window.sendCustomColor = function () {
    const input = document.getElementById('customColorPicker');
    if (!input) return;
    const hex = input.value;
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    // Choose closest simple name or pass hex/rgb
    window.triggerDiscoColor(hex, [r, g, b]);
  };

  // --- Phosphor Theme Switcher ---
  window.setPhosphorMode = function (palette) {
    document.body.className = '';
    document.body.classList.add('crt-' + palette);
    document.querySelectorAll('.btn-phosphor').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-color') === palette);
    });
    localStorage.setItem('randesolar-phosphor', palette);
  };

  // --- Scanlines Toggle ---
  window.toggleScanlines = function () {
    const scanlineEl = document.querySelector('.crt-scanlines');
    const btn = document.getElementById('btnToggleScanlines');
    if (!scanlineEl || !btn) return;

    if (scanlineEl.style.display === 'none') {
      scanlineEl.style.display = 'block';
      btn.innerHTML = '📺 LINES: ON';
      btn.classList.add('active');
      localStorage.setItem('randesolar-scanlines', 'on');
    } else {
      scanlineEl.style.display = 'none';
      btn.innerHTML = '📺 LINES: OFF';
      btn.classList.remove('active');
      localStorage.setItem('randesolar-scanlines', 'off');
    }
  };

  // --- Init on DOM Load ---
  document.addEventListener('DOMContentLoaded', () => {
    // Restore saved phosphor
    const savedPalette = localStorage.getItem('randesolar-phosphor') || 'pink';
    window.setPhosphorMode(savedPalette);

    // Restore saved scanlines
    const savedLines = localStorage.getItem('randesolar-scanlines');
    if (savedLines === 'off') {
      const scanlineEl = document.querySelector('.crt-scanlines');
      const btn = document.getElementById('btnToggleScanlines');
      if (scanlineEl) scanlineEl.style.display = 'none';
      if (btn) {
        btn.innerHTML = '📺 LINES: OFF';
        btn.classList.remove('active');
      }
    }

    logTerminal('RandeLab DISCO CONTROLLER initialisiert.');
    logTerminal('Verbinde mit HiveMQ MQTT & ESP32 Onboard-NeoPixel (GPIO 48)...');
    setupMQTT();

    // Default neon magenta visualizer state
    renderVirtualPixel(255, 0, 180, false);
  });

})();
