# RandeSolar ☀️

Standalone wireless telemetry monitor for the **Victron MPPT 75 | 15** charge controller with openBrushograph Studio styling.

This project supports two interchangeable setups:
1. **ESP32-S3 Standalone Appliance**: Fully autonomous Wi-Fi + BLE device (no laptop needed).
2. **Local Python Server**: Runs locally on your Linux machine or Raspberry Pi.

---

## ⚡ Setup 1: Standalone ESP32-S3 Station (Active Now!)

Your **ESP32-S3** is flashed and currently running autonomously on the **RandeLab** Wi-Fi network:

- **Web Dashboard**: 👉 **[http://randesolar.local](http://randesolar.local)** *(or `http://192.168.1.101`)*
- **REST API**: `http://randesolar.local/api/live`
- **Wi-Fi Network**: `RandeLab`
- **Features**:
  - Embedded openBrushograph studio themes (Pinkograph, Randen, Deep Jungle, Coconut)
  - Hardware-accelerated AES-128-CTR decryption of Victron BLE Instant Readout
  - Built-in HTTP web server on port 80 & mDNS discovery
  - Powered via any 5V USB adapter anywhere in the lab

### Reflashing / Monitoring the ESP32:
```bash
cd ~/Documents/PlatformIO/Projects/RandeSolar

# Build and flash:
~/.platformio/penv/bin/pio run -t upload

# Open live serial monitor:
~/.platformio/penv/bin/pio device monitor
```

---

## 💻 Setup 2: Local Python Server & SQLite Logger

If you want long-term historical logging to SQLite with Chart.js time-series graphs and CSV export:

### 1. Start the Server
```bash
cd ~/Documents/PlatformIO/Projects/RandeSolar
./start.sh
```

### 2. Open the Dashboard
👉 **[http://localhost:8080](http://localhost:8080)**

### 3. Stop the Server
```bash
./stop.sh
```

---

## Configuration

Credentials and device settings are in [`config.json`](./config.json) (for Python) and [`src/main.cpp`](./src/main.cpp) (for ESP32):

- **Device MAC**: `cb:06:61:60:5a:c2`
- **Encryption Key**: `16233767e72a76e15c04023274102c9d`
- **Wi-Fi SSID**: `RandeLab`
