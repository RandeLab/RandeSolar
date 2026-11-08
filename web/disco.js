/**
 * RandeLab Coconut Research Lab Disco // Modern Hardware Controller (web/disco.js)
 * Dual HiveMQ MQTT (randelab/solar/cmd) + Local REST API (/api/led),
 * Procedural Web Audio Tropical Coconut Marimba Synth (~114 BPM),
 * Bioluminescent Coconut Resonator visualizer & live ACK roundtrip tracker.
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
  let isConnectedMqtt = false;

  // --- Web Audio Synthesizer (Tropical Coconut Marimba & Beat) ---
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

  function playSynthZap(freq, type, duration) {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type || 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.35, now + duration);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  function playCoconutClick(freq) {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(freq || 880, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.04);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch (e) {}
  }

  // 114 BPM Tropical Disco Groove
  let beatStep = 0;
  const MARIMBA_SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25]; // C Major Pentatonic

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
        kickOsc.frequency.setValueAtTime(145, now);
        kickOsc.frequency.exponentialRampToValueAtTime(32, now + 0.12);
        kickGain.gain.setValueAtTime(0.3, now);
        kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        kickOsc.connect(kickGain);
        kickGain.connect(ctx.destination);
        kickOsc.start(now);
        kickOsc.stop(now + 0.12);
      }

      // 2. Coconut Woodblock on offbeats
      if (beatStep % 2 === 1) {
        playCoconutClick(beatStep % 4 === 1 ? 920 : 740);
      }

      // 3. Marimba note
      const marimbaOsc = ctx.createOscillator();
      const marimbaGain = ctx.createGain();
      marimbaOsc.type = 'sine';
      const noteFreq = MARIMBA_SCALE[(beatStep * 3 + 1) % MARIMBA_SCALE.length];
      marimbaOsc.frequency.setValueAtTime(noteFreq, now);

      marimbaGain.gain.setValueAtTime(0.12, now);
      marimbaGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      marimbaOsc.connect(marimbaGain);
      marimbaGain.connect(ctx.destination);
      marimbaOsc.start(now);
      marimbaOsc.stop(now + 0.09);

      // Bounce Bruce Lee dancer
      const dancer = document.getElementById('bruceDancer');
      if (dancer) {
        dancer.style.transform = (beatStep % 2 === 0) ? 'translateY(-7px) scale(1.06)' : 'translateY(0) scale(1)';
      }

      beatStep = (beatStep + 1) % 16;
    } catch (e) {}
  }

  window.toggleSound = function () {
    isSoundActive = !isSoundActive;
    const btn = document.getElementById('btnToggleSound');
    if (isSoundActive) {
      getAudioContext();
      if (!cocoBeatTimer) cocoBeatTimer = setInterval(triggerCocoBeat, 131); // ~114 BPM
      if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '🥥 Sound: ON';
      }
      playSynthZap(800, 'triangle', 0.18);
      logTerminal('[AUDIO 🥥] Tropical Coconut Marimba Synth (~114 BPM) gestartet.');
    } else {
      if (cocoBeatTimer) {
        clearInterval(cocoBeatTimer);
        cocoBeatTimer = null;
      }
      if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '🥥 Sound: OFF';
      }
      logTerminal('[AUDIO 🔇] Sound stummgeschaltet.');
    }
  };

  // --- Terminal Stream Logger ---
  function logTerminal(msg, type) {
    const stream = document.getElementById('telemetryStream');
    if (!stream) return;
    const row = document.createElement('div');
    row.className = 'log-entry ' + (type ? 'log-entry-' + type : '');
    const ts = new Date().toTimeString().split(' ')[0];
    row.textContent = `[${ts}] ${msg}`;
    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;

    while (stream.children.length > 60) {
      stream.removeChild(stream.firstChild);
    }
  }

  // --- Coconut Resonator Visualizer ---
  function renderResonator(r, g, b, isStrobe, customLabel) {
    const sphereEl = document.getElementById('coconutSphere');
    const chamberEl = document.getElementById('neopixelChamber');
    const dieEl = document.getElementById('siliconDie');
    const auraEl = document.getElementById('radianceAura');
    const colorLabel = document.getElementById('activeColorLabel');
    const detailLabel = document.getElementById('activeDetailLabel');

    if (strobeTimer) {
      clearInterval(strobeTimer);
      strobeTimer = null;
    }

    if (isStrobe) {
      if (sphereEl) sphereEl.style.transform = 'scale(1.08) rotate(2deg)';
      const rainbowColors = [
        [255, 0, 127],   // Pink
        [0, 255, 136],   // Pine Green
        [0, 240, 255],   // Glacier Cyan
        [255, 183, 0],   // Solar Gold
        [255, 16, 48],   // Wild Berry
        [255, 255, 255]  // Coconut Pulp
      ];
      let step = 0;
      strobeTimer = setInterval(() => {
        const c = rainbowColors[step % rainbowColors.length];
        const colStr = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        if (chamberEl) {
          chamberEl.style.borderColor = colStr;
          chamberEl.style.boxShadow = `0 0 25px ${colStr}`;
        }
        if (dieEl) {
          dieEl.style.background = colStr;
          dieEl.style.boxShadow = `0 0 20px ${colStr}`;
        }
        if (auraEl) {
          auraEl.style.background = `radial-gradient(circle, ${colStr} 0%, rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.35) 45%, transparent 75%)`;
        }
        if (colorLabel) colorLabel.textContent = `⚡ RANDEN COCO-STROBE ACTIVE`;
        if (detailLabel) detailLabel.textContent = `70ms Pulsing Loop // ${colStr}`;
        step++;
      }, 70);
      return;
    }

    const colStr = `rgb(${r}, ${g}, ${b})`;

    if (r === 0 && g === 0 && b === 0) {
      if (sphereEl) sphereEl.style.transform = 'scale(1) rotate(0deg)';
      if (chamberEl) {
        chamberEl.style.borderColor = '#2a1a35';
        chamberEl.style.boxShadow = 'none';
      }
      if (dieEl) {
        dieEl.style.background = '#1a0c24';
        dieEl.style.boxShadow = 'none';
      }
      if (auraEl) auraEl.style.opacity = '0';
      if (colorLabel) colorLabel.textContent = '🌙 DEEP FOREST BLACKOUT';
      if (detailLabel) detailLabel.textContent = 'Hardware NeoPixel aus (Standby)';
      return;
    }

    if (sphereEl) sphereEl.style.transform = 'scale(1.04)';
    if (chamberEl) {
      chamberEl.style.borderColor = colStr;
      chamberEl.style.boxShadow = `0 0 25px ${colStr}`;
    }
    if (dieEl) {
      dieEl.style.background = colStr;
      dieEl.style.boxShadow = `0 0 20px ${colStr}`;
    }
    if (auraEl) {
      auraEl.style.opacity = '0.9';
      auraEl.style.background = `radial-gradient(circle, ${colStr} 0%, rgba(${r}, ${g}, ${b}, 0.3) 45%, transparent 70%)`;
    }
    if (colorLabel) {
      colorLabel.textContent = customLabel || `COCONUT BIO-GLOW`;
    }
    if (detailLabel) {
      const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
      detailLabel.textContent = `${hex} • RGB(${r}, ${g}, ${b}) • ${currentDurationSec}s Timer`;
    }
  }

  // --- HiveMQ WebSockets Link ---
  function setupMQTT() {
    if (typeof mqtt === 'undefined') {
      logTerminal('MQTT.js Client nicht geladen.', 'err');
      return;
    }

    const clientId = 'RandeResonator_' + Math.random().toString(16).substr(2, 8);
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
        logTerminal('[MQTT] Subscribed zu randelab/solar/ack & randelab/solar/cmd');
        mqttClient.subscribe('randelab/solar/ack', { qos: 0 });
        mqttClient.subscribe('randelab/solar/cmd', { qos: 0 });

        const badge = document.getElementById('hardwareBadge');
        if (badge) {
          badge.innerHTML = '<span class="status-dot"></span> <span>ESP32-S3 ONLINE</span>';
          badge.style.borderColor = 'rgba(0, 255, 136, 0.4)';
        }
      });

      mqttClient.on('message', function (topic, message) {
        const payloadStr = message.toString();

        if (topic === 'randelab/solar/ack') {
          try {
            const ack = JSON.parse(payloadStr);
            const rtt = lastCommandSentMs > 0 ? (Date.now() - lastCommandSentMs) : 0;
            const rttStr = rtt > 0 ? ` (Ping: ${rtt} ms)` : '';
            logTerminal(`[ESP32 ACK ⚡] ${ack.action || 'ok'} // R=${ack.r || 0} G=${ack.g || 0} B=${ack.b || 0} (${ack.duration_sec || 10}s)${rttStr}`, 'ack');

            const latencyEl = document.getElementById('pingLatencyBadge');
            if (latencyEl && rtt > 0) {
              latencyEl.textContent = `⚡ ${rtt} ms`;
              latencyEl.style.display = 'inline-block';
            }

            if (ack.action === 'disco_strobe') {
              renderResonator(0, 0, 0, true);
            } else if (ack.r !== undefined && ack.g !== undefined && ack.b !== undefined) {
              renderResonator(ack.r, ack.g, ack.b, false);
            }
          } catch (e) {
            logTerminal(`[ESP32 ACK ⚡] ${payloadStr}`, 'ack');
          }
        } else if (topic === 'randelab/solar/cmd') {
          try {
            const cmd = JSON.parse(payloadStr);
            if (cmd.action === 'led' && cmd.color) {
              logTerminal(`[REMOTE 📡] Externer Befehl: ${cmd.color}`, 'tx');
              if (cmd.color === 'disco' || cmd.color === 'strobe' || cmd.color === 'party') {
                renderResonator(0, 0, 0, true);
              }
            }
          } catch (e) {}
        }
      });

      mqttClient.on('offline', function () {
        isConnectedMqtt = false;
        const badge = document.getElementById('hardwareBadge');
        if (badge) {
          badge.innerHTML = '<span class="status-dot" style="background:#ff3860; box-shadow:0 0 8px #ff3860;"></span> <span>MQTT RECONNECTING</span>';
        }
      });

      mqttClient.on('error', function (err) {
        logTerminal(`[MQTT ⚠️] Fehler: ${err}`, 'err');
      });
    } catch (e) {
      logTerminal(`[MQTT ⚠️] ${e}`, 'err');
    }
  }

  // --- Dispatch Command (MQTT + Local REST) ---
  window.triggerCocoColor = async function (colorName, rgbPreset, labelText) {
    lastCommandSentMs = Date.now();
    playSynthZap(540, 'sine', 0.12);

    // 1. Immediate visual feedback
    if (colorName === 'disco' || colorName === 'strobe' || colorName === 'party') {
      renderResonator(0, 0, 0, true);
    } else if (rgbPreset && rgbPreset.length === 3) {
      renderResonator(rgbPreset[0], rgbPreset[1], rgbPreset[2], false, labelText);
    }

    logTerminal(`[DISPATCH 🚀] Sende "${colorName.toUpperCase()}" (${currentDurationSec}s)...`, 'tx');

    // 2. Publish to MQTT (reaches ESP32 anywhere via 5G)
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
      logTerminal('[MQTT ⚠️] Broker nicht verbunden, nutze lokalen REST-Kanal...', 'err');
    }

    // 3. Parallel REST Fallback if on local lab network
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

  // Duration Selection
  window.setDuration = function (sec, pillEl) {
    currentDurationSec = sec;
    document.querySelectorAll('.dur-pill').forEach(p => p.classList.remove('active'));
    if (pillEl) pillEl.classList.add('active');
    playCoconutClick(820);
    logTerminal(`[TIMER ⏱️] Leuchtdauer auf ${sec} Sekunden eingestellt.`);
  };

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    logTerminal('🥥 RandeLab Coconut Research Lab Disco initialisiert (857 m ü. M.)');
    logTerminal('Verbinde mit ESP32-S3 Hardware NeoPixel (GPIO 48)...');
    setupMQTT();

    // Default Bio-Pink State
    renderResonator(255, 0, 127, false, '🌺 ÄTZISLOO COCO-PINK');
  });

})();
