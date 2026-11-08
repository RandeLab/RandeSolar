# 📡 HiveMQ MQTT Protocol & Topic Schema

RandeSolar bridges physical hardware in the Randen mountains with worldwide web dashboards via HiveMQ public brokers.

---

## 1. Broker Connections

* **TCP Broker (for ESP32-S3 firmware):**  
  `broker.hivemq.com:1883` (No authentication required, public broker)
* **WebSockets Broker (for GitHub Pages web browsers):**  
  `wss://broker.hivemq.com:8884/mqtt` (Secure WebSockets)
* **Buffer Size:** 2048 bytes (allows full 13-channel Wi-Fi scan JSON payloads)

---

## 2. Topic Architecture

| Topic | Direction | Retention | Description |
| :--- | :---: | :---: | :--- |
| `randelab/solar/telemetry` | ESP32 ➔ Web | No | Live 5s solar metrics (Voltage, Current, Watts, SoC, Temperature) |
| `randelab/solar/wifi` | ESP32 ➔ Web | **Yes (Retained)** | Live Wi-Fi survey (SSIDs, BSSIDs, RSSI, Channel, Auth Mode) |
| `randelab/solar/cmd` | Web ➔ ESP32 | No | General commands (`led`, `speedtest`, `reboot`) |
| `randelab/solar/wifi/cmd` | Web ➔ ESP32 | No | Dedicated Wi-Fi scan trigger command (`{"action":"scan"}`) |
| `randelab/solar/ack` | ESP32 ➔ Web | No | Hardware execution confirmation with parameters |

---

## 3. Payload Schemas

### A. LED Command (`randelab/solar/cmd`)
```json
{
  "action": "led",
  "color": "pink",
  "duration_sec": 10,
  "t": 1731110000000
}
```
* Supported `color` values: `disco` (or `strobe`/`party`), `pink`, `green`, `blue`, `yellow`, `cyan`, `red`, `orange`, `white`, `off`.

### B. Hardware Acknowledgment (`randelab/solar/ack`)
```json
{
  "status": "ok",
  "action": "led",
  "r": 255,
  "g": 0,
  "b": 180,
  "duration_sec": 10
}
```
* For strobe: `{"status":"ok","action":"disco_strobe","duration_sec":10}`

### C. Wi-Fi Scan Retained Result (`randelab/solar/wifi`)
```json
{
  "status": "ok",
  "count": 3,
  "scan_time_ms": 4210,
  "networks": [
    {
      "ssid": "RandeLab",
      "bssid": "34:85:18:XX:XX:XX",
      "rssi": -48,
      "channel": 6,
      "auth": "WPA2_PSK"
    }
  ]
}
```
