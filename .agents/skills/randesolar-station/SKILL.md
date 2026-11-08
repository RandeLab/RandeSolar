---
name: randesolar-station
description: >-
  Standard operating procedures, firmware engineering, OTA flashing, MQTT telemetry,
  hardware WS2812 NeoPixel controls, Wi-Fi RF scanning, and Area 51 Disco Web Audio
  interfaces for the RandeSolar ESP32-S3 station at RandeLab (857 m ü. M.).
  Use whenever modifying RandeSolar firmware (src/main.cpp), flashing the ESP32 via OTA,
  controlling the onboard LED, working with MQTT topics (randelab/solar/*), or editing
  the web interfaces (index.html, wifi.html, disco.html, and web/).
---

# ☀️ RandeSolar Station: Autonomous Microclimate & Hardware Runbook

The **RandeSolar Station** is an off-grid telemetry, microclimate, and RF observatory deployed at **RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen (857 m ü. M.)**. It monitors a Victron BlueSolar MPPT 75|15 with 4x 95Ah AGM batteries (380 Ah @ 12V), connects to an outdoor Teltonika TRB500 5G gateway, and drives interactive web dashboards hosted on GitHub Pages (`https://randelab.github.io/RandeSolar`).

---

## ⚡ Non-Negotiable Operational Rules

1. **Zero Fabricated / Mock Telemetry**:
   * Never simulate, mock, or fabricate hardware data (SSIDs, solar wattage, battery voltages, cellular signals).
   * If hardware is offline or unreachable, return explicit error codes or declare offline status.
2. **Dual-Directory Web Parity**:
   * All user-facing pages exist in root (`index.html`, `wifi.html`, `disco.html`) and inside `web/` (`web/index.html`, etc.).
   * Any change made to a root page MUST be mirrored to `web/` with adjusted relative paths (`./web/` ➔ `./`, `./docs/artwork/` ➔ `../docs/artwork/`).
3. **Local OTA Safety**:
   * The ESP32-S3 provides a 2-second ArduinoOTA rescue window on boot.
   * Flashing over Wi-Fi OTA uses target IP `192.168.1.100` (`upload_protocol = espota`).

---

## 🛠️ Quick Procedures & Workflows

### 1. Compile Firmware & OTA Upload
Compiles PlatformIO environment `esp32-s3-ota` and flashes over the local LAN:

```bash
# 1. Compile firmware
/home/dusjagr/.platformio/penv/bin/pio run -e esp32-s3-ota

# 2. Upload over local Wi-Fi OTA (IP: 192.168.1.100)
/home/dusjagr/.platformio/penv/bin/pio run -e esp32-s3-ota -t upload --upload-port 192.168.1.100
```
> See [`firmware_ota.md`](./references/firmware_ota.md) for web-based chunked `/update` and rescue procedures.

---

### 2. Control Onboard WS2812 NeoPixel (GPIO 48)

The ESP32-S3 DevKitC-1 board features an addressable WS2812 RGB LED on **GPIO 48** (`RGB_BUILTIN`). (The `PWR` LED is hardwired to 3.3V and not controllable).

#### Via MQTT (Worldwide from GitHub Pages)
* Broker: `broker.hivemq.com:1883` (or WSS: `wss://broker.hivemq.com:8884/mqtt`)
* Publish Topic: `randelab/solar/cmd`
* Feedback Topic: `randelab/solar/ack`

```bash
# Trigger Disco Strobe (70ms rainbow cycle for 10s)
mosquitto_pub -h broker.hivemq.com -p 1883 -t "randelab/solar/cmd" -m '{"action":"led","color":"disco","duration_sec":10}'

# Trigger Pink
mosquitto_pub -h broker.hivemq.com -p 1883 -t "randelab/solar/cmd" -m '{"action":"led","color":"pink","duration_sec":10}'

# Listen for physical hardware confirmation (ACK)
mosquitto_sub -h broker.hivemq.com -p 1883 -t "randelab/solar/ack" -C 1
```

#### Via Local REST API (Fast LAN)
```bash
# In local LAN (192.168.1.100 or randesolar.local)
curl -s "http://192.168.1.100/api/led?color=green&duration=10"
curl -s "http://192.168.1.100/api/led?color=disco&duration=10"
curl -s "http://192.168.1.100/api/led?color=off"
```
> See [`test_led.sh`](./scripts/test_led.sh) for an automated test script.

---

### 3. Wi-Fi 2.4 GHz SIGINT Hardware Scan
* Trigger full hardware scan via REST:
  `curl -s http://192.168.1.100/api/wifi/scan`
* Trigger scan via MQTT:
  Publish `{"action":"scan"}` to `randelab/solar/wifi/cmd`.
  Results are published with MQTT retention on `randelab/solar/wifi`.

---

### 4. Area 51 Coconut Disco & Web Audio Synthesizer
* Dedicated page: `disco.html` and `web/disco.html`.
* Psychedelic Area 51 Coconut Research aesthetic (`DUSJAGR IS ALIVE // 51 YEARS ON EARTH`).
* Features 9 procedural Web Audio synthesized cocktails + UFO Theremin sound:
  1. 🌺 **Coco-Pink**: Sparkling C-Major-7 sine bubble chime
  2. 🌴 **Jungle Mint**: Dual-stage resonant wooden marimba
  3. 🌊 **Blue Curaçao**: Subaquatic liquid bubble drop sweep
  4. 🥭 **Solar Mango**: Vintage analog Moog brass stab (detuned saw)
  5. 🦩 **Bikini Cyan**: Yamaha DX7 metallic FM bell chime (2:1 ratio)
  6. 🌋 **Tiki Vulkan**: 808 sub-bass explosion rumble (180 ➔ 38 Hz)
  7. 🍊 **Papaya Sunset**: Retro vibraphone warm G-Major chord
  8. 🥥 **Kokosmilch**: Hollow coconut shell "THUNK" + crystal ding
  9. 🌙 **Nacht-Drink**: Sci-fi tape-stop power-down sweep (beam shutdown)
  10. ⚡ **Master Strobe**: Hyper-arpeggio 70ms pulse loop

---

## 📚 Technical References

* [`firmware_ota.md`](./references/firmware_ota.md): Full PlatformIO environment, memory partitions, and OTA flashing guides.
* [`mqtt_protocol.md`](./references/mqtt_protocol.md): Topic schemas, JSON formats, and HiveMQ broker bridge parameters.
* [`hardware_pinout.md`](./references/hardware_pinout.md): Pinout diagram, CH343P USB chip, and Victron MPPT 75|15 VE.Direct details.
* [`web_disco_audio.md`](./references/web_disco_audio.md): Web Audio API synthesis engine, tractor beam SVG rendering, and UI sync.
