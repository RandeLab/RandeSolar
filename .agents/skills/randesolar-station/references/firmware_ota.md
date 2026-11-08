# ⚡ Firmware Compilation & OTA Flashing Runbook

This document details the exact process for compiling, validating, and flashing the RandeSolar ESP32-S3 firmware.

---

## 1. PlatformIO Environment (`platformio.ini`)

* **Environment Name:** `esp32-s3-ota`
* **Target Board:** `esp32-s3-devkitc-1` (N8, 8MB Quad-SPI Flash, No PSRAM)
* **Framework:** Arduino / ESP-IDF
* **Frequency:** 240 MHz (XTAL 40 MHz)
* **Flash Mode:** `qio`, 80 MHz, 8 MB
* **Partition Table:** Custom with LittleFS data partition (35,000 offline records)

```ini
[env:esp32-s3-ota]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
upload_protocol = espota
upload_port = 192.168.1.100
upload_flags =
    --port=3232
```

---

## 2. Compilation & Verification

Use the isolated Python environment containing PlatformIO Core:

```bash
# Check size and compile without flashing
/home/dusjagr/.platformio/penv/bin/pio run -e esp32-s3-ota
```

Expected binary output:
* RAM: ~17.5% (used ~57 KB from 327 KB)
* Flash: ~38.1% (used ~1.27 MB from 3.34 MB app partition)
* Target binary: `.pio/build/esp32-s3-ota/firmware.bin`

---

## 3. Wi-Fi Over-The-Air (ArduinoOTA) Flashing

ArduinoOTA runs on port **3232**. The target IP is **`192.168.1.100`** (or mDNS `randesolar.local`).

```bash
# Upload directly over LAN Wi-Fi OTA
/home/dusjagr/.platformio/penv/bin/pio run -e esp32-s3-ota -t upload --upload-port 192.168.1.100
```

### Upload Phases:
1. `Sending invitation to 192.168.1.100`
2. `Waiting for device...`
3. `Uploading: [========... 100% ] Done...`
4. `Result: OK` -> ESP32-S3 reboots into new firmware.

---

## 4. Web OTA Fallback (`/update`)

If ArduinoOTA is blocked by a firewall or router client isolation, use the Web OTA interface:
1. Open `http://192.168.1.100/update` in any browser.
2. Select `.pio/build/esp32-s3-ota/firmware.bin`.
3. Click **"Firmware aktualisieren"**. The web server streams chunked binary into the OTA partition and restarts the controller.
