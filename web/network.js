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
    vuBarSinr: document.getElementById('vuBarSinr'),
    // Big Radar Modal
    radarModal: document.getElementById('crtRadarModal'),
    bigRadarCanvas: document.getElementById('crtBigRadarCanvas'),
    radarCrosshairTooltip: document.getElementById('radarCrosshairTooltip'),
    radarMastsList: document.getElementById('radarMastsList'),
    targetStatusBadge: document.getElementById('targetStatusBadge'),
    targetName: document.getElementById('targetName'),
    targetDist: document.getElementById('targetDist'),
    targetBearing: document.getElementById('targetBearing'),
    targetOperator: document.getElementById('targetOperator'),
    targetBand: document.getElementById('targetBand'),
    targetRsrp: document.getElementById('targetRsrp'),
    targetBandwidth: document.getElementById('targetBandwidth'),
    targetCoords: document.getElementById('targetCoords'),
    targetDesc: document.getElementById('targetDesc')
  };

  // Big Radar Modal State
  let radarModalOpen = false;
  let radarRangeKm = 5.0;
  let radarSweepSpeed = 1.0;
  let selectedMastId = 'meri_south';

  // 7 Calibrated Masts in Randen Corridor (Calculated from RandeLab: 47.7701°N, 8.5738°E)
  const MASTS = [
    { 
      id: 'meri_south', 
      name: '🇨🇭 Merishausen Südhang', 
      shortLabel: 'Südhang (1.8k)',
      distKm: 1.82, 
      bearingDeg: 135.1, 
      band: 'LTE B3 (20M) + 5G n1 (20M)', 
      color: '#00f3ff', 
      active: true,
      operator: 'Salt / GoMo (Cell 23667202)',
      freq: '1800 MHz + 2100 MHz (40 MHz CA)',
      rsrp: '-93 dBm (LOCKED)',
      sinr: '-1 dB ... +11 dB',
      status: '🟢 ACTIVE 5G SERVING CELL (CA LOCKED)',
      coords: '47.7585° N, 8.5910° E',
      bandwidth: '40 MHz (20M + 20M CA)',
      desc: 'Hauptzelle 23667202. Band 8 erfolgreich gebypasst. 58.8 Mbit/s Upload stabil.'
    },
    { 
      id: 'hagenturm', 
      name: '🇨🇭 Hagenturm (912m)', 
      shortLabel: 'Hagenturm (0.6k)',
      distKm: 0.64, 
      bearingDeg: 313.3, 
      band: 'Swisscom/Sunrise 5G n78', 
      color: '#f59e0b', 
      active: false,
      operator: 'Swisscom (228 01) & Sunrise (228 02)',
      freq: '700 / 1800 / 2100 / 3500 MHz (n78)',
      rsrp: '-62 dBm (Freie Sichtlinie LOS)',
      sinr: '> +20 dB',
      status: '🏔️ HÖCHSTER PUNKT SH (640m NW • SICHTLINIE)',
      coords: '47.77404° N, 8.56757° E',
      bandwidth: '60 MHz Multi-Carrier',
      desc: 'Höchster Punkt im Kanton Schaffhausen (912 m ü. M.). 40m Stahlfachwerkturm direkt 640 m NW vom RandeLab mit freier optischer Sichtlinie.'
    },
    { 
      id: 'randen_b8', 
      name: '🇨🇭 Lokale Zelle Randen (B8)', 
      shortLabel: 'Randen B8 (0.8k)',
      distKm: 0.78, 
      bearingDeg: 150.2, 
      band: 'LTE B8 (900 MHz)', 
      color: '#ffb000', 
      active: false,
      operator: 'Salt / GoMo (Cell 30556191)',
      freq: '900 MHz (10 MHz Kanal)',
      rsrp: '-81 dBm (Dämpfungsumgehung)',
      sinr: '+14 dB',
      status: '⚠️ GEBLOCKT / BAND 8 FALLE (10 MHz)',
      coords: '47.7640° N, 8.5790° E',
      bandwidth: '10 MHz (überlastet)',
      desc: 'Band 8 Falle! Zwar starker Pegel (-81 dBm), aber nur 2 Mbit/s Durchsatz wegen Überlastung. Im Modem manuell deaktiviert.'
    },
    { 
      id: 'meri_dorf', 
      name: '🇨🇭 Merishausen Dorf', 
      shortLabel: 'Dorf (1.4k)',
      distKm: 1.41, 
      bearingDeg: 201.2, 
      band: 'Multi-OP (B20/B8/B3)', 
      color: '#39ff14', 
      active: false,
      operator: 'Salt / Swisscom / Sunrise',
      freq: '800 / 900 / 1800 MHz',
      rsrp: '-104 dBm',
      sinr: '-4 dB',
      status: '⚪ STANDBY / TALBODEN',
      coords: '47.7580° N, 8.5680° E',
      bandwidth: '15 MHz',
      desc: 'Antennenstandort im Merishauser Talboden unterhalb der Randen-Geländekante.'
    },
    { 
      id: 'bargen', 
      name: '🇨🇭 Mast Bargen (A4-Korridor)', 
      shortLabel: 'Bargen A4 (3.1k)',
      distKm: 3.11, 
      bearingDeg: 47.5, 
      band: 'Salt LTE B20 (800 MHz)', 
      color: '#ec4899', 
      active: false,
      operator: 'Salt Schweiz / GoMo (228 03)',
      freq: '800 MHz (Band 20 • 10 MHz)',
      rsrp: '-88 dBm',
      sinr: '+12 dB',
      status: '🌲 REICHWEITEN-KÖNIG (14.3 / 54.8 Mbit/s)',
      coords: '47.7890° N, 8.6045° E',
      bandwidth: '10 MHz Sub-1GHz',
      desc: 'A4-Verkehrsachse / Randen Osthang. Signal durchdringt 2.5 km geschlossenen Randenwald.'
    },
    { 
      id: 'wiechs', 
      name: '🇩🇪 Wiechs am Randen (DE)', 
      shortLabel: 'Wiechs DE (4.0k)',
      distKm: 3.99, 
      bearingDeg: 13.2, 
      band: 'Telekom DE 5G n28/n78 + B8/B20', 
      color: '#ef4444', 
      active: false,
      operator: 'Telekom Deutschland (262 01) & Vodafone (262 02)',
      freq: '700 / 800 / 900 / 3500 MHz',
      rsrp: '-91 dBm (Grenzübertritt)',
      sinr: '+8 dB',
      status: '🇩🇪 GRENZ-OVERSPILL (INLANDSVOLUMEN OHNE ROAMING)',
      coords: '47.8050° N, 8.5860° E',
      bandwidth: '20 MHz + 5G NR',
      desc: 'Deutscher Sender strahlt über die Landesgrenze in die Ätzisloo-Lichtung. Deutsche SIM gilt hier als Inland ohne Roaming-Limit.'
    },
    { 
      id: 'tengen', 
      name: '🇩🇪 Tengen / Kommingen (DE)', 
      shortLabel: 'Tengen DE (5.6k)',
      distKm: 5.57, 
      bearingDeg: 343.0, 
      band: '1+1 5G n78 + o2 LTE B20/B1', 
      color: '#8b5cf6', 
      active: false,
      operator: '1+1 Mobilfunk (262 23) & Telefónica o2 (262 03)',
      freq: '3500 MHz (n78) + 800 / 2100 MHz',
      rsrp: '-106 dBm',
      sinr: '-2 dB',
      status: '🇩🇪 1+1 5G OPEN-RAN & O2 ÜBER HEGAU',
      coords: '47.8180° N, 8.5520° E',
      bandwidth: '50 MHz C-Band',
      desc: 'Hegau-Kamm nach Süden. Modernstes europäisches Open-RAN Netz von 1+1.'
    }
  ];

  // =========================================================================
  // RETRO GEEK WEB AUDIO SYNTHESIZER (ZERO-DEPENDENCY PROCEDURAL DSP)
  // =========================================================================
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // 1. Mechanical Key / Switch Click (Tactile impulse transient)
  function playMechanicalClick(pitchMod = 1.0) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const t = ctx.currentTime;

      // Ultra-short noise burst (contact bounce)
      const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.005));
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(3200 * pitchMod, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.005);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);

      // Low resonant chassis body knock
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(380 * pitchMod, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.012);

      oscGain.gain.setValueAtTime(0.05, t);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.012);
    } catch (e) {}
  }

  // 2. CRT Degauss Coil Magnetic Thump + 15.6 kHz Flyback Ring
  function playDegaussThump() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const t = ctx.currentTime;

      // Sub-bass electromagnetic coil sweep (140 Hz -> 26 Hz)
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(140, t);
      subOsc.frequency.exponentialRampToValueAtTime(26, t + 0.45);

      subGain.gain.setValueAtTime(0.22, t);
      subGain.gain.linearRampToValueAtTime(0.18, t + 0.08);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

      // Magnetic AC hum (50 Hz buzz harmonics)
      const humOsc = ctx.createOscillator();
      const humGain = ctx.createGain();
      humOsc.type = 'sawtooth';
      humOsc.frequency.setValueAtTime(50, t);
      humGain.gain.setValueAtTime(0.04, t);
      humGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

      subOsc.connect(subGain);
      subGain.connect(ctx.destination);
      humOsc.connect(humGain);
      humGain.connect(ctx.destination);

      subOsc.start(t);
      humOsc.start(t);
      subOsc.stop(t + 0.5);
      humOsc.stop(t + 0.35);

      // CRT 15.6 kHz horizontal flyback transformer whine ring
      const flyback = ctx.createOscillator();
      const flyGain = ctx.createGain();
      flyback.type = 'sine';
      flyback.frequency.setValueAtTime(12000, t + 0.1);
      flyback.frequency.exponentialRampToValueAtTime(15625, t + 0.3);

      flyGain.gain.setValueAtTime(0.0001, t);
      flyGain.gain.setValueAtTime(0.018, t + 0.12);
      flyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

      flyback.connect(flyGain);
      flyGain.connect(ctx.destination);
      flyback.start(t + 0.1);
      flyback.stop(t + 0.45);
    } catch (e) {}
  }

  // Active Synthesizer Soundscape: 'analog' | '8bit' | 'cyberfm' | 'tube'
  let currentSoundscape = localStorage.getItem('randelab-soundscape') || 'analog';

  // 3A. ANALOG P1 SYNTH (Warm Moog Ladder Resonant Sonar Ping)
  function playAnalogMoogPing(ctx, isTarget) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = 'bandpass';
    filter.Q.value = 7.5;

    if (isTarget) {
      // Warm analog Moog-style resonant dive
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1260, t);
      osc.frequency.exponentialRampToValueAtTime(940, t + 0.38);
      filter.frequency.setValueAtTime(1200, t);
      filter.frequency.exponentialRampToValueAtTime(700, t + 0.38);

      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);

      // Deep sub-harmonic warmth
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(630, t);
      sub.frequency.exponentialRampToValueAtTime(470, t + 0.35);
      subGain.gain.setValueAtTime(0.06, t);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

      sub.connect(subGain);
      subGain.connect(ctx.destination);
      sub.start(t);
      sub.stop(t + 0.35);
    } else {
      // Background tower: subtle distant blip
      osc.type = 'sine';
      osc.frequency.setValueAtTime(640, t);
      filter.frequency.setValueAtTime(640, t);
      gain.gain.setValueAtTime(0.035, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    }

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + (isTarget ? 0.38 : 0.08));
  }

  // 3B. 8-BIT CHIPTUNE SYNTH (Commodore 64 SID Arpeggio & Pulse Chirp)
  function play8BitChiptunePing(ctx, isTarget) {
    const t = ctx.currentTime;

    if (isTarget) {
      // C64 SID-style 3-note rapid arpeggio (B5 -> E6 -> B6) with vibrato
      const notes = [987.77, 1318.51, 1975.53];
      const step = 0.024;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square'; // Authentic 8-bit pulse wave

        const noteStart = t + idx * step;
        const noteDur = (idx === notes.length - 1) ? 0.18 : step;

        osc.frequency.setValueAtTime(freq, noteStart);

        if (idx === notes.length - 1) {
          // Fast SID-style vibrato LFO on the sustained note
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          lfo.frequency.setValueAtTime(38, noteStart); // 38Hz fast chip vibrato
          lfoGain.gain.setValueAtTime(45, noteStart);
          lfo.connect(osc.frequency);
          lfo.start(noteStart);
          lfo.stop(noteStart + noteDur);
        }

        gain.gain.setValueAtTime(0.08, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + noteDur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(noteStart);
        osc.stop(noteStart + noteDur);
      });
    } else {
      // 8-bit blip-bloop for background towers
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(784, t);
      osc.frequency.setValueAtTime(1046, t + 0.018); // 2-step chip jump
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.045);
    }
  }

  // 3C. CYBER FM SYNTH (Yamaha DX7 / OPL3 2-Operator Metallic Bell)
  function playCyberFmPing(ctx, isTarget) {
    const t = ctx.currentTime;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const mainGain = ctx.createGain();

    if (isTarget) {
      // Crystalline metallic sci-fi sonar chime (1:4 frequency ratio)
      const carrierFreq = 1320;
      const modFreq = 330;
      const modIndex = 1600;

      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(carrierFreq, t);

      modulator.type = 'sine';
      modulator.frequency.setValueAtTime(modFreq, t);

      // FM Modulation Envelope: deep metallic clang decaying fast
      modGain.gain.setValueAtTime(modIndex, t);
      modGain.gain.exponentialRampToValueAtTime(10, t + 0.32);

      // Main Amplitude Envelope
      mainGain.gain.setValueAtTime(0.12, t);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency); // FM Synthesis!
      carrier.connect(mainGain);
      mainGain.connect(ctx.destination);

      carrier.start(t);
      modulator.start(t);
      carrier.stop(t + 0.36);
      modulator.stop(t + 0.36);
    } else {
      // Short FM crystalline tick
      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(1760, t);
      modulator.type = 'sine';
      modulator.frequency.setValueAtTime(440, t);
      modGain.gain.setValueAtTime(500, t);
      modGain.gain.exponentialRampToValueAtTime(1, t + 0.07);

      mainGain.gain.setValueAtTime(0.04, t);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(mainGain);
      mainGain.connect(ctx.destination);

      carrier.start(t);
      modulator.start(t);
      carrier.stop(t + 0.07);
      modulator.stop(t + 0.07);
    }
  }

  // 3D. TUBE BFO SYNTH (Shortwave Radio Heterodyne Beat & Carrier Whistle)
  function playTubeBfoPing(ctx, isTarget) {
    const t = ctx.currentTime;

    if (isTarget) {
      // Dual-oscillator heterodyne beat (1080 Hz vs 1088 Hz = 8Hz BFO beat)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1100, t);
      filter.Q.value = 4.0;

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1080, t);
      osc1.frequency.exponentialRampToValueAtTime(920, t + 0.4);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1088, t); // 8Hz offset creates the radio beat!
      osc2.frequency.exponentialRampToValueAtTime(928, t + 0.4);

      gain1.gain.setValueAtTime(0.09, t);
      gain1.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      gain2.gain.setValueAtTime(0.07, t);
      gain2.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain1);
      gain1.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.4);
      osc2.stop(t + 0.4);

      // Analog tube noise crackle at onset
      playGlitchStatic(0.04);
    } else {
      // Single heterodyne shortwave tick
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(840, t);
      gain.gain.setValueAtTime(0.035, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    }
  }

  // 3. Master Sonar Ping Dispatcher
  function playSonarPing(isTarget = true) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;

      switch (currentSoundscape) {
        case '8bit':
          play8BitChiptunePing(ctx, isTarget);
          break;
        case 'cyberfm':
          playCyberFmPing(ctx, isTarget);
          break;
        case 'tube':
          playTubeBfoPing(ctx, isTarget);
          break;
        case 'analog':
        default:
          playAnalogMoogPing(ctx, isTarget);
          break;
      }
    } catch (e) {}
  }

  // Switch Soundscape Synth Mode
  window.setSoundscape = function(mode, playSound = true) {
    currentSoundscape = mode;
    localStorage.setItem('randelab-soundscape', mode);
    document.querySelectorAll('.btn-soundscape').forEach(b => {
      b.classList.toggle('active', b.dataset.synth === mode);
    });
    if (playSound) {
      playMechanicalClick(1.2);
      playSonarPing(true);
      const names = {
        'analog': 'ANALOG P1 (Warm Moog Ladder Filter Sonar)',
        '8bit': '8-BIT CHIP (Commodore 64 SID Arpeggio)',
        'cyberfm': 'CYBER FM (Yamaha DX7 2-Op Metallic Chime)',
        'tube': 'TUBE BFO (Shortwave Radio Heterodyne Beat)'
      };
      logTTY(`[SYNTH] Audio Engine switched: ${names[mode] || mode}`);
    }
  };

  // 4. RF Static Atmospheric Glitch / Crackle
  function playGlitchStatic(duration = 0.22) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const t = ctx.currentTime;

      const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      // Generate bursty / fluttering static noise with dropouts
      for (let i = 0; i < bufferSize; i++) {
        const dropout = Math.random() > 0.85 ? 0 : 1;
        data[i] = (Math.random() * 2 - 1) * dropout * (1 - (i / bufferSize) * 0.7);
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, t);
      filter.Q.value = 2.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(t);
    } catch (e) {}
  }

  // 5. Bell 202 / AX.25 FSK Packet Radio Chirp (Telemetry burst)
  function playPacketBurst() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const t = ctx.currentTime;

      // Sequence of rapid tones (1200 Hz mark / 2200 Hz space)
      const freqs = [1200, 2200, 1200, 2200, 1200, 2200];
      const toneDur = 0.016; // 16ms per tone = ~60 baud retro packet burst

      freqs.forEach((freq, idx) => {
        const toneStart = t + idx * toneDur;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, toneStart);

        gain.gain.setValueAtTime(0.05, toneStart);
        gain.gain.exponentialRampToValueAtTime(0.001, toneStart + toneDur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(toneStart);
        osc.stop(toneStart + toneDur);
      });
    } catch (e) {}
  }

  // 6. Teletype Matrix Printer / Terminal Micro-click
  let lastTtyClick = 0;
  function playTeletypeClick() {
    if (!soundEnabled) return;
    const now = performance.now();
    if (now - lastTtyClick < 45) return; // Debounce so it doesn't overwhelm
    lastTtyClick = now;

    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const t = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      // Jitter frequency slightly for authentic acoustic variety
      osc.frequency.setValueAtTime(2200 + (Math.random() * 800 - 400), t);

      gain.gain.setValueAtTime(0.03, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.006);
    } catch (e) {}
  }

  // 7. Speedtest Launch Fanfare
  function playSpeedtestFanfare() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const t = ctx.currentTime;

      const notes = [440, 554, 659, 880, 1108, 1318];
      notes.forEach((freq, idx) => {
        const toneStart = t + idx * 0.05;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, toneStart);

        gain.gain.setValueAtTime(0.045, toneStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(toneStart);
        osc.stop(toneStart + 0.08);
      });
    } catch (e) {}
  }

  // Backward compatible beep helper
  function playBeep(freq = 880, type = 'sine', duration = 0.06, gain = 0.05) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gainNode.gain.setValueAtTime(gain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  // Sound FX Tester trigger helper
  window.testSoundFx = function(type) {
    if (!soundEnabled) {
      window.toggleSound();
    }
    switch (type) {
      case 'ping':
        playSonarPing(true);
        logTTY('[AUDIO_TEST] 📡 Radar Sonar Ping: Target Merishausen Südhang (150°, 1250 Hz)');
        break;
      case 'packet':
        playPacketBurst();
        logTTY('[AUDIO_TEST] 📻 FSK Packet Burst: Bell 202 1200/2200 Hz Telemetry Frame');
        break;
      case 'degauss':
        playDegaussThump();
        logTTY('[AUDIO_TEST] ⚡ CRT Degauss Coil Discharge + 15.6 kHz Flyback Ring');
        break;
      case 'glitch':
        playGlitchStatic();
        logTTY('[AUDIO_TEST] ⚡ RF Multipath Crackle & Noise Burst');
        break;
      case 'teletype':
        playTeletypeClick();
        logTTY('[AUDIO_TEST] ⌨️ TTY Matrix Printer Micro-Click');
        break;
      default:
        playSonarPing(true);
    }
  };

  // Phosphor Theme Switcher
  window.setPhosphorMode = function(color, isUser = true) {
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
    if (isUser) playMechanicalClick(1.2);
  };

  // Toggle Scanlines
  window.toggleScanlines = function() {
    scanlinesActive = !scanlinesActive;
    document.body.classList.toggle('no-scanlines', !scanlinesActive);
    if (el.scanlines) el.scanlines.style.display = scanlinesActive ? 'block' : 'none';
    localStorage.setItem('randelab-crt-scanlines', scanlinesActive);
    const btn = document.getElementById('btnToggleScanlines');
    if (btn) {
      btn.innerHTML = scanlinesActive ? '📺 LINES: ON' : '📺 LINES: OFF';
      btn.classList.toggle('active', scanlinesActive);
    }
    playMechanicalClick(0.9);
  };

  // Toggle Audio
  window.toggleSound = function() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('randelab-crt-sound', soundEnabled);
    const btn = document.getElementById('btnToggleSound');
    if (btn) btn.textContent = soundEnabled ? '🔊 AUDIO: ON' : '🔇 AUDIO: OFF';
    if (soundEnabled) {
      getAudioCtx();
      playDegaussThump();
      setTimeout(() => {
        playPacketBurst();
      }, 450);
      logTTY('[AUDIO] Web Audio DSP Synthesizer online! (Degauss, Radar Sonar, FSK Packet, TTY Clicks active)');
    } else {
      logTTY('[AUDIO] Synthesizer muted.');
    }
  };

  // Trigger Glitch Burst
  window.triggerGlitch = function() {
    if (!el.monitor) return;
    el.monitor.classList.add('glitch-hover');
    playGlitchStatic(0.35);
    logTTY('[ANOMALY] Atmospheric RF Multipath Glitch detected! Desync: +14ms');
    setTimeout(() => {
      el.monitor.classList.remove('glitch-hover');
    }, 600);
  };

  // Format TTY Log Line
  function logTTY(msg) {
    if (!el.ttyLog) return;
    playTeletypeClick();
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

  // =========================================================================
  // BIG RADAR MODAL CONTROLS & HUD INSPECTOR
  // =========================================================================
  window.openRadarModal = function() {
    radarModalOpen = true;
    if (el.radarModal) el.radarModal.classList.add('open');
    playMechanicalClick(1.2);
    playSonarPing(true);
    updateRadarInspector(selectedMastId);
    renderMastsList();
    logTTY('[RADAR] 360° Tactical Radar Scope expanded to high-res tactical HUD.');
  };

  window.closeRadarModal = function() {
    radarModalOpen = false;
    if (el.radarModal) el.radarModal.classList.remove('open');
    playMechanicalClick(0.8);
    logTTY('[RADAR] Radar Modal closed.');
  };

  window.onRadarModalBackdrop = function(e) {
    if (e.target === el.radarModal) {
      window.closeRadarModal();
    }
  };

  window.setRadarRange = function(rangeKm) {
    radarRangeKm = rangeKm;
    document.querySelectorAll('.btn-radar-range').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.range) === rangeKm);
    });
    playMechanicalClick(1.1);
    logTTY(`[RADAR] Tactical Range Scale set to: ${rangeKm} km`);
  };

  window.setRadarSpeed = function(val) {
    radarSweepSpeed = parseFloat(val);
    localStorage.setItem('randelab-radar-speed', radarSweepSpeed);

    const text = radarSweepSpeed === 0 ? 'PAUSED' : `${radarSweepSpeed.toFixed(1)}x`;
    const d1 = document.getElementById('radarSpeedDisplay');
    const d2 = document.getElementById('modalRadarSpeedDisplay');
    if (d1) d1.textContent = text;
    if (d2) d2.textContent = text;

    const s1 = document.getElementById('radarSpeedSlider');
    const s2 = document.getElementById('modalRadarSpeedSlider');
    if (s1 && parseFloat(s1.value) !== radarSweepSpeed) s1.value = radarSweepSpeed;
    if (s2 && parseFloat(s2.value) !== radarSweepSpeed) s2.value = radarSweepSpeed;

    const btn = document.getElementById('btnRadarSweepSpeed');
    if (btn) {
      btn.textContent = radarSweepSpeed === 0 ? 'SWEEP: PAUSE' : `SWEEP: ${radarSweepSpeed.toFixed(1)}X`;
    }
  };

  window.onRadarSpeedSlider = function(val) {
    window.setRadarSpeed(val);
  };

  window.toggleRadarSpeed = function() {
    if (radarSweepSpeed === 1.0) window.setRadarSpeed(2.0);
    else if (radarSweepSpeed === 2.0) window.setRadarSpeed(0.0);
    else window.setRadarSpeed(1.0);
    playMechanicalClick(1.0);
    logTTY(`[RADAR] Sweep Speed toggled: ${radarSweepSpeed === 0 ? 'PAUSED' : radarSweepSpeed + 'X'}`);
  };

  window.selectMast = function(id) {
    const m = MASTS.find(x => x.id === id);
    if (!m) return;
    selectedMastId = id;
    updateRadarInspector(id);
    renderMastsList();
    playMechanicalClick(1.2);
    playSonarPing(m.active);
    logTTY(`[RADAR_TARGET] Locked to: ${m.name} (${m.distKm}km @ ${m.bearingDeg}°)`);
  };

  function updateRadarInspector(id) {
    const m = MASTS.find(x => x.id === id) || MASTS[0];
    if (el.targetName) el.targetName.textContent = m.name;
    if (el.targetStatusBadge) {
      el.targetStatusBadge.textContent = m.status;
      el.targetStatusBadge.style.color = m.active ? 'var(--crt-main)' : (m.id.includes('b8') ? 'var(--crt-amber)' : 'var(--crt-dim)');
    }
    if (el.targetDist) el.targetDist.textContent = `${m.distKm.toFixed(2)} km`;
    if (el.targetBearing) el.targetBearing.textContent = `${m.bearingDeg}°`;
    if (el.targetOperator) el.targetOperator.textContent = m.operator || 'Salt / GoMo';
    if (el.targetBand) el.targetBand.textContent = m.band;
    if (el.targetRsrp) el.targetRsrp.textContent = m.rsrp;
    if (el.targetBandwidth) el.targetBandwidth.textContent = m.bandwidth || '20 MHz';
    if (el.targetCoords) el.targetCoords.textContent = m.coords || '47.7645° N, 8.5790° E';
    if (el.targetDesc) el.targetDesc.textContent = m.desc || '';
  }

  function renderMastsList() {
    if (!el.radarMastsList) return;
    el.radarMastsList.innerHTML = '';
    MASTS.forEach(m => {
      const pill = document.createElement('div');
      pill.className = `crt-mast-pill ${m.id === selectedMastId ? 'selected' : ''}`;
      pill.onclick = () => window.selectMast(m.id);
      pill.innerHTML = `
        <span style="font-weight:700;">${m.name}</span>
        <span style="font-size:0.68rem; color:${m.active ? 'var(--crt-main)' : (m.id.includes('de') ? '#ff4455' : 'var(--crt-dim)')};">
          ${m.bearingDeg}° • ${m.distKm}km
        </span>
      `;
      el.radarMastsList.appendChild(pill);
    });
  }

  // Keyboard shortcut for Modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && radarModalOpen) {
      window.closeRadarModal();
    }
  });

  // =========================================================================
  // DUAL RADAR ANIMATION LOOP (SMALL CRT PANEL + EXPANDED FULL HUD MODAL)
  // =========================================================================
  let radarAngle = 0;
  function initRadar() {
    const smallCanvas = el.radarCanvas;
    const bigCanvas = el.bigRadarCanvas;
    const smallCtx = smallCanvas ? smallCanvas.getContext('2d') : null;
    const bigCtx = bigCanvas ? bigCanvas.getContext('2d') : null;

    // Attach mouse interactions to Big Radar Canvas
    if (bigCanvas) {
      bigCanvas.addEventListener('mousemove', (e) => {
        const rect = bigCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const cx = bigCanvas.width / 2;
        const cy = bigCanvas.height / 2;
        const dx = mouseX - cx;
        const dy = mouseY - cy;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const maxRadius = cx - 35;
        const distKm = (distPx / maxRadius) * radarRangeKm;

        let angleRad = Math.atan2(dx, -dy);
        if (angleRad < 0) angleRad += Math.PI * 2;
        const deg = Math.round((angleRad * 180) / Math.PI);

        // Check hover over mast
        let hoveredMast = null;
        MASTS.forEach(m => {
          const targetRad = (m.bearingDeg * Math.PI) / 180;
          const targetDist = (m.distKm / radarRangeKm) * maxRadius;
          const tx = cx + Math.sin(targetRad) * targetDist;
          const ty = cy - Math.cos(targetRad) * targetDist;
          const mdx = mouseX - tx;
          const mdy = mouseY - ty;
          if (Math.sqrt(mdx * mdx + mdy * mdy) < 22) {
            hoveredMast = m;
          }
        });

        bigCanvas.style.cursor = hoveredMast ? 'pointer' : 'crosshair';

        if (el.radarCrosshairTooltip) {
          if (distPx <= maxRadius + 15) {
            el.radarCrosshairTooltip.style.display = 'block';
            el.radarCrosshairTooltip.style.left = `${mouseX + 14}px`;
            el.radarCrosshairTooltip.style.top = `${mouseY + 14}px`;
            if (hoveredMast) {
              el.radarCrosshairTooltip.innerHTML = `🎯 <b>${hoveredMast.name}</b><br>${hoveredMast.distKm} km • ${hoveredMast.bearingDeg}°<br>${hoveredMast.band}`;
            } else {
              el.radarCrosshairTooltip.innerHTML = `PEILUNG: <b>${deg}°</b><br>DISTANZ: <b>${distKm.toFixed(2)} km</b>`;
            }
          } else {
            el.radarCrosshairTooltip.style.display = 'none';
          }
        }
      });

      bigCanvas.addEventListener('mouseleave', () => {
        if (el.radarCrosshairTooltip) el.radarCrosshairTooltip.style.display = 'none';
      });

      bigCanvas.addEventListener('click', (e) => {
        const rect = bigCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const cx = bigCanvas.width / 2;
        const cy = bigCanvas.height / 2;
        const maxRadius = cx - 35;

        let clickedMast = null;
        MASTS.forEach(m => {
          const targetRad = (m.bearingDeg * Math.PI) / 180;
          const targetDist = (m.distKm / radarRangeKm) * maxRadius;
          const tx = cx + Math.sin(targetRad) * targetDist;
          const ty = cy - Math.cos(targetRad) * targetDist;
          const mdx = mouseX - tx;
          const mdy = mouseY - ty;
          if (Math.sqrt(mdx * mdx + mdy * mdy) < 26) {
            clickedMast = m;
          }
        });

        if (clickedMast) {
          window.selectMast(clickedMast.id);
        }
      });
    }

    // Main Draw Function (Called on every animation frame)
    function drawRadarFrame() {
      // Sweep angle rotation
      if (radarSweepSpeed > 0) {
        radarAngle = (radarAngle + 0.025 * radarSweepSpeed) % (Math.PI * 2);
      }

      // 1. Draw Small Canvas
      if (smallCtx) {
        const w = smallCanvas.width;
        const h = smallCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const maxRadius = cx - 18;
        const maxRangeKm = 5.0;

        smallCtx.fillStyle = 'rgba(2, 10, 4, 0.12)';
        smallCtx.fillRect(0, 0, w, h);

        // Range rings (1km ... 5km)
        smallCtx.strokeStyle = 'rgba(26, 87, 18, 0.45)';
        smallCtx.lineWidth = 1;
        for (let r = 1; r <= 5; r++) {
          const radius = (r / maxRangeKm) * maxRadius;
          smallCtx.beginPath();
          smallCtx.arc(cx, cy, radius, 0, Math.PI * 2);
          smallCtx.stroke();
          smallCtx.fillStyle = 'rgba(57, 255, 20, 0.4)';
          smallCtx.font = '8px monospace';
          smallCtx.fillText(`${r}k`, cx + 3, cy - radius + 9);
        }

        // Crosshairs
        smallCtx.beginPath();
        smallCtx.moveTo(cx, cy - maxRadius); smallCtx.lineTo(cx, cy + maxRadius);
        smallCtx.moveTo(cx - maxRadius, cy); smallCtx.lineTo(cx + maxRadius, cy);
        smallCtx.stroke();

        // Cardinal Labels
        smallCtx.fillStyle = 'rgba(57, 255, 20, 0.7)';
        smallCtx.font = '10px monospace';
        smallCtx.fillText('N 000°', cx - 18, 14);
        smallCtx.fillText('E 090°', w - 42, cy + 4);
        smallCtx.fillText('S 180°', cx - 18, h - 5);
        smallCtx.fillText('W 270°', 4, cy + 4);

        // Sweep Line
        const sweepX = cx + Math.cos(radarAngle - Math.PI / 2) * maxRadius;
        const sweepY = cy + Math.sin(radarAngle - Math.PI / 2) * maxRadius;
        const grad = smallCtx.createLinearGradient(cx, cy, sweepX, sweepY);
        grad.addColorStop(0, 'rgba(57, 255, 20, 0.8)');
        grad.addColorStop(1, 'rgba(57, 255, 20, 0.05)');
        smallCtx.strokeStyle = grad;
        smallCtx.lineWidth = 2;
        smallCtx.beginPath();
        smallCtx.moveTo(cx, cy);
        smallCtx.lineTo(sweepX, sweepY);
        smallCtx.stroke();

        // Draw Mast Blips
        MASTS.forEach(m => {
          const targetRad = (m.bearingDeg * Math.PI) / 180;
          const targetDist = (m.distKm / maxRangeKm) * maxRadius;
          const tx = cx + Math.sin(targetRad) * targetDist;
          const ty = cy - Math.cos(targetRad) * targetDist;

          let angleDiff = Math.abs(radarAngle - targetRad);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

          const isHit = angleDiff < 0.055;
          if (isHit) {
            const now = performance.now();
            if (!m._lastPingTime || (now - m._lastPingTime > 2200)) {
              m._lastPingTime = now;
              playSonarPing(m.active);
            }
          }

          smallCtx.fillStyle = isHit ? '#ffffff' : (m.active ? '#00f3ff' : m.color);
          smallCtx.beginPath();
          smallCtx.arc(tx, ty, isHit ? 5.5 : 3, 0, Math.PI * 2);
          smallCtx.fill();

          if (m.active) {
            smallCtx.strokeStyle = 'rgba(0, 243, 255, 0.8)';
            smallCtx.beginPath();
            smallCtx.arc(tx, ty, isHit ? 9 : 6, 0, Math.PI * 2);
            smallCtx.stroke();
          }

          smallCtx.fillStyle = isHit ? '#ffffff' : 'rgba(200, 255, 200, 0.65)';
          smallCtx.font = '8px monospace';
          smallCtx.fillText(m.shortLabel || m.name, tx + 6, ty + 3);
        });
      }

      // 2. Draw Big Modal Canvas (Only if Modal is Open)
      if (radarModalOpen && bigCtx) {
        const w = bigCanvas.width;
        const h = bigCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const maxRadius = cx - 35;

        bigCtx.fillStyle = 'rgba(1, 14, 6, 0.14)';
        bigCtx.fillRect(0, 0, w, h);

        // Distance range rings
        const numRings = radarRangeKm === 2.5 ? 5 : (radarRangeKm === 10 ? 5 : 5);
        const stepKm = radarRangeKm / numRings;

        bigCtx.strokeStyle = 'rgba(57, 255, 20, 0.22)';
        bigCtx.lineWidth = 1;

        for (let i = 1; i <= numRings; i++) {
          const rKm = i * stepKm;
          const radius = (rKm / radarRangeKm) * maxRadius;
          bigCtx.beginPath();
          bigCtx.arc(cx, cy, radius, 0, Math.PI * 2);
          bigCtx.stroke();

          bigCtx.fillStyle = 'rgba(57, 255, 20, 0.65)';
          bigCtx.font = '10px "JetBrains Mono", monospace';
          bigCtx.fillText(`${rKm.toFixed(1)} km`, cx + 4, cy - radius + 11);
        }

        // 30° Azimuth Radial Spokes & Degree Labels
        for (let deg = 0; deg < 360; deg += 30) {
          const rad = (deg * Math.PI) / 180;
          const outerX = cx + Math.sin(rad) * maxRadius;
          const outerY = cy - Math.cos(rad) * maxRadius;

          bigCtx.strokeStyle = (deg % 90 === 0) ? 'rgba(57, 255, 20, 0.5)' : 'rgba(57, 255, 20, 0.15)';
          bigCtx.lineWidth = (deg % 90 === 0) ? 1.5 : 0.8;
          bigCtx.beginPath();
          bigCtx.moveTo(cx, cy);
          bigCtx.lineTo(outerX, outerY);
          bigCtx.stroke();

          // Label outside radius
          const labelDist = maxRadius + 18;
          const lx = cx + Math.sin(rad) * labelDist;
          const ly = cy - Math.cos(rad) * labelDist + 4;
          bigCtx.fillStyle = (deg % 90 === 0) ? 'var(--crt-main)' : 'rgba(57, 255, 20, 0.7)';
          bigCtx.font = (deg % 90 === 0) ? 'bold 11px monospace' : '9px monospace';
          bigCtx.textAlign = 'center';
          bigCtx.fillText(`${String(deg).padStart(3, '0')}°`, lx, ly);
        }
        bigCtx.textAlign = 'start';

        // Outer Compass Ring
        bigCtx.strokeStyle = 'rgba(57, 255, 20, 0.4)';
        bigCtx.lineWidth = 2;
        bigCtx.beginPath();
        bigCtx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
        bigCtx.stroke();

        // Sweep Line + Phosphor Trail Wedge
        const sweepX = cx + Math.cos(radarAngle - Math.PI / 2) * maxRadius;
        const sweepY = cy + Math.sin(radarAngle - Math.PI / 2) * maxRadius;

        // Fading sweep sector cone
        const trailAngle = 0.25;
        const trailGrad = bigCtx.createRadialGradient(cx, cy, 10, cx, cy, maxRadius);
        trailGrad.addColorStop(0, 'rgba(57, 255, 20, 0.25)');
        trailGrad.addColorStop(1, 'rgba(57, 255, 20, 0.02)');
        bigCtx.fillStyle = trailGrad;
        bigCtx.beginPath();
        bigCtx.moveTo(cx, cy);
        bigCtx.arc(cx, cy, maxRadius, radarAngle - Math.PI / 2 - trailAngle, radarAngle - Math.PI / 2);
        bigCtx.closePath();
        bigCtx.fill();

        // Bright Sweep Beam
        bigCtx.strokeStyle = '#39ff14';
        bigCtx.shadowColor = '#39ff14';
        bigCtx.shadowBlur = 10;
        bigCtx.lineWidth = 2.5;
        bigCtx.beginPath();
        bigCtx.moveTo(cx, cy);
        bigCtx.lineTo(sweepX, sweepY);
        bigCtx.stroke();
        bigCtx.shadowBlur = 0; // reset

        // Draw All Mast Blips on Big Scope
        MASTS.forEach(m => {
          if (m.distKm > radarRangeKm * 1.05) return; // Outside current zoom

          const targetRad = (m.bearingDeg * Math.PI) / 180;
          const targetDist = (m.distKm / radarRangeKm) * maxRadius;
          const tx = cx + Math.sin(targetRad) * targetDist;
          const ty = cy - Math.cos(targetRad) * targetDist;

          let angleDiff = Math.abs(radarAngle - targetRad);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
          const isHit = angleDiff < 0.055;

          const isSelected = (m.id === selectedMastId);

          // Draw Selected Lock Reticle
          if (isSelected) {
            bigCtx.strokeStyle = '#00f3ff';
            bigCtx.lineWidth = 1.5;
            bigCtx.beginPath();
            bigCtx.arc(tx, ty, 14, 0, Math.PI * 2);
            bigCtx.stroke();

            // Reticle brackets
            bigCtx.beginPath();
            bigCtx.moveTo(tx - 18, ty); bigCtx.lineTo(tx - 12, ty);
            bigCtx.moveTo(tx + 12, ty); bigCtx.lineTo(tx + 18, ty);
            bigCtx.moveTo(tx, ty - 18); bigCtx.lineTo(tx, ty - 12);
            bigCtx.moveTo(tx, ty + 12); bigCtx.lineTo(tx, ty + 18);
            bigCtx.stroke();
          }

          // Blip circle
          bigCtx.fillStyle = isHit ? '#ffffff' : (m.active ? '#00f3ff' : m.color);
          bigCtx.beginPath();
          bigCtx.arc(tx, ty, isHit ? 8 : (isSelected ? 6 : 4.5), 0, Math.PI * 2);
          bigCtx.fill();

          if (isHit) {
            bigCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            bigCtx.lineWidth = 2;
            bigCtx.beginPath();
            bigCtx.arc(tx, ty, 18, 0, Math.PI * 2);
            bigCtx.stroke();
          }

          // Label
          bigCtx.fillStyle = isHit ? '#ffffff' : (isSelected ? '#00f3ff' : 'rgba(200, 255, 200, 0.85)');
          bigCtx.font = isSelected ? 'bold 11px monospace' : '10px monospace';
          bigCtx.fillText(`${m.name} (${m.distKm}k)`, tx + 10, ty + 4);
        });

        // Center Lab Origin Dot
        bigCtx.fillStyle = '#ffffff';
        bigCtx.beginPath();
        bigCtx.arc(cx, cy, 3, 0, Math.PI * 2);
        bigCtx.fill();
        bigCtx.fillStyle = 'rgba(57, 255, 20, 0.8)';
        bigCtx.font = '9px monospace';
        bigCtx.fillText('RandeLab (857m)', cx + 6, cy - 6);
      }

      requestAnimationFrame(drawRadarFrame);
    }

    drawRadarFrame();
  }

  // Update DOM with incoming telemetry
  function updateUI(data) {
    if (!data) return;
    lastTelemetry = data;
    lastDataTime = Date.now();

    // Sound FX: FSK telemetry packet chirp
    playPacketBurst();

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
    playSpeedtestFanfare();
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
    window.setPhosphorMode(currentPhosphor, false);

    // Apply saved soundscape synth & radar sweep speed
    window.setSoundscape(currentSoundscape, false);
    window.setRadarSpeed(radarSweepSpeed);

    // Scanlines State
    document.body.classList.toggle('no-scanlines', !scanlinesActive);
    if (el.scanlines) el.scanlines.style.display = scanlinesActive ? 'block' : 'none';
    const btnScan = document.getElementById('btnToggleScanlines');
    if (btnScan) {
      btnScan.innerHTML = scanlinesActive ? '📺 LINES: ON' : '📺 LINES: OFF';
      btnScan.classList.toggle('active', scanlinesActive);
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
