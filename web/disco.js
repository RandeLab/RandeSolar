/**
 * RandeLab Alternative Coconut Research // Area 51 UFO Disco Controller (web/disco.js)
 * Dual HiveMQ MQTT (randelab/solar/cmd) + Local REST API (/api/led)
 * Web Audio Sci-Fi UFO Theremin & Laser Sound Engine
 * Real-time Tractor Beam simulation & ESP32-S3 GPIO 48 Hardware Controller
 */

(function () {
  'use strict';

  let mqttClient = null;
  let audioCtx = null;
  let isSoundActive = false;
  let thereminLoop = null;
  let strobeTimer = null;
  let currentDurationSec = 10;
  let lastCommandSentMs = 0;

  // --- Sci-Fi UFO Theremin & Laser Sound Engine ---
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

  // Laser beam zap sound
  function playLaserZap(freqStart, freqEnd, duration) {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(freqStart, now);
      osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  // Weird Sci-Fi B-Movie Flying Saucer / Theremin Wobble
  function startThereminSound() {
    if (!isSoundActive) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      let step = 0;
      thereminLoop = setInterval(() => {
        if (!isSoundActive) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';

        const now = ctx.currentTime;
        const baseFreq = 440 + Math.sin(step * 0.4) * 220;
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.linearRampToValueAtTime(baseFreq + 50, now + 0.15);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.18);
        step++;
      }, 180);
    } catch (e) {}
  }

  window.toggleSound = function () {
    isSoundActive = !isSoundActive;
    const btn = document.getElementById('btnToggleSound');
    if (isSoundActive) {
      getAudioContext();
      startThereminSound();
      if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '🛸 UFO SOUND: ON';
      }
      playLaserZap(900, 150, 0.25);
    } else {
      if (thereminLoop) {
        clearInterval(thereminLoop);
        thereminLoop = null;
      }
      if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '🛸 UFO SOUND: OFF';
      }
    }
  };

  // --- Visual Tractor Beam Renderer ---
  function updateTractorBeam(r, g, b, isStrobe, labelText) {
    const beam = document.getElementById('tractorBeam');
    const label = document.getElementById('beamLabel');

    if (strobeTimer) {
      clearInterval(strobeTimer);
      strobeTimer = null;
    }

    if (isStrobe) {
      const colors = [
        [57, 255, 20],   // Alien Green
        [255, 0, 127],   // Alien Pink
        [0, 240, 255],   // UFO Cyan
        [255, 234, 0],   // Plasma Gold
        [157, 0, 255],   // Saucer Purple
        [255, 255, 255]  // White
      ];
      let step = 0;
      strobeTimer = setInterval(() => {
        const c = colors[step % colors.length];
        const colStr = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.85)`;
        if (beam) {
          beam.style.background = `linear-gradient(to bottom, ${colStr} 0%, rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.15) 80%, transparent 100%)`;
          beam.style.filter = `drop-shadow(0 0 20px rgb(${c[0]}, ${c[1]}, ${c[2]}))`;
        }
        if (label) label.textContent = `⚡ UFO ABDUCTION STROBE ACTIVE // rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        step++;
      }, 70); // 70ms firmware cycle
      return;
    }

    if (r === 0 && g === 0 && b === 0) {
      if (beam) {
        beam.style.opacity = '0.05';
        beam.style.filter = 'none';
      }
      if (label) label.textContent = '🌑 CLOAKING ACTIVE // LED OFF';
      return;
    }

    if (beam) {
      beam.style.opacity = '1';
      beam.style.background = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, 0.85) 0%, rgba(${r}, ${g}, ${b}, 0.15) 80%, transparent 100%)`;
      beam.style.filter = `drop-shadow(0 0 20px rgb(${r}, ${g}, ${b}))`;
    }
    if (label) {
      const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
      label.textContent = labelText || `🛸 BEAM: ${hex} (RGB ${r}, ${g}, ${b})`;
    }
  }

  // --- MQTT Client Setup (HiveMQ WebSockets) ---
  function setupMQTT() {
    if (typeof mqtt === 'undefined') return;

    const clientId = 'RandeUfo_' + Math.random().toString(16).substr(2, 8);
    const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

    try {
      mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 8000
      });

      mqttClient.on('connect', function () {
        mqttClient.subscribe('randelab/solar/ack', { qos: 0 });
        mqttClient.subscribe('randelab/solar/cmd', { qos: 0 });
        const log = document.getElementById('logMini');
        if (log) log.textContent = '🟢 AREA 51 MQTT LINK ACTIVE';
      });

      mqttClient.on('message', function (topic, message) {
        const payloadStr = message.toString();

        if (topic === 'randelab/solar/ack') {
          try {
            const ack = JSON.parse(payloadStr);
            const rtt = lastCommandSentMs > 0 ? (Date.now() - lastCommandSentMs) : 0;
            const log = document.getElementById('logMini');
            if (log) {
              log.textContent = `⚡ ACK FROM ESP32: ${ack.action} (${rtt} ms roundtrip)`;
            }

            if (ack.action === 'disco_strobe') {
              updateTractorBeam(0, 0, 0, true);
            } else if (ack.r !== undefined && ack.g !== undefined && ack.b !== undefined) {
              updateTractorBeam(ack.r, ack.g, ack.b, false);
            }
          } catch (e) {}
        } else if (topic === 'randelab/solar/cmd') {
          try {
            const cmd = JSON.parse(payloadStr);
            if (cmd.action === 'led' && cmd.color) {
              if (cmd.color === 'disco' || cmd.color === 'strobe' || cmd.color === 'party') {
                updateTractorBeam(0, 0, 0, true);
              }
            }
          } catch (e) {}
        }
      });

      mqttClient.on('offline', function () {
        const log = document.getElementById('logMini');
        if (log) log.textContent = '🔴 MQTT RECONNECTING...';
      });
    } catch (e) {}
  }

  // --- Dispatch Command (MQTT + Local REST) ---
  window.triggerUfoColor = async function (colorName, rgbPreset, labelText) {
    lastCommandSentMs = Date.now();
    playLaserZap(800, 200, 0.15);

    // 1. Immediate visual update
    if (colorName === 'disco' || colorName === 'strobe' || colorName === 'party') {
      updateTractorBeam(0, 0, 0, true);
    } else if (rgbPreset && rgbPreset.length === 3) {
      updateTractorBeam(rgbPreset[0], rgbPreset[1], rgbPreset[2], false, labelText);
    }

    const log = document.getElementById('logMini');
    if (log) log.textContent = `🚀 FIRING BEAM: "${colorName.toUpperCase()}" (${currentDurationSec}s)...`;

    // 2. Publish to HiveMQ MQTT
    if (mqttClient && mqttClient.connected) {
      const payload = {
        action: 'led',
        color: colorName,
        duration_sec: currentDurationSec,
        t: Date.now()
      };
      mqttClient.publish('randelab/solar/cmd', JSON.stringify(payload));
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
            const rtt = Date.now() - lastCommandSentMs;
            if (log) log.textContent = `⚡ 192.168.1.100 ACK: OK (${rtt} ms)`;
            break;
          }
        } catch (e) {}
      }
    } catch (e) {}
  };

  // Duration selection
  window.setDuration = function (sec, btnEl) {
    currentDurationSec = sec;
    document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    playLaserZap(600, 300, 0.08);
  };

  document.addEventListener('DOMContentLoaded', () => {
    setupMQTT();
    // Default Alien Green tractor beam
    updateTractorBeam(57, 255, 20, false, '👽 TRACTOR BEAM: ALIEN GREEN');
  });

})();
