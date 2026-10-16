# RandeSolar ☀️

Standalone wireless telemetry monitor for the **Victron MPPT 75 | 15** charge controller with openBrushograph Studio styling.

This project supports two interchangeable setups:
1. **ESP32-S3 Standalone Appliance**: Fully autonomous Wi-Fi + BLE device (no laptop needed).
2. **Local Python Server**: Runs locally on your Linux machine or Raspberry Pi.

---

---

## ⚡ 100% Standalone ESP32-S3 Architecture (No Laptop Needed!)

The **ESP32-S3** handles the entire pipeline autonomously 24/7 without requiring any laptop or local server:

1. **BLE Decryption**: Hardware-accelerated AES-128-CTR decryption of Victron MPPT 75|15 Instant Readout beacons.
2. **HiveMQ MQTT**: Streams live telemetry packets every 5s over WebSocket/MQTT (`broker.hivemq.com`).
3. **Supabase Cloud Database**: Posts dense time-series telemetry every 20s directly to PostgreSQL cloud database over HTTPS for long-term charts.
4. **Standalone Telegram Bot**: Direct replies to commands (`/status`, `/mood`, `/wiegehts`, `/ping`) and automated 20:00 evening summary reports.
5. **Onboard Web Server**: Runs openBrushograph Kraftwerk Studio on port 80 at **[http://randesolar.local](http://randesolar.local)**.
6. **GitHub Pages Cloud Dashboard**: Accessible worldwide at **[https://randelab.github.io/RandeSolar/](https://randelab.github.io/RandeSolar/)**.

### Flash or Monitor Firmware:
```bash
# Build and flash:
pio run -t upload

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
