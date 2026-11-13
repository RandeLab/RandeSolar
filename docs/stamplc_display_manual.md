# 🛸 RandeSolar StamPLC Screen & Button Operations Manual
**Device**: M5Stack StamPLC (ESP32-S3, 240×135 IPS Display, Relays, Buzzer, WS2812 NeoPixel)  
**Location**: RandeLab, Underes Ätzisloo 189 (857 m ü. M.)  
**Firmware**: `src/stamplc_main.cpp` (OTA host: `stamplc.local`)

---

## 🕹️ Hardware Button Summary

The StamPLC front panel features three physical tactile buttons arranged horizontally directly below the display:
* **Btn [A]** (Left)
* **Btn [B]** (Center)
* **Btn [C]** (Right)

| Button Position | Page 0 (Coconut Emblem) | Page 1 (Solar & Battery) | Page 2 (Network & Sync) | Page 3 (Teltonika 5G) | Page 4 (Meteo Microclimate) | Page 5 (Temperature) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Btn [A] (Left)** | **Toggle 230V Inverter** (Relay 1 NO)<br>*(1800 Hz high chime ON / 900 Hz low OFF)* | **Toggle 230V Inverter** (Relay 1 NO)<br>*(Instant power switch)* | **Open Wi-Fi Menu**<br>*(Interactive AP selector)* | **Trigger Latency Ping**<br>*(Gateway & Cloudflare 1.1.1.1)* | **Force Weather Sync**<br>*(Fetch Open-Meteo & MeteoSwiss)* | **Re-Scan 1-Wire Bus**<br>*(2400 Hz chirp)* |
| **Btn [B] (Center)** | **Next Page ➡️** | **Next Page ➡️** | **Next Page ➡️** | **Next Page ➡️** | **Next Page ➡️** | **Back to Coconut 🥥** |
| **Btn [C] (Right)** | **Toggle 12V LED Strip** (Relay 2 NC)<br>*(2000 Hz ON / 1000 Hz OFF)* | **Force Refresh** | **Force Refresh** | **Force Refresh** | **Force Refresh** | **Force Refresh** |

> [!NOTE]
> **Safety Undervoltage Guard**: If battery voltage drops below $11.50\,\text{V}$, Relay 1 automatically cuts off the 230V inverter to protect the 4x VOLTIC 95 Ah AGM bank, accompanied by a double low warning tone ($800\,\text{Hz}$).

> [!TIP]
> **Flicker-free rendering**: All pages are drawn into a 240×135 off-screen `M5Canvas` sprite (~63 KB SRAM) and pushed to the panel in one transfer once per second. The screen is never blanked between frames. If the sprite allocation fails at boot, the firmware falls back to direct drawing (with the old 1 s flicker) and logs `[Display ⚠️]` on serial.

---

## 📺 The 6 Display Pages

### Page 0: The Minimalist Ambient Coconut Emblem
<p align="center">
  <img src="./images/page0_coconut.png" alt="Page 0: Minimalist Ambient Coconut Logo" width="480">
</p>

A completely number-free, retro-futuristic ambient screen designed for visual tranquility in the lab.

