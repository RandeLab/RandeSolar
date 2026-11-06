# RandeSolar Offline Data Resilience & Edge Storage Protocol ☀️📦

This document describes the local offline data persistence, power-loss resilience, and opportunistic cloud synchronization architecture implemented on the **ESP32-S3** for the off-grid **RandeLab** installation.

---

## 1. Why Offline Resilience is Needed

At RandeLab (Underes Ätzisloo, Randen), electricity and the cellular 5G Wi-Fi router (`RandeLab`) are frequently switched off when leaving the cabin to conserve battery power.

- **5G Router Power:** Consumes **5 W to 15 W** continuously ($\sim 120\text{--}250\text{ Wh/day}$). In winter or prolonged overcast periods, keeping the router on 24/7 can drain an off-grid 12V battery bank.
- **ESP32-S3 Power:** Consumes only **~0.15 W** ($\sim 3.6\text{ Wh/day}$), making it safe to run continuously off the 12V battery without risking depletion.
- **Goal:** The ESP32-S3 must continuously capture Victron MPPT 75|15 Bluetooth telemetry even while the router is turned off, safely buffer the readings in onboard flash memory, and automatically upload the backlog to the cloud when Wi-Fi becomes available again.

---

## 2. Architecture Overview

```mermaid
flowchart TD
    Victron["Victron MPPT 75|15<br/>(Instant Readout BLE)"] -->|Encrypted Beacons| ESP["ESP32-S3 Station"]
    
    ESP --> CheckWiFi{Wi-Fi Connected?<br/>(5G Router ON?)}
    
    CheckWiFi -->|NO (Router OFF)| FlashStore["storeOfflineRecord()<br/>Append to LittleFS Flash Buffer<br/>(/solar_buffer.bin)"]
    
    CheckWiFi -->|YES (Router ON)| DirectUpload["logToSupabase()<br/>Live HTTPS POST"]
    DirectUpload --> DrainCheck{Backlog in Flash?}
    DrainCheck -->|YES| DrainSync["drainOfflineRecordsToCloud()<br/>Batch Upload Backlog with Preserved Timestamps"]
    DrainSync --> ClearFlash["LittleFS Clean Buffer"]
    DrainCheck -->|NO| Idle["Continue 2-min Cycle"]
```

---

## 3. Onboard Binary Storage Format (`LittleFS`)

Rather than storing bulky JSON text in flash (which wears out flash cells and wastes space), data is saved as raw **16-byte packed C-structs** in `/solar_buffer.bin`:

```cpp
struct __attribute__((packed)) OfflineSolarRecord {
    uint32_t timestamp;       // 4 bytes: Unix epoch timestamp (UTC)
    uint16_t solar_power;     // 2 bytes: Watts (0 - 65535 W)
    uint16_t battery_voltage; // 2 bytes: Centivolts (e.g. 1252 = 12.52 V)
    int16_t  battery_current; // 2 bytes: Deciamperes (e.g. 25 = 2.5 A)
    uint32_t yield_today_wh;  // 4 bytes: Watt-hours harvested today
    uint8_t  charge_state;    // 1 byte:  0=Off, 3=Bulk, 4=Absorption, 5=Float
    uint8_t  flags;           // 1 byte:  Bit 0: 1=NTP verified, 0=Uptime relative
};
```

### Storage Efficiency & Flash Lifespan:
| Metric | Specification |
| :--- | :--- |
| **Record Size** | Exactly **16 bytes** |
| **Sample Interval** | Every 2 minutes (when offline) |
| **Daily Storage** | 720 samples/day $\times$ 16 bytes = **11.5 KB / day** |
| **1 MB Flash Partition** | Holds **~65,000 records** ($\approx$ **90 days** of continuous offline logging) |
| **Flash Wear** | `LittleFS` uses dynamic wear leveling across 4 KB sectors, preventing cell degradation. |

---

## 4. How the Lifecycle Works

### A. Offline Logging Mode (Router OFF)
1. The ESP32 receives BLE advertisements from the Victron MPPT every 1–2 seconds.
2. Every 2 minutes, `logToSupabase()` checks `WiFi.status()`.
3. Seeing that Wi-Fi is disconnected, it immediately calls `storeOfflineRecord()`.
4. The 16-byte binary record is appended to `/solar_buffer.bin`.
5. The board stays active, reading sensors and blinking the onboard status LED.

### B. Reconnect & Opportunistic Cloud Sync (Router ON)
1. When you power on the 5G router, the ESP32 automatically reconnects to the `RandeLab` Wi-Fi.
2. On the next cycle, `drainOfflineRecordsToCloud()` detects that `buffered_records > 0`.
3. It opens `/solar_buffer.bin` and reads buffered records in **batches of 10**.
4. Each batch is converted into an ISO-timestamped JSON array and posted to Supabase:
   ```json
   [
     {"created_at":"2026-11-07T00:10:00Z","solar_power":45,"battery_voltage":12.85,"battery_current":3.5,"yield_today_wh":320,"charge_state":3,"state_str":"BULK"},
     {"created_at":"2026-11-07T00:12:00Z","solar_power":42,"battery_voltage":12.87,"battery_current":3.2,"yield_today_wh":322,"charge_state":3,"state_str":"BULK"}
   ]
   ```
5. Because historical records contain their original `created_at` timestamps, Supabase and the GitHub Pages charts place them at their **exact historical positions** without gaps.
6. Once the backlog is fully sent, `/solar_buffer.bin` is cleanly deleted.

---

## 5. Live Diagnostics & Monitoring

You can inspect the state of the offline buffer at any time:

1. **Local REST API (`/api/live`)**:
   ```json
   {
     "has_data": true,
     "solar_power": 0,
     "battery_voltage": 12.48,
     "buffered_records": 0,
     "ip": "192.168.1.100"
   }
   ```
   If the router was recently off, `"buffered_records"` will show the number of samples waiting to be flushed.

2. **Serial Console Logs (`115200 baud`)**:
   ```text
   [LittleFS 💾] Mounted! Buffered records waiting for sync: 0
   [LittleFS 📦] Appended record #14 to flash (0 W, 12.48 V)
   [LittleFS 🔄] Starting cloud sync for 14 buffered records...
   [LittleFS ✅] Synced batch of 10 records to Supabase!
   [LittleFS ✅] Synced batch of 4 records to Supabase!
   [LittleFS 🧹] All offline records successfully synced! Flash buffer emptied.
   ```

---

## 6. Supabase Free Tier Inactivity Protection

To ensure the Supabase PostgreSQL database project is never paused by Supabase during long off-grid winter breaks, a GitHub Actions runner is configured at [`.github/workflows/keepalive.yml`](../.github/workflows/keepalive.yml):
- Runs automatically **every 4 days at 04:00 UTC**.
- Pings the Supabase REST endpoint from GitHub's cloud servers.
- Guarantees the project stays active indefinitely even if RandeLab is unpowered for months.
