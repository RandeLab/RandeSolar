# 🔌 Hardware Pinout & Wiring Specification

This document details the physical board layout of the ESP32-S3 at RandeLab and its connections to the Victron MPPT 75|15.

---

## 1. ESP32-S3 Board Pinout & LEDs

The module in use is an **ESP32-S3-WROOM-1 (N8 / 8MB Flash)** mounted on an ESP32-S3-DevKitC-1 compatible PCB with dual Type-C ports and a **CH343P** USB-to-UART bridge.

```
       [ Type-C USB ]     [ Type-C OTG ]
             │                   │
  CH343P ─── ▓
   TX Lamp ─ ▫ (Hardwired to UART TXD - blinks on serial TX)
   RX Light ─ ▫ (Hardwired to UART RXD - blinks on serial RX)
   PWR Lamp ─ 🔴 (Hardwired to AMS1117 3.3V rail - always ON, not controllable)
             │
             │       ┌─────────┐
             └─────► │  [RGB]  │ ◄─── WS2812 NeoPixel an GPIO 48!
                     └─────────┘      (The ONLY software-controllable LED)
```

### Pin Specifications:
* **`RGB_BUILTIN` (GPIO 48):** Connected to WS2812 addressable RGB LED. Driven via `neopixelWrite(48, r, g, b)`.
* **Left USB:** Connected to CH343P (flashing / serial monitor / power).
* **Right USB:** Native USB OTG (direct connection to ESP32-S3 D+/D- GPIO 19/20).
* **Power Supply:** 12V ➔ 5V DC-DC USB converter connected directly to 12V AGM battery bank.

---

## 2. Victron MPPT 75|15 Load Switching Options

The Victron SmartSolar MPPT 75|15 has dedicated `LOAD` terminals (max 15A electronic disconnect).

### Current Setup: Passive BLE Sniffing
* The ESP32 listens to broadcast BLE Instant Readout advertisements from the VE.Direct Bluetooth Smart Dongle (`mfgId == 0x02E1`) decrypted with AES-128-CTR.
* This connection is **listen-only** (unidirectional); software commands cannot be sent over passive BLE.

### Future 12V Load Switching Methods:
1. **VE.Direct HEX Protocol via UART:**
   * Requires connecting an ESP32 Hardware UART (e.g. GPIO 17 RX, GPIO 18 TX + GND) to the 4-pin VE.Direct port.
   * Sending HEX command to register `0xEDAD` sets load state: `0x00` = Off, `0x04` = Always On.
2. **VE.Direct RX Pin as Digital Remote On/Off:**
   * In the VictronConnect app under `Settings -> TX/RX port function`, configure the RX pin as "Remote on/off cable".
   * A single ESP32 GPIO wire pulling the RX pin LOW or HIGH switches the 12V load output.
3. **External 12V Power MOSFET / Relay Module:**
   * Wire an external relay module to an unused ESP32 GPIO (e.g. GPIO 5 or 6).
   * Direct disconnection of any 12V branch without modifying the Victron port.
