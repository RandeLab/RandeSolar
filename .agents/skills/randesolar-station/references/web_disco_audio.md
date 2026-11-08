# 🎛️ Web Audio Procedural Synthesis & Disco Interface

This document specifies the Web Audio API synthesis engine and SVG/CSS tractor beam rendering used in `disco.html` and `web/disco.html`.

---

## 1. Web Audio Architecture

All sounds are generated procedural in client-side JavaScript without external audio samples or network downloads.

### Cocktail Sound Profiles (`playCocktailSound(colorName)`):

| Cocktail / Action | Synthesis Type | Audio Node Pipeline | Frequency & Envelope |
| :--- | :--- | :--- | :--- |
| **Party Strobe** | 8-Note Sci-Fi Arpeggio | 8x Sawtooth Oscillators | `[330, 440, ..., 1760 Hz]` staggered by 35ms |
| **🌺 Coco-Pink** | Sparkling Pop Chime | 4x Sine Waves | C-Major-7 (`[523, 659, 784, 1046 Hz]`) with upward sweep |
| **🌴 Jungle Mint** | Dual Marimba Tap | 2x Triangle Oscillators | Resonance drop 440 ➔ 110 Hz + 880 ➔ 220 Hz |
| **🌊 Blue Curaçao** | Subaquatic Liquid Drop | 1x Sine Wave | 220 ➔ 880 ➔ 330 Hz resonant bandpass sweep |
| **🥭 Solar Mango** | Vintage Moog Brass Stab | 2x Detuned Sawtooth Waves | 220 Hz & 223 Hz (chorus beating) with exponential decay |
| **🦩 Bikini Cyan** | FM Metallic Bell Chime | 2:1 FM Ring Modulation | Carrier 988 Hz (B5), Modulator 1976 Hz, Mod Index 600 |
| **🌋 Tiki Vulkan** | 808 Sub-Bass Rumble | 1x Sine Wave | Sub-bass drop from 180 Hz ➔ 38 Hz over 350ms |
| **🍊 Papaya Sunset** | Warm Vibraphone Chord | 3x Triangle Oscillators | G-Major triad (`[392, 494, 587 Hz]`) with soft decay |
| **🥥 Kokosmilch** | Coconut "THUNK" + Ding | Sine + High Sine Chime | Low hollow knock 650 ➔ 95 Hz + high 1760 Hz ping |
| **🌙 Nacht-Drink** | Tape-Stop Power Down | Sawtooth Oscillator | Descending sci-fi shutdown 500 ➔ 40 Hz |

---

## 2. Interactive UFO Tractor Beam Simulation

The CSS/SVG tractor beam visually matches the real physical ESP32 NeoPixel:
* `tractor-beam`: Polygon clip-path cone with radial gradients and drop-shadow bloom.
* In Strobe Mode: Rapid 70ms interval cycling through rainbow hues, exactly matching `src/main.cpp` firmware pulse.
* Hovering Flying Saucer (🛸) levitating a coconut / alien skull (🥥👽).

---

## 3. GitHub Pages Deployment & Dual-Directory Sync

GitHub Pages serves from the repository root (or `/docs`). In this repo:
* `disco.html` lives at repository root (`https://randelab.github.io/RandeSolar/disco.html`).
* `web/disco.html` lives in the `/web` subdirectory.
* Rule: Maintain strict parity between root files and `web/` copies. When making edits to `disco.html`, replicate changes to `web/disco.html` with relative path updates (`./web/` ➔ `./`, `./docs/artwork/` ➔ `../docs/artwork/`).