* **Outer 7-Tooth Pinion Wheel (Hackteria Hot Pink)**:
  * Serves as the **Battery State of Charge (% SoC)** radial fuel gauge.
  * **Active teeth**: Radiate with radiant white-hot neon pink (`#FF1E96` with `#FFE6F5` highlight).
  * **Inactive teeth**: Soft dusky pink neon tube (`#B42D69` / `#460A26`), maintaining the Open Source Hardware emblem shape without harsh black emptiness.
  * **Gauge Mapping**:
    * $\ge 97\%$ or Float: All 7 teeth lit (100% full).
    * $\ge 85\%$: 6 teeth lit (at nominal $12.62\,\text{V}$ rest $\approx 94\%$, exactly 6 teeth blaze).
    * $\ge 55\%$: 4 teeth lit (up to 12 o'clock center crest).
    * $< 10\%$: 0 teeth (deep-discharge warning).
* **Inner Coconut Core**:
  * Reflects the active Victron solar charge mode:
    * **Blazing Spring Green** (`#39FF14`): `BULK` harvest mode.
    * **Electric Gold** (`#FFD400`): `ABSORPTION` topping off.
    * **Electric Cyan** (`#00F5FF`): `FLOAT` or night standby.
* **Left-Hand 8-Pixel Temperature VU Meter (RandeChistli Hardware Replica)**:
  * Exact 1:1 replica of the [RandeChistli](https://github.com/RandeLab/RandeChistli) 8-pixel NeoPixel stick hardware:
    * **Pixel 0 (Bottom-most)**: The dedicated **Status LED** (`Wheel(60)` Amber-Green), winking Cyan when a live 1-Wire conversion arrives.
    * **Pixels 7 to 1 (7 Temperature Segments)**: Driven by the original integer formula `showPixel = map((long)temp, 4, 30, 7, 1)`:
      * **Pixel 1 (Top / $30.0^\circ\text{C}$)**: Bright Hot Red (`#FC0300`)
      * **Pixel 2 ($26.0^\circ\text{C}$)**: Orange-Flame (`#BA4500`)
      * **Pixel 3 ($22.0^\circ\text{C}$)**: Yellow-Amber (`#758A00`)
      * **Pixel 4 ($18.0^\circ\text{C}$–$21.0^\circ\text{C}$)**: **Pure Lime Green** (`#30CF00`) — sits right on comfort room temperature!
      * **Pixel 5 ($14.0^\circ\text{C}$)**: Aqua-Teal (`#00A857`)
      * **Pixel 6 ($9.0^\circ\text{C}$)**: Cyan-Blue (`#00639C`)
      * **Pixel 7 (Bottom / $4.0^\circ\text{C}$)**: Deep Electric Blue (`#001EE1`)
  * The topmost active segment highlights with a white core, while segments above remain dimly ghosted.
* **Yellow Straw ($45^\circ$)**: Solar harvest intake vector.
* **Bottom Status Bar**: Shows `[A] INV: ON/OFF`, `[C] STRIP: ON/OFF`, and `[B] Next >`.

---

### Page 1: Hero Solar & Battery Telemetry (`[P1/5]`)
<p align="center">
  <img src="./images/page1_solar.png" alt="Page 1: Hero Solar & Battery" width="480">
</p>

The core operational dashboard for daily power monitoring.

* **Top Header**: Title `RANDESOLAR`, page index `[P1/5]`, and real-time Inverter pill badge (`INV 230V: ON/OFF`).
* **Row 1**:
  * **Solar Generation (Yellow, Size 3)**: Instantaneous PV harvest in Watts (e.g., `74W`).
  * **Daily Yield (Grey, Size 2)**: Total accumulated harvest today in Watt-hours (e.g., `950Wh`).
* **Row 2**:
  * **Battery Voltage (Size 3)**: Color-coded ($>12.8\text{V}$ Green, $11.8\text{V}-12.8\text{V}$ Orange, $<11.8\text{V}$ Red).
  * **Net Battery Current (White, Size 2)**: Positive for charging, negative for discharge (e.g., `+5.8A`).
* **Row 3**:
  * **Charge Stage (Cyan)**: `BULK`, `ABSORPTION`, `FLOAT`, or `OFF`.
  * **BLE Signal (Grey)**: Signal strength to Victron MPPT (e.g., `-63dBm`).
* **Footer**: Quick button legend for `[A] INV` toggle and `[B] Next`.

---

### Page 2: Local Network & Cloud Sync (`[P2/5]`)
<p align="center">
  <img src="./images/page2_network.png" alt="Page 2: Network & Cloud Sync" width="480">
</p>

Connectivity diagnostics and offline flash logging status.

* **Wi-Fi SSID**: Active connection network (e.g., `WiFi: RandeLab`).
* **IP Address**: Local LAN IPv4 address (e.g., `192.168.1.100`).
* **MQTT Link**: Status on HiveMQ Cloud Broker (`CONNECTED` Green or `OFFLINE` Red).
* **Buffer & Latency**:
  * `Buf: Xrec`: Number of 2-minute offline telemetry records stored in LittleFS SPI flash waiting for cloud sync.
  * `Ping: Xms`: Round-trip TCP ping to the local gateway router.
* **Footer**: `[A] Wi-Fi Menu` opens the interactive wireless selector; `[B] Next`.

---

### Page 3: Teltonika 5G Mobile Gateway (`[P3/5]`)
<p align="center">
  <img src="./images/page3_teltonika.png" alt="Page 3: Teltonika 5G Gateway" width="480">
</p>

Live telematics queried directly from the TRB500 5G industrial gateway via JSON-RPC ubus.

* **Operator & Cellular Mode**: e.g., `GoMo • 5G-NSA` or `Salt • LTE`.
* **Carrier Bands**: Active primary and carrier-aggregated bands (e.g., `LTE B3 (n78)`).
* **RF Signal Quality**:
  * `RSRP`: Reference Signal Received Power in dBm (e.g., `-94 dBm`).
  * `SINR`: Signal-to-Interference-plus-Noise Ratio in dB (e.g., `-2 dB`).
* **Modem Performance**:
  * Shows Ookla speed test results (`Spd: 17M v / 56M ^`) or modem internal temperature (`Modem Temp: 16.0 C`).
* **Footer**: `[A] Test Ping` re-measures WAN ping and queries fresh gateway metrics.

---

### Page 4: MeteoSwiss & Local Microclimate (`[P4/5]`)
<p align="center">
  <img src="./images/page4_meteo.png" alt="Page 4: Weather & Microclimate" width="480">
</p>

Hyperlocal weather metrics for RandeLab (857 m altitude, tilt $35^\circ$).

* **Temperature & Solar Irradiance**:
  * `Temp: X.X °C` (Cyan).
  * `Global Tilted Irradiance: X W/m²` (Yellow) on the $35^\circ$ panel plane.
* **Clouds & Rain**:
  * `Cloud: X%`: Total cloud cover percentage.
  * `Rain: X.X mm`: Precipitation rate.
* **Humidity & Wind**:
  * Relative humidity percentage and $10\text{m}$ wind speed in km/h.
* **Barometric Pressure**:
  * Surface atmospheric pressure in hPa adjusted for 857 m elevation (e.g., `928.4 hPa`).
* **Footer**: `[A] Sync WX` triggers an instant fetch; `[B] Next P5` advances to the temperature page.

---

### Page 5: Dallas 1-Wire Temperatures (`[P5/5]`)

Live readings from the DS18B20 probes on the 1-Wire bus, plus the StamPLC internal board temperature.

**Wiring (Port A, red Grove socket)**

| Grove wire | Signal | DS18B20 |
| :--- | :--- | :--- |
| Black | GND | GND |
| Red | 5V | VDD |
| Yellow | **GPIO 1** (1-Wire data) | DQ |
| White | GPIO 2 (unused) | — |

* A **4.7 kΩ pull-up** between DQ and 5V is required. Several probes can share the same three wires (parallel bus).
* Probes are read asynchronously (non-blocking `requestTemperatures()` + 11-bit resolution, ~375 ms conversion), so the display and BLE never stall.

**Screen layouts**

* **0 probes found**: `No 1-Wire Probe` in red, wiring hint (`Port A / GPIO 1`, check pull-up) and the PLC board temperature.
* **1 probe**: Big green `XX.X C` (size 4), the probe's 64-bit factory ROM ID (e.g. `ID: 28FF…`), and the PLC board temperature.
* **2+ probes**: Probe 1 (green) and Probe 2 (cyan) side by side, `Diff: ±X.X C | Bus: N Devices`, and the PLC board temperature.
* Disconnected or failed probes show `--.- C` (internally `-999.0`). No value is invented.

**Probe naming (used everywhere: LCD, MQTT, Supabase, web)**

| Firmware var | JSON / DB column | Label | Status |
| :--- | :--- | :--- | :--- |
| `g_dallasTemp1` | `temp_dallas1` | Probe 1 / Keller | ✅ Installed |
| `g_dallasTemp2` | `temp_dallas2` | Probe 2 / Raum | ⏳ Prepared, not soldered yet |
| `g_plcInternalTemp` | `temp_plc` | StamPLC Board | ✅ Built-in |

> [!NOTE]
> Probe order on the bus follows the 1-Wire search order (determined by each probe's ROM ID), not the physical wire. After adding the second probe, check Page 5: if "Keller" and "Raum" are swapped, swap the probes (or pin the ROM IDs in firmware).

* **Footer**: `[A] Re-Scan` re-enumerates the bus (use after plugging in a probe); `[B] Coconut` returns to Page 0.

---

## ☁️ Where the Temperatures Go

| Channel | Interval | Fields |
| :--- | :--- | :--- |
| LCD Page 0 (VU bar) + Page 5 | 1 s | Probe 1 (falls back to PLC temp if no probe) |
| `GET /api/live` (LAN) | on request | `temp_dallas1`, `temp_dallas2`, `temp_plc`, `dallas_count` |
| MQTT `randelab/solar/telemetry` | 5 s | same as above |
| Supabase `solar_telemetry` | 120 s | `temp_dallas1`, `temp_dallas2` (`null` if absent), `temp_plc` |
| Web dashboard | live + history | Mikroklima cards and the Wetter & Mikroklima chart (Probe 1 lime green, Probe 2 pink) |

> [!IMPORTANT]
> Supabase columns `temp_dallas1`, `temp_dallas2`, `temp_plc` (type `REAL`) were added on 2026-11-13. Rows before that have `null` for these fields. Offline-buffered LittleFS records do **not** carry temperatures yet (only power/battery fields).

---

## 🚧 Development Flags

* **Speedtest at boot / scheduled speedtest is currently paused** in firmware (to stop a speedtest on every OTA reboot during development). Re-enable when development is finished. Manual tests via the web button / MQTT still work.

---

## 🔊 Onboard Audio & ByteBeat Chiptune Engine

The StamPLC buzzer (`STAMPLC_PIN_BUZZ` / GPIO 44) provides both functional feedback and generative 8-bit chiptunes:

* **Button Tones**:
  * Button [A] Inverter ON: $1800\,\text{Hz}$ tone ($60\,\text{ms}$).
  * Button [A] Inverter OFF: $900\,\text{Hz}$ tone ($80\,\text{ms}$).
  * Button [C] LED Strip ON: $2000\,\text{Hz}$ tone ($60\,\text{ms}$).
  * Button [C] LED Strip OFF: $1000\,\text{Hz}$ tone ($80\,\text{ms}$).
  * Page Cycle [B]: $1400\,\text{Hz}$ chirp ($40\,\text{ms}$).
* **ByteBeat 1-Liner Synthesizer (Triggered via Disco Web & MQTT)**:
  1. **Viznut #1**: `(t * 5 & t >> 7) | (t * 3 & t >> 10)`
  2. **Sierpinski Fractal**: `t * ((t >> 12 | t >> 8) & 63 & t >> 4)`
  3. **Cyberfunk**: `(t * 5 & t >> 5) | (t * 3 & t >> 8)`
  4. **Bitshift**: `(t >> 7 | t | t >> 6) * 10 + 4 * (t & t >> 13 | t >> 6)`
  5. **Acid 303**: `((t * (t >> 5 | t >> 8)) >> (t >> 16)) & 63`
