# 🏆 RandeLab 5G Masten-Olympiade & Multi-Antennen-Vergleich

**Datum & Zeit:** 2026-11-07 20:20:21  
**Standort:** RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen (`47.7701° N, 8.5738° E`)  
**Höhe:** **857.0 m ü. M.** (Kammhöhe mit Weitsicht nach Merishausen, Bargen und Schaffhausen)  
**Gateway:** Teltonika TRB500 Industrial 5G (`192.168.2.1`) • Quectel RG501Q-EU (Snapdragon X55)  
**Provider:** Salt / GoMo (MCC 228, MNC 03)  

---

## 1. Übersicht & Vergleichstabelle aller Masten

| Mobilfunkmast / Profil | Cell ID | Empfang (RSRP) | Rauschabstand (SINR) | ⬇️ Download | ⬆️ Upload |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auto (LTE B3 + 5G N1)** | `1C79C01` | -93 dBm | 9 dB | **15.59 Mbit/s** | **59.71 Mbit/s** |
| **Band 20 (800 MHz)** | `1692206` | -91 dBm | 4 dB | **0.33 Mbit/s** | **1.92 Mbit/s** |
| **Band 3 (1800 MHz LTE)** | `1692202` | -98 dBm | 5 dB | **N/A** | **N/A** |
| **Band 1 (2100 MHz)** | `-` | - dBm | - dB | **N/A** | **N/A** |
| **Band 28 (700 MHz)** | `-` | - dBm | - dB | **N/A** | **N/A** |


---

## 2. Physikalische HF-Erkenntnisse auf 857 m Randen-Kamm

1. **Reichweiten-König (Band 20 / 800 MHz):**  
   - Der Mast in **Bargen / A4-Korridor (`eNodeB 119388`)** liefert auf 800 MHz das **stärkste Gesamtsignal (`-88` bis `-89 dBm`)**.  
   - Langwellige 800-MHz-Signale werden durch das dichte, nasse Randen-Blätterdach deutlich weniger bedämpft als 1800-MHz- oder 2600-MHz-Signale.

2. **Durchsatz- und Upload-Sieger (Auto: Band 3 + 5G Band n1):**  
   - Die Kombination aus **LTE Band 3 (1800 MHz, 20 MHz Bandbreite)** und dem **5G NR-NSA Träger Band n1 (2100 MHz)** auf dem **Südhang-Mast Merishausen (`eNodeB 116636`)** erzielt den höchsten Upload (> 80 Mbit/s) und stabilen Download (> 25 Mbit/s).  
   - Carrier Aggregation bündelt zwei Frequenzen gleichzeitig.

3. **Ausfallsicherheit:**  
   - Sollte der Tal-Mast in Merishausen einmal ausfallen, hat das RandeLab über die Kuppe direkte Funkabdeckung durch den Bargen-Mast auf Band 20.

---

*Erstellt mit dem Chabis Radio 5G Scanner • RandeLab Autonomes Sonnenkraftwerk & Kokosnuss-Observatorium*
