# 🔋 RandeSolar Power System & Battery Bank Specifications

## 1. Storage Bank: 4x VOLTIC DIN 595 (Parallel)
* **Configuration:** 4 identical 12V blocks in parallel (12V 4P)
* **Individual Battery:** VOLTIC DIN 595 (95 Ah @ C20, ~800 A EN cold cranking)
* **Total Nominal Capacity:** $4 \times 95\text{ Ah} = \mathbf{380\text{ Ah}}$
* **Gross Stored Energy:** $380\text{ Ah} \times 12\text{ V} = \mathbf{4.56\text{ kWh}}$
* **Recommended Working Capacity (50% DoD limit):** $\mathbf{\approx 190\text{ Ah (2.28 kWh)}}$
* **Internal Resistance ($R_i$):**
  * Brand new at 25°C: $\approx 1.5 - 2.5\text{ m}\Omega$ per block $\rightarrow$ bank $\approx 0.5 - 1.0\text{ m}\Omega$.
  * Aged / Cold at 3°C (Winter RandeLab): Bank $R_\text{eff} + R_\text{wiring} \approx \mathbf{8 - 14\text{ m}\Omega}$.

---

## 2. Inverter: RDDSPON 6000W Pure Sine Wave
* **DC Input Voltage:** 12V DC (Operating range: 10.5V – 15.5V)
* **AC Output Voltage:** 230V AC ± 5% (50 Hz Pure Sine Wave)
* **Continuous Rating:** ~2500–3000 W (Peak surge: 6000 W)
* **No-Load Idle Current (Measured):** **~1.8 A – 2.4 A** ($\approx \mathbf{22 - 28\text{ W}}$)
* **24-Hour No-Load Energy Drain:** $\mathbf{\approx 550 - 650\text{ Wh/day}}$ (~45–50 Ah/day)
* **Remote Switch:** Direct front switch + DC terminal power breaker.

---

## 3. Solar Charge Controller: Victron BlueSolar MPPT 75 | 15
* **Max. PV Open Circuit Voltage ($V_{oc}$):** **75 V** (CRITICAL: Never exceed!)
* **Max. Battery Charge Current:** **15 A** (~216 W @ 14.4 V)
* **Telemetry Link:** VE.Direct Bluetooth Smart Dongle (AES-128-CTR Instant Beacon `0x02E1`)
* **3-Stage Charge Profile:**
  * **Bulk:** Up to 15 A max current until 14.40 V.
  * **Absorption:** Constant 14.40 V until saturation current falls.
  * **Float:** Constant 13.80 V maintenance.

---

## 4. 230V Power Switching (Nockenumschalter 1 - 0 - 2)
* **Position 1:** Inverter (Battery-powered 230V for light workshop / silent operation)
* **Position 0:** OFF (All-pole complete isolation)
* **Position 2:** Emergency Generator (Gasoline/Diesel in shed for heavy power tools and bad-weather charging)

---

## 5. 12V DC Low-Voltage Sektor (24/7 Autarkic ESP32-S3)
* **Supply:** Direct 12V battery connection via 12V-to-5V DC-DC converter.
* **Power:** < 0.5 W (100 mA @ 5V).
* **Buffer:** 35,000 LittleFS flash records (48 days full offline buffering when 230V router network is off).
