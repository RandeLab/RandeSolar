/**
 * RandeLab COCO-DISCO // Tropical Tiki Hardware Controller (web/disco.js)
 * High-voltage mountain-top coconut disco, dual HiveMQ MQTT (randelab/solar/cmd) + REST (/api/led),
 * Procedural Web Audio tropical marimba synth & funky disco beat,
 * Coconut Disco Ball simulation & live hardware ACK latency tracking.
 */

(function () {
  'use strict';

  // --- State Variables ---
  let mqttClient = null;
  let audioCtx = null;
  let isSoundActive = false;
  let cocoBeatTimer = null;
  let strobeTimer = null;
  let currentDurationSec = 10;
  let lastCommandSentMs = 0;
  let currentTargetColor = 'strobe';
  let isConnectedMqtt = false;

  // --- Procedural Web Audio Engine (Tropical Synth & Cowbell/Marimba) ---
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

  // Tropical Coconut Marimba & Laser Zap
  function playCocoZap(freq, type, duration) {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type || 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + duration);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  // Tropical Woodblock / Coconut Click
  function playCoconutClick(freq) {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(freq || 850, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch (e) {}
  }

  // Funky Tropical Disco Beat (~114 BPM)
  let beatStep = 0;
  // Tropical Island Pentatonic Scale (Marimba tones)
  const TROPICAL_SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];

  function triggerCocoBeat() {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // 1. Kick Drum every 2 steps (4-on-the-floor)
      if (beatStep % 2 === 0) {
        const kickOsc = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kickOsc.frequency.setValueAtTime(150, now);
        kickOsc.frequency.exponentialRampToValueAtTime(35, now + 0.12);
        kickGain.gain.setValueAtTime(0.35, now);
        kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        kickOsc.connect(kickGain);
        kickGain.connect(ctx.destination);
        kickOsc.start(now);
        kickOsc.stop(now + 0.12);
      }

      // 2. Tropical Coconut Woodblock / Cowbell on offbeats
      if (beatStep % 2 === 1) {
        playCoconutClick(beatStep % 4 === 1 ? 920 : 740);
      }

      // 3. Funky Marimba / Steel Drum Melody Arpeggio
      const marimbaOsc = ctx.createOscillator();
      const marimbaGain = ctx.createGain();
      marimbaOsc.type = 'sine';
      const noteFreq = TROPICAL_SCALE[(beatStep * 2 + 1) % TROPICAL_SCALE.length];
      marimbaOsc.frequency.setValueAtTime(noteFreq, now);

      marimbaGain.gain.setValueAtTime(0.12, now);
      marimbaGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      marimbaOsc.connect(marimbaGain);
      marimbaGain.connect(ctx.destination);
      marimbaOsc.start(now);
      marimbaOsc.stop(now + 0.09);

      // Bounce Bruce Lee and Coconut Drink
      const bruce = document.getElementById('tikiBruce');
      if (bruce) {
        bruce.style.transform = (beatStep % 2 === 0) ? 'translateY(-8px) scale(1.08)' : 'translateY(0) scale(1)';
      }

      beatStep = (beatStep + 1) % 16;
    } catch (e) {}
  }

  window.toggleSound = function () {
    isSoundActive = !isSoundActive;
    const btn = document.getElementById('btnToggleSound');
    if (isSoundActive) {
      getAudioContext();
      if (!cocoBeatTimer) cocoBeatTimer = setInterval(triggerCocoBeat, 131); // ~114 BPM Tropical Disco
      if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '🥥 SOUND: ON';
      }
      playCocoZap(880, 'triangle', 0.2);
      logTerminal('[COCO-BEAT 🥥] Tropischer Disco-Synthesizer & Woodblock gestartet (~114 BPM)');
    } else {
      if (cocoBeatTimer) {
        clearInterval(cocoBeatTimer);
        cocoBeatTimer = null;
      }
      if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '🥥 SOUND: OFF';
      }
      logTerminal('[COCO-BEAT 🔇] Sound stummgeschaltet.');
    }
  };

  // --- Terminal Logger ---
  function logTerminal(msg, type) {
    const term = document.getElementById('cocoTerminal');
    if (!term) return;
    const line = document.createElement('div');
    line.className = 'disco-log-line ' + (type ? 'coco-log-' + type : '');
    const ts = new Date().toTimeString().split(' ')[0];
    line.textContent = `[${ts}] ${msg}`;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;

    while (term.children.length > 80) {
      term.removeChild(term.firstChild);
    }
  }

  // --- Coconut Disco Ball Simulator Renderer ---
  function renderCoconutBall(r, g, b, isStrobe) {
    const ballEl = document.getElementById('coconutBall');
    const lensEl = document.getElementById('coconutLens');
    const auraEl = document.getElementById('coconutAura');
    const emitterEl = document.getElementById('cocoEmitter');
    const labelEl = document.getElementById('currentCocktailLabel');

    if (strobeTimer) {
      clearInterval(strobeTimer);
      strobeTimer = null;
    }

    if (isStrobe) {
      if (ballEl) ballEl.style.transform = 'scale(1.08) rotate(3deg)';
      const rainbowColors = [
        [255, 0, 127],   // Coco-Pink
        [0, 255, 102],   // Jungle-Green
        [0, 240, 255],   // Bikini-Cyan
        [255, 183, 0],   // Solar-Mango
        [255, 16, 48],   // Spicy-Tiki
        [255, 255, 255]  // Coconut-Milk
      ];
      let step = 0;
      strobeTimer = setInterval(() => {
        const c = rainbowColors[step % rainbowColors.length];
        const colStr = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        if (lensEl) {
          lensEl.style.borderColor = colStr;
          lensEl.style.boxShadow = `0 0 25px ${colStr}`;
        }
        if (emitterEl) {
          emitterEl.style.background = colStr;
          emitterEl.style.boxShadow = `0 0 20px ${colStr}`;
        }
        if (auraEl) {
          auraEl.style.background = `radial-gradient(circle, ${colStr} 0%, rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.35) 50%, transparent 80%)`;
        }
        if (labelEl) labelEl.textContent = `⚡ COCO PARTY STROBE // ${colStr}`;
        step++;
      }, 70); // Match firmware 70ms cycle!
      return;
    }

    const colStr = `rgb(${r}, ${g}, ${b})`;

    if (r === 0 && g === 0 && b === 0) {
      if (ballEl) ballEl.style.transform = 'scale(1) rotate(0deg)';
      if (lensEl) {
        lensEl.style.borderColor = '#333';
        lensEl.style.boxShadow = 'none';
      }
      if (emitterEl) {
        emitterEl.style.background = '#222';
        emitterEl.style.boxShadow = 'none';
      }
      if (auraEl) auraEl.style.opacity = '0';
      if (labelEl) labelEl.textContent = '🌙 COCO BLACKOUT // OFF';
      return;
    }

    if (ballEl) ballEl.style.transform = 'scale(1.04)';
    if (lensEl) {
      lensEl.style.borderColor = colStr;
      lensEl.style.boxShadow = `0 0 25px ${colStr}`;
    }
    if (emitterEl) {
      emitterEl.style.background = colStr;
      emitterEl.style.boxShadow = `0 0 20px ${colStr}`;
    }
    if (auraEl) {
      auraEl.style.opacity = '0.95';
      auraEl.style.background = `radial-gradient(circle, ${colStr} 0%, rgba(${r}, ${g}, ${b}, 0.35) 50%, transparent 75%)`;
    }
    if (labelEl) {
      const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
      labelEl.textContent = `🥥 ${hex} // RGB(${r}, ${g}, ${b})`;
    }
  }

  // --- HiveMQ WebSockets Setup ---
  function setupMQTT() {
    if (typeof mqtt === 'undefined') {
      logTerminal('MQTT.js Library nicht geladen.', 'err');
      return;
    }

    const clientId = 'RandeCoco_' + Math.random().toString(16).substr(2, 8);
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
        logTerminal('[TIKI UPLINK 🌴] Verbunden mit HiveMQ (wss://broker.hivemq.com:8884)', 'ack');
        logTerminal('[MQTT] Subscribed zu Topic: randelab/solar/ack & randelab/solar/cmd');
        mqttClient.subscribe('randelab/solar/ack', { qos: 0 });
        mqttClient.subscribe('randelab/solar/cmd', { qos: 0 });

        const statusEl = document.getElementById('mqttLinkStatus');
        if (statusEl) {
          statusEl.innerHTML = '<span class="crt-blink-dot" style="background:#00ff66;"></span> COCO-LINK ACTIVE';
          statusEl.style.color = '#00ff66';
        }
      });

      mqttClient.on('message', function (topic, message) {
        const payloadStr = message.toString();

        if (topic === 'randelab/solar/ack') {
          try {
            const ack = JSON.parse(payloadStr);
            const rtt = lastCommandSentMs > 0 ? (Date.now() - lastCommandSentMs) : 0;
            const rttStr = rtt > 0 ? ` (Ping: ${rtt} ms)` : '';
            logTerminal(`[ESP32 ACK 🌴] NeoPixel bestätigt: ${ack.action || 'ok'} // R=${ack.r || 0} G=${ack.g || 0} B=${ack.b || 0} für ${ack.duration_sec || 10}s${rttStr}`, 'ack');

            const pingEl = document.getElementById('ackLatencyBadge');
            if (pingEl && rtt > 0) {
              pingEl.textContent = `⚡ PING: ${rtt} ms`;
              pingEl.style.display = 'inline-block';
            }

            if (ack.action === 'disco_strobe') {
              renderCoconutBall(0, 0, 0, true);
            } else if (ack.r !== undefined && ack.g !== undefined && ack.b !== undefined) {
              renderCoconutBall(ack.r, ack.g, ack.b, false);
            }
          } catch (e) {
            logTerminal(`[ESP32 ACK 🌴] ${payloadStr}`, 'ack');
          }
        } else if (topic === 'randelab/solar/cmd') {
          try {
            const cmd = JSON.parse(payloadStr);
            if (cmd.action === 'led' && cmd.color) {
              logTerminal(`[REMOTE TIKI 📡] Befehl empfangen: ${cmd.color}`, 'tx');
              if (cmd.color === 'disco' || cmd.color === 'strobe' || cmd.color === 'party') {
                renderCoconutBall(0, 0, 0, true);
              }
            }
          } catch (e) {}
        }
      });

      mqttClient.on('offline', function () {
        isConnectedMqtt = false;
        const statusEl = document.getElementById('mqttLinkStatus');
        if (statusEl) {
          statusEl.innerHTML = '<span class="crt-blink-dot" style="background:#ff3860;"></span> OFFLINE';
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
  window.triggerCocoColor = async function (colorName, rgbPreset) {
    currentTargetColor = colorName;
    lastCommandSentMs = Date.now();

    playCocoZap(580, 'sine', 0.12);

    // 1. Immediate visual feedback
    if (colorName === 'disco' || colorName === 'strobe' || colorName === 'party') {
      renderCoconutBall(0, 0, 0, true);
    } else if (rgbPreset && rgbPreset.length === 3) {
      renderCoconutBall(rgbPreset[0], rgbPreset[1], rgbPreset[2], false);
    }

    logTerminal(`[TIKI TX 🚀] Sende Cocktail: "${colorName.toUpperCase()}" (${currentDurationSec}s)...`, 'tx');

    // 2. Publish to MQTT (Works worldwide via HiveMQ)
    if (mqttClient && mqttClient.connected) {
      const payload = {
        action: 'led',
        color: colorName,
        duration_sec: currentDurationSec,
        t: Date.now()
      };
      mqttClient.publish('randelab/solar/cmd', JSON.stringify(payload));
      logTerminal(`[MQTT 🥥] randelab/solar/cmd -> ${colorName}`);
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

  // Duration Selector (Sips)
  window.setDuration = function (sec, btnEl) {
    currentDurationSec = sec;
    document.querySelectorAll('.btn-sip').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    playCoconutClick(800);
    logTerminal(`[SIP TIMER 🍹] Leuchtdauer auf ${sec} Sekunden eingestellt.`);
  };

  // Phosphor Mode
  window.setPhosphorMode = function (palette) {
    document.body.className = 'coco-theme';
    document.body.classList.add('crt-' + palette);
    document.querySelectorAll('.btn-phosphor').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-color') === palette);
    });
    localStorage.setItem('randesolar-phosphor', palette);
  };

  // Scanlines Toggle
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

  // Init on DOM Load
  document.addEventListener('DOMContentLoaded', () => {
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

    logTerminal('🌴 Willkommen in der RandeLab COCO-DISCO! 🥥');
    logTerminal('Verbinde mit HiveMQ MQTT & ESP32 Onboard-NeoPixel (GPIO 48)...');
    setupMQTT();

    // Default Coco-Pink state
    renderCoconutBall(255, 0, 127, false);
  });

})();
