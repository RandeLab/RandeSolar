# RandeSolar ☀️

Standalone wireless solar & microclimate observatory for the **Victron MPPT 75 | 15** charge controller, **Teltonika TRB500 5G Gateway**, and 12V battery bank with openBrushograph Studio styling.

📍 **Station:** RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen (`47.7701° N, 8.5738° E`, ~`857m ü. M.`)

---

## ⚡ 100% Standalone ESP32-S3 Architecture (No Laptop Needed!)

The **ESP32-S3** handles the entire pipeline autonomously 24/7 without requiring any laptop or local server:

1. **BLE Decryption**: Hardware-accelerated AES-128-CTR decryption of Victron MPPT 75|15 Instant Readout beacons (`0x02E1`).
2. **HiveMQ MQTT**: Streams live telemetry packets every 5s over WebSocket/MQTT (`broker.hivemq.com`).
3. **Supabase Cloud Database**: Posts dense time-series telemetry every 20s directly to PostgreSQL cloud database over HTTPS for long-term charts.
4. **35'000-Record LittleFS Flash Buffer**: Up to **48.6 days of complete offline resilience** during cell/internet outages, auto-draining back to Supabase on reconnection. CSV export available at `/api/buffer/csv`.
5. **Teltonika TRB500 5G Gateway Telemetry**: Direct LAN integration via `ubus` JSON-RPC (`192.168.2.1`), querying cellular RF health (`RSRP`, `SINR`, `RSRQ`), band aggregation (`LTE B3 + 5G N1`), and running native Ookla speedtests on demand.
6. **MeteoSwiss Microclimate Correlation**: Fetches high-resolution Open-Meteo / ICON-CH weather data (solar irradiance in $W/m^2$, cloud cover %, rain, barometric pressure) to correlate microclimate with solar yield and 5G signal attenuation.
7. **Standalone Telegram Bot (`@RandeSolarBot`)**: Direct replies to commands (`/status`, `/weather`, `/mood`, `/speed`, `/ping`) and automated 20:00 evening summary reports.
8. **Onboard Web Server & OTA**: Runs openBrushograph Kraftwerk Studio on port 80 at **[http://randesolar.local](http://randesolar.local)** with wireless Over-The-Air firmware updates (`ArduinoOTA` + Web UI at `/update`).
9. **GitHub Pages Cloud Dashboard**: Accessible worldwide at **[https://randelab.github.io/RandeSolar/](https://randelab.github.io/RandeSolar/)** with 24-hour time formatting across all charts and metrics.
10. **Dual-Tier Power Architecture (24/7 Autarky)**: The ESP32-S3 is powered directly from the 12V DC battery bank via a 12V-to-5V USB converter (<0.5W), ensuring continuous BLE beacon tracking and flash logging even when the 6000W 230V AC inverter and cellular routers are completely shut down to conserve energy.

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
   *Bedienungsanleitung für das 240x135 IPS-Farbdisplay des StamPLC: Die 5 Bildschirm-Seiten (Page 0 Minimalistisches Hackteria Neon Coconut Emblem mit % SoC Pinion Wheel, Page 1 Solar & Batterie Hero, Page 2 Netzwerk & Sync, Page 3 Teltonika 5G Gateway, Page 4 Meteo 857m), Tastenbelegung [A]/[B]/[C], Relais-Steuerung (230V Inverter & 12V LED Strip) und integrierter ByteBeat Chiptune Synthesizer.*

4. 🗺️ **HF-Radar & Grenznetz-Topographie (OSM):**  
   👉 [**`docs/maps/README.md`**](./docs/maps/README.md)  
   *Interaktive OpenStreetMap-Vektorkarte (randen_rf_map.svg) mit eingemessenen Schweizer und deutschen Grenzmasten, 384 GPS-Grenzpunkten der Swisstopo-Landesgrenze, Peilungen und interaktiven Hover-Tooltips.*

---

### Flash or Monitor Firmware:
```bash
# 1. First-time flash over USB (/dev/ttyACM0):
pio run -e esp32-s3-devkitc-1 -t upload

# 2. Wireless OTA flash over Wi-Fi (randesolar.local):
pio run -e esp32-s3-ota -t upload

# 3. Or upload .pio/build/esp32-s3-devkitc-1/firmware.bin in your browser:
#    http://randesolar.local/update

# Open serial monitor:
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

