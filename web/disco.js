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

  // --- Dedicated Cocktail Procedural Synthesizers ---
  function playCocktailSound(colorName) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      switch (colorName) {
        case 'disco':
        case 'strobe':
        case 'party': {
          // ⚡ High-speed sci-fi UFO abduction beam charge + hyper-arpeggio
          const freqs = [330, 440, 554, 659, 880, 1108, 1318, 1760];
          freqs.forEach((f, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f, now + idx * 0.035);
            gain.gain.setValueAtTime(0.18, now + idx * 0.035);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.035 + 0.08);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.035);
            osc.stop(now + idx * 0.035 + 0.08);
          });
          break;
        }

        case 'pink': {
          // 🌺 COCO-PINK: Sweet sparkling bubble fizz / shimmering pop chord
          [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, now + i * 0.04);
            osc.frequency.exponentialRampToValueAtTime(f * 1.5, now + i * 0.04 + 0.12);
            gain.gain.setValueAtTime(0.2, now + i * 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.04);
            osc.stop(now + i * 0.04 + 0.15);
          });
          break;
        }

        case 'green': {
          // 🌴 JUNGLE MINT: Wooden organic marimba + bamboo shaker
          const osc1 = ctx.createOscillator();
          const gain1 = ctx.createGain();
          osc1.type = 'triangle';
          osc1.frequency.setValueAtTime(440, now);
          osc1.frequency.exponentialRampToValueAtTime(110, now + 0.12);
          gain1.gain.setValueAtTime(0.35, now);
          gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
          osc1.connect(gain1);
          gain1.connect(ctx.destination);
          osc1.start(now);
          osc1.stop(now + 0.12);

          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = 'triangle';
          osc2.frequency.setValueAtTime(880, now + 0.05);
          osc2.frequency.exponentialRampToValueAtTime(220, now + 0.18);
          gain2.gain.setValueAtTime(0.25, now + 0.05);
          gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start(now + 0.05);
          osc2.stop(now + 0.18);
          break;
        }

        case 'blue': {
          // 🌊 BLUE CURAÇAO: Subaquatic liquid bubble drop & resonant bandpass sweep
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
          osc.frequency.exponentialRampToValueAtTime(330, now + 0.22);
          gain.gain.setValueAtTime(0.32, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.22);
          break;
        }

        case 'yellow': {
          // 🥭 SOLAR MANGO: Punchy warm vintage 80s Moog brass stab
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();
          osc1.type = 'sawtooth';
          osc2.type = 'sawtooth';
          osc1.frequency.setValueAtTime(220, now);
          osc2.frequency.setValueAtTime(223, now); // Detuned for fat chorus
          gain.gain.setValueAtTime(0.28, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);
          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 0.25);
          osc2.stop(now + 0.25);
          break;
        }

        case 'cyan': {
          // 🦩 BIKINI CYAN: Cyber-metallic Yamaha DX7 FM bell chime
          const carrier = ctx.createOscillator();
          const mod = ctx.createOscillator();
          const modGain = ctx.createGain();
          const mainGain = ctx.createGain();

          carrier.type = 'sine';
          carrier.frequency.setValueAtTime(987.77, now);
          mod.type = 'sine';
          mod.frequency.setValueAtTime(1975.54, now);
          modGain.gain.setValueAtTime(600, now);
          modGain.gain.exponentialRampToValueAtTime(1, now + 0.35);

          mainGain.gain.setValueAtTime(0.25, now);
          mainGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

          mod.connect(modGain);
          modGain.connect(carrier.frequency);
          carrier.connect(mainGain);
          mainGain.connect(ctx.destination);

          mod.start(now);
          carrier.start(now);
          mod.stop(now + 0.35);
          carrier.stop(now + 0.35);
          break;
        }

        case 'red': {
          // 🌋 TIKI VULKAN: Deep 808 sub-bass explosion rumble & laser snap
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(180, now);
          osc.frequency.exponentialRampToValueAtTime(38, now + 0.35);
          gain.gain.setValueAtTime(0.4, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.35);
          break;
        }

        case 'orange': {
          // 🍊 PAPAYA SUNSET: Warm retro vibraphone / electric piano chord
          [392.00, 493.88, 587.33].forEach(f => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, now);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.28);
          });
          break;
        }

        case 'white': {
          // 🥥 PURE KOKOSMILCH: Hollow coconut shell "THUNK" + crystal ding
          const oscThunk = ctx.createOscillator();
          const gainThunk = ctx.createGain();
          oscThunk.type = 'sine';
          oscThunk.frequency.setValueAtTime(650, now);
          oscThunk.frequency.exponentialRampToValueAtTime(95, now + 0.07);
          gainThunk.gain.setValueAtTime(0.45, now);
          gainThunk.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
          oscThunk.connect(gainThunk);
          gainThunk.connect(ctx.destination);
          oscThunk.start(now);
          oscThunk.stop(now + 0.07);

          const oscChime = ctx.createOscillator();
          const gainChime = ctx.createGain();
          oscChime.type = 'sine';
          oscChime.frequency.setValueAtTime(1760, now + 0.04);
          gainChime.gain.setValueAtTime(0.18, now + 0.04);
          gainChime.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          oscChime.connect(gainChime);
          gainChime.connect(ctx.destination);
          oscChime.start(now + 0.04);
          oscChime.stop(now + 0.25);
          break;
        }

        case 'off': {
          // 🌙 NACHT-DRINK: Sci-fi beam shutdown / tape-stop power-down
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(500, now);
          osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
          gain.gain.setValueAtTime(0.25, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.35);
          break;
        }

        default:
          playLaserZap(800, 200, 0.15);
          break;
      }
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
    playCocktailSound(colorName);

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
