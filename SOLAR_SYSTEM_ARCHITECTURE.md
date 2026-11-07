# ☀️ RandeSolar Systemarchitektur & Auslegungsdokumentation

**Standort:** RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen  
**Koordinaten:** 47.7612° N, 8.5868° E • ~640 m ü. M.  
**Systemtyp:** Autonomes Off-Grid Solar-Inselnetz mit 12V-Batteriespeicher & 230V-Wechselrichter  
**Stand:** November 2026

---

## 1. Systemübersicht & Blockschaltbild

```mermaid
flowchart TD
    subgraph PV_ARRAY["☀️ Energetica e.Classic M HC Modulfeld (120 Halbzellen)"]
        P1["Modul 1 (aktiv vor Gebäude)<br/>380 Wp • Voc 41.9V • Vmp 35.0V"]
        P2["Modul 2 (aktiv vor Gebäude)<br/>380 Wp • Voc 41.9V • Vmp 35.0V"]
        P_RESERVE["6x Reservemodule im Schuppen<br/>6x ~380 Wp = ~2.280 Wp Potenzial"]
    end

    subgraph MPPT_UNIT["⚡ Victron BlueSolar MPPT 75 | 15"]
        MPPT["MPPT Laderegler<br/>Max. 75V Voc | Max. 15A Ladestrom (~216W @ 12V)"]
        DONGLE["VE.Direct Bluetooth Smart Dongle<br/>AES-128-CTR Instant Beacon 0x02E1"]
        MPPT --- DONGLE
    end

    subgraph DC_BUS["🔋 12V DC Hauptschiene"]
        BATT["12V AGM Bleivlies-Akku<br/>(Puffer für Tag & Nacht)"]
        FUSE_INV["100A–150A Hochstromsicherung<br/>(Mega / ANL Fuse)"]
    end

    subgraph INVERTER_UNIT["⚡ 230V AC Stromnetz"]
        INV["RDDSPON Pure Sine Wave Inverter<br/>DC 12V ➔ AC 230V 50Hz Echte Sinuswelle<br/>4000W–5000W Peak / 2000W Dauer"]
        AC_SOCKETS["2x EU-Schuko Steckdosen<br/>(Laptops, Werkzeuge, Ladegeräte)"]
        INV --> AC_SOCKETS
    end

    subgraph MONITORING["📡 Telemetrie & Microclimate Observatory"]
        ESP32["ESP32-S3 Station (randesolar.local)<br/>• Hardware-AES BLE Scanner<br/>• 35'000 Flash-Puffer (48 Tage)<br/>• 5G Speedtest & Latenz-Benchmarking<br/>• GPIO 4 Vorbereitung für Panel-ADC"]
        ROUTER["5G Cellular Router (RandeLab WLAN)"]
        CLOUD["Supabase PostgreSQL & HiveMQ MQTT"]
    end

    P1 & P2 ==>|Parallel 1S2P (Voc 41.9V / ~22A Isc)| MPPT
    MPPT ==>|12V Ladekabel (max 15A)| BATT
    BATT ==>|25-35 mm² Batteriekabel| FUSE_INV ==> INV
    DONGLE -.->|Drahtlose BLE Instant Beacons| ESP32
    ESP32 <-->|WLAN & MQTT| ROUTER <-->|5G Uplink| CLOUD
```

---

## 2. Technische Daten der Module: Energetica e.Classic M HC

Laut offiziellem Datenblatt (**Energetica Photovoltaic Industries GmbH**, Liebenfels, Österreich):

| Parameter | Wert (STC: 1000 W/m², 25°C) | Wert (NMOT: 800 W/m², 20°C, 1 m/s) |
| :--- | :--- | :--- |
| **Nennleistung ($P_{max}$)** | **365 Wp – 390 Wp** (typ. ~380 Wp) | 274 Wp – 292 Wp |
| **Leerlaufspannung ($V_{oc}$)** | **41.17 V – 41.93 V** | 38.88 V – 39.60 V |
| **Arbeitspunktspannung ($V_{mpp}$)** | **34.37 V – 35.03 V** | 32.44 V – 33.06 V |
| **Arbeitspunktstrom ($I_{mpp}$)** | **10.67 A – 11.16 A** | 8.45 A – 8.84 A |
| **Kurzschlussstrom ($I_{sc}$)** | **11.26 A – 11.95 A** | 8.90 A – 9.45 A |
| **Zellentechnologie** | 120 monokristalline PERC Halbzellen | 12-Busbar Technologie |
| **Verschattungsschutz** | e.ISP® integrierte Elektronik auf Strang-Ebene | Verhindert Hotspots |
| **Abmessungen & Gewicht** | 1780 × 1042 × 36 mm • **21 kg** | Aluminiumrahmen schwarz |
| **Temperaturkoeffizient ($V_{oc}$)**| **$-0.26\% / \text{K}$** | Spannung steigt bei Kälte! |

