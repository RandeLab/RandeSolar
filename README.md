# RandeSolar ☀️

Standalone wireless solar & microclimate observatory for the **Victron MPPT 75 | 15** charge controller, **Teltonika TRB500 5G Gateway**, and 12V battery bank with openBrushograph Studio styling.

📍 **Station:** RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen (`47.7701° N, 8.5738° E`, ~`857m ü. M.`)

---

## ⚡ 100% Standalone Architecture (No Laptop Needed!)

Two ESP32-S3 devices run the pipeline autonomously 24/7. The **M5Stack StamPLC** (`stamplc.local` / `192.168.1.100`, firmware [`src/stamplc_main.cpp`](./src/stamplc_main.cpp)) is the main station; the original ESP32-S3 DevKit (`randesolar.local`, [`src/main.cpp`](./src/main.cpp)) is the legacy/backup unit.

1. **BLE Decryption**: Hardware-accelerated AES-128-CTR decryption of Victron MPPT 75|15 Instant Readout beacons (`0x02E1`).
2. **HiveMQ MQTT**: Streams live telemetry every 5s over WebSocket/MQTT (`broker.hivemq.com`, topic `randelab/solar/telemetry`).
3. **Supabase Cloud Database**: The StamPLC posts one row every **2 minutes** to the PostgreSQL table `solar_telemetry` over HTTPS (power, battery, network, weather, temperatures).
4. **35'000-Record LittleFS Flash Buffer**: Up to **48.6 days of offline resilience** during cell/internet outages, auto-draining back to Supabase on reconnection. CSV export at `/api/buffer/csv`.
5. **Teltonika TRB500 5G Gateway Telemetry**: LAN integration via `ubus` JSON-RPC (`192.168.2.1`): RSRP, SINR, RSRQ, band aggregation, native Ookla speedtests on demand. *(The 6-hourly scheduled speedtest is currently paused during development.)*
6. **MeteoSwiss Microclimate**: Open-Meteo API with the MeteoSwiss ICON-CH model for `47.7701° N, 8.5738° E, 857 m` (tilted irradiance for a 35° south-facing panel, clouds, rain, pressure), polled every 2 min.
7. **Dallas DS18B20 1-Wire Temperatures**: Probe 1 (Keller) on StamPLC Port A / GPIO 1 with 4.7 kΩ pull-up; Probe 2 (Raum) prepared. Shown on the LCD (Page 0 VU bar + Page 5), in MQTT, Supabase (`temp_dallas1`, `temp_dallas2`, `temp_plc`) and the web Mikroklima chart.
8. **StamPLC Display & Relays**: 240×135 IPS with 6 flicker-free (double-buffered) pages and 3 buttons. Relay 1 = 230V inverter (auto cut-off below 11.50 V), Relay 2 NC = 12V LED strip. See the [display manual](./docs/stamplc_display_manual.md).
9. **Standalone Telegram Bot (`@RandeSolarBot`)**: `/status`, `/weather`, `/mood`, `/speed`, `/ping`, plus a 20:00 evening report.
10. **Onboard Web Server & OTA**: Kraftwerk Studio on port 80, wireless updates via `ArduinoOTA` and the Web UI at `/update`.
11. **GitHub Pages Dashboard**: **[https://randelab.github.io/RandeSolar/](https://randelab.github.io/RandeSolar/)**, including speedtest averages (last 24 h and all-time) from Supabase history.
12. **Dual-Tier Power (24/7 Autarky)**: The controller runs from the 12V battery bank (<0.5W), so BLE tracking and flash logging continue while the 6000W inverter and routers are off.

---

## 📖 Systemarchitektur & Technische Dokumentation

Das Gesamtsystem ist in zwei modulare Spezialdokumentationen aufgeteilt:

1. ☀️ **Photovoltaik-Inselnetz & Speicher:**  
   👉 [**`SOLAR_SYSTEM_ARCHITECTURE.md`**](./SOLAR_SYSTEM_ARCHITECTURE.md)  
   *PV-Modulfeld (Energetica 380 Wp), Victron MPPT 75|15, 4x VOLTIC 380Ah-Batteriebank, RDDSPON 6000W Reinsinus-Inverter, Peukert-Effekt, Mechatronik-Absicherung & 3 kWp Ausbauplan.*

2. 🌐 **5G-Telekommunikation & Netzwerk-Infrastruktur:**  
   👉 [**`NETWORK_5G_INFRASTRUCTURE.md`**](./NETWORK_5G_INFRASTRUCTURE.md)  
   *Teltonika TRB500 Industrial Gateway, TP-Link Omada PoE Access Point, ubus JSON-RPC Schnittstelle, nativer Ookla 5G-Speedtest, 5G-HF-Physik auf 857m (RSRP/SINR), Frequenz-Tuning (700 MHz vs. 3.5 GHz N78) und 35'000-Datensatz LittleFS Flash-Puffer.*

3. 📺 **M5Stack StamPLC Hardware-Display & Tasten-Handbuch:**  
   👉 [**`docs/stamplc_display_manual.md`**](./docs/stamplc_display_manual.md)  
   *Bedienungsanleitung für das 240x135 IPS-Farbdisplay des StamPLC: Die 6 Bildschirm-Seiten (Page 0 Neon Coconut Emblem mit % SoC Pinion Wheel und RandeChistli-Temperaturbalken, Page 1 Solar & Batterie, Page 2 Netzwerk & Sync, Page 3 Teltonika 5G, Page 4 Meteo 857m, Page 5 Dallas 1-Wire Temperaturen), flackerfreies Double-Buffering, Tastenbelegung [A]/[B]/[C], Relais-Steuerung (230V Inverter & 12V LED Strip) und integrierter ByteBeat Chiptune Synthesizer.*

4. 🗺️ **HF-Radar & Grenznetz-Topographie (OSM):**  
   👉 [**`docs/maps/README.md`**](./docs/maps/README.md)  
   *Interaktive OpenStreetMap-Vektorkarte (randen_rf_map.svg) mit eingemessenen Schweizer und deutschen Grenzmasten, 384 GPS-Grenzpunkten der Swisstopo-Landesgrenze, Peilungen und interaktiven Hover-Tooltips.*

---

### Flash or Monitor Firmware:
```bash
# StamPLC (main station) - wireless OTA (use the IP, mDNS can time out):
pio run -e m5stack-stamplc-ota -t upload --upload-port 192.168.1.100
# StamPLC first-time flash over USB:
pio run -e m5stack-stamplc -t upload

# Legacy ESP32-S3 DevKit:
pio run -e esp32-s3-devkitc-1 -t upload   # USB
pio run -e esp32-s3-ota -t upload         # OTA (randesolar.local)

# Browser upload: http://<device>/update
# Serial monitor:
pio device monitor
```

---

## 📦 Legacy / Optional Local Tools (Optional)

The Python scripts (`server.py`, `supabase_logger.py`) were used during initial prototyping and are **no longer required** for continuous operation. The ESP32-S3 handles all cloud logging, MQTT streaming, and Telegram communications standalone.

---

## Configuration

Credentials and device settings are in [`config.json`](./config.json) (for Python) and [`src/main.cpp`](./src/main.cpp) (for ESP32):

- **Device MAC**: `cb:06:61:60:5a:c2`
- **Encryption Key**: `16233767e72a76e15c04023274102c9d`
- **Wi-Fi SSID**: `RandeLab`

---

<div align="center">

[![Bruce Lee Showdown](docs/artwork/c64_bruce_showdown.gif)](https://dusseiller.ch/)

*Bruce Lee rules · Open source — hack, remix, share.*

</div>

