# 🥬🥥 Chabis Radio 5G & Coconut Observatory Report

**Datum & Zeit:** 2026-11-07 20:05:20  
**Mission:** Kabis & Kokosnuss Mobilfunk-Observatorium am Randen  
**Standort:** RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen (`47.7701° N, 8.5738° E`)  
**Höhe über Meer:** **857.0 m ü. M.** (Kammhöhe mit weiter Sichtlinie über Hügel & Täler)  
**Gateway:** Teltonika TRB500 Industrial 5G (`192.168.2.1`) • Quectel RG501Q-EU (Snapdragon X55)  
**Provider:** Salt / GoMo (MCC 228, MNC 03)  

---

## 1. Durchsatz & Kokosnuss-Turbo (Ookla Speedtest)

| Messgrösse | Gemessener Wert | Bewertung auf 857 m Randen |
| :--- | :--- | :--- |
| **⬇️ Download** | **13.11 Mbit/s** | 🥥🥥🥥🥥 Solide & zuverlässig durch das nasse Blätterdach |
| **⬆️ Upload** | **67.71 Mbit/s** | 🥥🥥🥥🥥🥥 **Exzellent (> 80 Mbit/s)** dank freier Kammhöhe! |
| **⏱️ Messdauer** | 33.3 s | Nativer Gateway-Daemon |
| **🌐 Peering Server** | ookla-in.salt.ch | Direktes Backbone Peering |

---

## 2. Aktive Funkverbindung (Serving Cell)

| Parameter | Wert | Beschreibung & Kokosnuss-Index |
| :--- | :--- | :--- |
| **Technologie** | `5G-NSA` (Non-Standalone) | 4G LTE-Anker + 5G NR Datenkanal |
| **LTE Primärband (PCC)** | **Band 3 (1800 MHz)** | EARFCN 1601 • 20 MHz Bandbreite |
| **5G Trägerband (SCC)** | **Band n1 (2100 MHz)** | ARFCN 432030 • 20 MHz Bandbreite |
| **Cell ID** | `29858817` | eNodeB `116636` • Sektor `1` |
| **Signalstärke (RSRP)** | **-94 dBm** | 🥥🥥🥥 Saftige Randen-Ernte (-93 dBm) |
| **Signal-to-Noise (SINR)** | **-2 dB** | Leichtes Rauschen durch Randen-Nadelbäume |
| **Signalqualität (RSRQ)** | **-15 dB** | Solider Empfang im dichten Gehölz |

---

## 3. Sichtbare Nachbarmasten auf 857 m ü. M.

```text
"neighbourcell intra","LTE",1601,54,-14,-93,-57,-,-,-,-,-,-
```

* **PCID 54 (Aktiv):** Mast Merishausen Südhang (eNodeB 116636)
* **PCID 227 & 239 (Nachbarn):** Mast Bargen / A4-Korridor (eNodeB 119388) mit -88 bis -100 dBm RSRP

---

*Erstellt mit dem Chabis Radio 5G Scanner CLI • RandeLab Autonomes Sonnenkraftwerk & Kokosnuss-Observatorium*