---

## 3. Kritische Auslegungsgrenzen für den Victron MPPT 75 | 15

### 3.1 Die 75V-Spannungsgrenze (Zerstörungsgefahr!)
* **Max. zulässige PV-Leerlaufspannung am Regler:** **75 V**
* **1 Modul:** $V_{oc} = 41.93\text{ V}$ $\rightarrow$ **Sicherer Betrieb** ($41.93\text{ V} \ll 75\text{ V}$)
* **2 Module in Reihe:** 
  $$V_{oc} (25^\circ\text{C}) = 41.93\text{ V} \times 2 = \mathbf{83.86\text{ V}} > 75\text{ V} \quad \text{⛔ VERBOTEN!}$$
  Bei $-15^\circ\text{C}$ im Randen-Winter:
  $$V_{oc} (-15^\circ\text{C}) = 83.86\text{ V} \times [1 + (-0.0026) \times (-40)] \approx \mathbf{92.6\text{ V}}!$$
  > **Ergebnis:** Zwei dieser Module in Serie zerstören die Eingangsstufe des Victron 75|15 unweigerlich. Die Module dürfen an diesem Regler **ausschliesslich parallel (1S)** betrieben werden!

### 3.2 Die 15A-Ladestromgrenze bei 12V
* **Max. Ladestrom in den Akku:** $15\text{ A}$
* **Max. Ladeleistung:** $15\text{ A} \times 14.4\text{ V} \approx \mathbf{216\text{ W}}$
* **Aktuelles Setup (2 Module parallel = ~760 Wp):**
  * **Volle Sonne:** Der MPPT regelt sauber auf 15 A ab (*Clipping*). Dem Regler schadet das nicht, er nimmt sich nur den Strom, den er verarbeiten kann.
  * **Bewölkt / Randen-Hochnebel:** Bei nur 25% Einstrahlung liefern zwei 380W-Module immer noch $\approx \mathbf{190\text{ W}}$ und laden die Batterie mit fast maximalem Ladestrom!

---

## 4. Ausblick: Das 3-Kilowatt-Potenzial (Alle 8 Module)

Mit allen 8 Modulen im Schuppen verfügt das RandeLab über **$8 \times 380\text{ Wp} \approx \mathbf{3.040\text{ Wp}}$**. 

Um diese gewaltige Leistung vollständig für den **RDDSPON-Wechselrichter (4000W–5000W)** nutzbar zu machen, bieten sich folgende Ausbauvarianten an:

| Ausbaustufe | Hardware-Konfiguration | Geeignete Modul-Verschaltung | Nutzen für RandeLab |
| :--- | :--- | :--- | :--- |
| **Status Quo (Optimal für 75\|15)** | 2 Module parallel an Victron MPPT 75\|15 | **1S2P** (1 Strang, 2 parallel) | Perfekte Schlechtwetter-Ladung für 12V-Batterie, kein Neukauf nötig |
| **Ausbaustufe 1 (2. Laderegler)** | Weiterer Victron MPPT (z.B. SmartSolar 100\|20) parallel am Akku | 2 Module an 75\|15 + 2 Module an 100\|20 | Verdoppelt die Ladeleistung auf 35 A (~500 W) in den 12V-Akku |
| **Ausbaustufe 2 (Vollausbau 3 kWp)** | 1x Victron SmartSolar MPPT 150\|60 oder 150\|85 (ideal bei 24V oder 48V) | **2S4P** oder **3S2P** | Volle 3 kW Leistung: betreibt Werkzeuge, Heizung, Kaffeevollautomaten autark |

---

## 5. Sicherheits-Checkliste für den RDDSPON 230V Inverter

1. **Batteriekabel:** Da der Inverter bei 1500 W Dauerlast an 12 V ca. **$135\text{ A}$** zieht (und bei 4000 W Spitzenlast über $350\text{ A}$!), müssen die Batteriekabel **mindestens $25\text{ mm}^2$ oder $35\text{ mm}^2$** dick und maximal **1 Meter kurz** sein.
2. **Schmelzsicherung:** Eine **150 A Mega-Fuse** oder ANL-Sicherung direkt am Pluspol der Batterie schützt vor Kabelbrand im Kurzschlussfall.
3. **Leerer Ruhestrom:** Wenn der Inverter eingeschaltet ist, verbraucht er ca. **$1.0\text{ A} - 1.5\text{ A}$ im Leerlauf** (~15 W). Über eine 12-stündige Nacht sind das ca. **15 Ah bis 18 Ah**, die er der Batterie entzieht, selbst wenn kein 230V-Gerät eingesteckt ist. Bei Nichtbenutzung daher den Inverter über den Schalter ausschalten.
