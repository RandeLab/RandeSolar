# ⚡ M5Stack StamPLC Integration Blueprint for RandeSolar
**Target Hardware:** M5Stack StamPLC (StampS3A / ESP32-S3FN8)  
**Location:** RandeLab (857 m ü. M.)  
**Role:** All-in-One Industrial Controller, Victron BLE Gateway & Inverter Sleep Guard  

---

## 1. System Architecture Overview

The **M5Stack StamPLC** replaces the loose ESP32 DevKit, breadboard wiring, and external 5V buck converter with a single, industrial DIN-rail PLC unit:

```
                  ┌──────────────────────────────────────────────────┐
                  │              M5Stack StamPLC (DIN-Rail)          │
                  │                                                  │
12V Battery Bank ─┼─► Top Terminals (+ / -) [9–36V DC Input]         │
(4x VOLTIC 380Ah) │                                                  │
                  │  ┌──────────────┐    ┌────────────────────────┐  │
                  │  │ ESP32-S3     │◄──►│ 1.14" LCD + 3 Buttons  │  │
Victron MPPT 75|15│  │ (StampS3A)   │    └────────────────────────┘  │
   (BLE Instant) ─┼─►│ • NimBLE BLE │    ┌────────────────────────┐  │
                  │  │ • Wi-Fi/MQTT │◄──►│ Onboard INA226 + LM75  │  │
                  │  │ • Web Server │    └────────────────────────┘  │
                  │  └──────┬───────┘                                │
                  │         │ (I2C)                                  │
                  │         ▼                                        │
                  │  [Relay 1: N.O / COM] ──┐                        │
                  └─────────────────────────┼────────────────────────┘
                                            │
   ┌────────────────────────────────────────┘
   │
   ▼
[🔑 Key Switch Upstairs] ("Amtlich OK" Box)
   │
   ▼
[RDDSPON 6000W Inverter] (Internal Front Switch Logic)
```

---

## 2. Klemmenbelegung & Wiring Plan

### A. Obere Klemmenleiste (Power & Inputs)
| Klemme | Signal | Anschluss am RandeLab |
| :--- | :--- | :--- |
| **`+`** | Power IN (+) | Direkt an **+12V Batteriebank** (über 2A-Flachsicherung) |
| **`-`** | Power IN (-) | Direkt an **Minus-Sammelschiene / Batterie-Minus** |
| **`C`** | Input Common | Masse (GND) für Digitaleingänge |
| **`IN 1`** | Opto-Input 1 (5–36V) | *Optional:* Abgriff hinter Schlüsselschalter (erkennt, ob Schlüssel gedreht ist) |
| **`IN 2..8`**| Freie Eingänge | Reserve (z.B. Türkontakt, 230V-Netzüberwachung via 12V-Steckernetzteil) |

### B. Untere Klemmenleiste (Relais-Ausgänge)
| Klemme | Relais | Funktion & Verkabelung |
| :--- | :--- | :--- |
| **`Relay 1 COM`** | Relais 1 | Draht 1 vom angelöteten Schlüsselschalter-Kabel |
| **`Relay 1 N.O`** | Relais 1 (Normally Open) | Draht 2 zur Steuerleitung des Inverters |
| **`Relay 2`** | Freies Relais (5A) | Reserve (z.B. 12V LTE-Router Hard-Reset) |
| **`Relay 3`** | Freies Relais (5A) | Reserve (z.B. 12V LED-Beleuchtung Hütte) |
| **`Relay 4`** | Freies Relais (5A) | Reserve (z.B. Generator-Fernstart-Impuls) |

> [!IMPORTANT]
> **Warum `Normally Open (N.O)`?**  
> Wenn der StamPLC stromlos ist oder rebootet, ist Relais 1 **offen**. Der Inverter bleibt aus. Das verhindert, dass bei einem Ausfall des Controllers der Inverter heimlich im Hintergrund die Batterie leersaugt.

---

## 3. Firmware-Konfiguration (`src/main.cpp`)

Da im StamPLC das **StampS3A-Modul** (ESP32-S3FN8 mit 8MB Flash) steckt, bleibt unser gesamter Code für BLE, MQTT, Web und LittleFS zu 100% erhalten.

### Hardware-Mapping im StamPLC
* **I2C Bus:** `SDA = GPIO 13`, `SCL = GPIO 15`
* **Relais & Inputs:** Angesteuert über den internen I/O-Expander via I2C (oder `M5StampPLC`-Library).
* **1.14" ST7789 LCD:** SPI-Display für Live-Status.
* **Tasten A, B, C:** 
  * **Taste A:** *Force ON* (Inverter für 2 Stunden erzwingen, Timer übersteuern).
  * **Taste B:** *Sleep / OFF* (Inverter sofort schlafen legen).
  * **Taste C:** Display-Seite umschalten (Page 1: Solar/Batterie, Page 2: Inverter/Relais, Page 3: Netzwerk).
* **Onboard Sensoren:**
  * `LM75`: Misst die Gehäusetemperatur im Verteiler.
  * `INA226`: Misst die Versorgungsspannung der 12V-Schiene direkt an der Klemme.

---

## 4. Lokales 1.14" LCD Display Layout

Auf dem kleinen Farbdisplay direkt an der Hutschiene:

```
┌──────────────────────────┐
│ RandeSolar      12.64V 🔋│  <- Spannung + Batterie-Icon
├──────────────────────────┤
│ Solar PV: 218W   430Wh ☀️│  <- Victron MPPT Live-Ertrag
│ Temp Lab: 4.2°C  [LM75]  │  <- Raumtemperatur
├──────────────────────────┤
│ INV [R1]: ACTIVE (ON)  ⚡│  <- Inverter-Status
│ Guard: 30m Filter ARMED  │  <- Schutzstatus
└──────────────────────────┘
 [BTN A: ON] [BTN B: SLEEP]
```

---

## 5. Schutz-Logik (Der 30-Minuten-Filter)

```cpp
// Pseudocode in loop()
if (solarData.battery_voltage < 12.10f && relay1_active) {
    if (low_voltage_timer_start == 0) {
        low_voltage_timer_start = millis();
    } else if (millis() - low_voltage_timer_start > 30 * 60 * 1000UL) {
        // 30 Minuten ununterbrochen unter 12.10 V
        setRelay(1, false); // Inverter ausschalten!
        relay1_active = false;
        mqttPublishEvent("inverter_sleep_guard", "triggered_30min_low");
    }
} else if (solarData.battery_voltage >= 12.20f) {
    // Spannung wieder erholt (Werkzeug ausgeschaltet) -> Timer reset!
    low_voltage_timer_start = 0;
}
```

---

## 6. Vorteile dieser Lösung auf einen Blick

1. **Kein Gebastel mehr:** Ersetzt lose fliegende Breadboard-Drähte und USB-Netzteile durch saubere Schraubklemmen auf Hutschiene.
2. **Direkt an 12 V:** Kein externer Step-Down-Wandler nötig, der StamPLC verträgt bis zu 36 V DC.
3. **Hardware-Schlüsselschalter bleibt Master:** In Reihe geschaltet behältst du die volle physische Kontrolle oben an der Wand.
4. **Vollständige Redundanz:** Du hast 3 weitere Relais und 8 Eingänge für zukünftige Automatisierungen frei.
