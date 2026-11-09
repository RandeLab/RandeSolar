---
name: randesolar-power
description: >-
  Standard operating procedures, battery diagnostics, inverter load-step testing,
  internal resistance analysis, winter autarky budgeting, and 230V generator switching
  for the RandeSolar 12V 380 Ah battery bank (4x VOLTIC 95 Ah), RDDSPON 6000W inverter,
  and Victron MPPT 75|15 at RandeLab (857 m ü. M.).
  Use whenever analyzing battery voltages, testing inverter loads, checking deep-discharge
  events (<11.8V), assessing battery health, or operating the 1-0-2 power switch.
---

# 🔋 RandeSolar Power Architecture & Battery Health Runbook

The **RandeSolar Power System** at **RandeLab (857 m ü. M., Underes Ätzisloo 189)** consists of a **380 Ah @ 12V DC battery bank (4x VOLTIC DIN 595 parallel)**, a **Victron BlueSolar MPPT 75|15**, an **RDDSPON 6000W Pure Sine Wave Inverter**, an **emergency generator**, and a **230V manual cam switch (1 - 0 - 2)**.

---

## ⚡ Non-Negotiable Operational & Data Realism Rules

1. **Zero Standby for the 6000W Inverter in Winter**:
   * The RDDSPON 6000W inverter draws estimated **~15 to 30 Watts in no-load idle** (~1.5–2.5 A @ 12V).
   * Over 24 hours, this drains **~400 to 700 Wh/day (~35–55 Ah/day)**, which depletes the 380 Ah bank in < 2 days during cloudy/foggy weather.
   * **Rule:** The inverter must be **hard-switched off** whenever 230V AC is not actively utilized.
   * **Hardware Mod:** An external tubular key switch (`Schlüsselschalter`) has been soldered to the internal power switch logic and run upstairs to the "Amtlich OK" junction box for remote cut-off.
2. **Anti-Bias Rule: Respect Shitty Prototype Data (No Fake Precision)**:
   * **No Shunt:** Current and power draw are *unmeasured estimates* from generic datasheets, not ground truth.
   * **ESP32 ADC Noise Floor:** A 20 mV delta corresponds to ~2–3 raw ADC counts. Treat small voltage steps with caution (could be contact resistance, Wi-Fi RF burst ripple, or thermal drift).
   * **Never Infer SoC % Under Load:** Voltage readings under dynamic load or right after charging do not equal resting open-circuit state of charge (SoC).
   * **Kill the Cheerleading:** Do not synthesize smooth textbook curves or declare "optimal health" from single-point uncalibrated telemetry.
3. **50% DoD Hard Floor (Do Not Discharge Below 12.2 V Resting)**:
   * 12V Lead/AGM batteries sulfate rapidly when discharged below **11.8 V**.
   * Any dip below **11.5 V** constitutes acute cell collapse and irreversible capacity degradation.
4. **No Series PV Modules on Victron 75|15**:
   * Two Energetica 380 Wp panels in series have $V_{oc} > 84\text{ V}$ ($> 92\text{ V}$ at $-15^\circ\text{C}$), destroying the MPPT controller ($75\text{ V}$ max).
   * Panels must remain **strictly parallel (1S2P)**.

---

## 🛠️ Step-by-Step Diagnostic Test Protocols

### Protocol 1: Defined Load-Step Test (Measuring $R_i$, Current & Power)

Use this protocol to verify actual battery internal resistance and load draw without guessing:

```bash
# Run the live step-test recorder on the LAN
python3 .agents/skills/randesolar-power/scripts/run_battery_step_test.py
```

**Execution Steps:**
1. **Baseline (5 min):** Inverter OFF. Let voltage stabilize at open-circuit ($V_\text{rest}$).
2. **Step On:** Switch Inverter ON with a **known resistive load** (e.g. 60W bulb, 65W laptop charger, or pure idle).
   * Note the instantaneous Ohmic voltage drop $\Delta V_{IR}$ in the terminal.
3. **Hold (5–10 min):** Keep load steady. Observe whether voltage remains flat or continuously sags.
4. **Step Off:** Switch Inverter OFF.
   * Observe the immediate jump back and the 5–10 minute electrochemical diffusion recovery.
5. **Press Ctrl+C:** The script computes $\Delta V$, estimated $R_i$, current in Amperes, and consumed Watt-hours.

---

### Protocol 2: Multimeter Block-Symmetry Audit (Finding Dead Cells)

When a 380 Ah parallel bank shows premature collapse (like the 11.47 V drop on 8 Nov 2026):

1. Switch off all chargers and inverters.
2. Disconnect parallel bridge cables between the 4 VOLTIC blocks (or measure at individual posts under load).
3. Measure the open-circuit voltage of each block:
   * **Block 1 (95 Ah):** Target $\ge 12.65\text{ V}$
   * **Block 2 (95 Ah):** Target $\ge 12.65\text{ V}$
   * **Block 3 (95 Ah):** Target $\ge 12.65\text{ V}$
   * **Block 4 (95 Ah):** Target $\ge 12.65\text{ V}$
4. **Failure Threshold:** If one block measures **< 12.2 V** or is > 0.3 V lower than the others, it has a shorted/dead cell. It acts as an internal heater and discharges the other 3 blocks in parallel!

---

### Protocol 3: Automated Battery Health & Deep-Discharge Audit

Audits the last 24h to 7 days of Supabase telemetry for dangerous voltage drops:

```bash
# Audit last 24 hours
python3 .agents/skills/randesolar-power/scripts/check_battery_health.py 24

# Audit last 7 days (168 hours)
python3 .agents/skills/randesolar-power/scripts/check_battery_health.py 168
```

* Flags all data points $< 12.0\text{ V}$ (sulfation risk).
* Flags deep discharges $< 11.8\text{ V}$ and acute cell collapses $< 11.5\text{ V}$.
* Outputs an overall battery health grade (A+ through F).

---

## 📊 Technical Architecture Reference

* **4x VOLTIC DIN 595 (95 Ah):** 380 Ah @ 12V (4.56 kWh Gross, 2.28 kWh usable @ 50% DoD).
* **RDDSPON 6000W Inverter:** Idle draw ~22–28 W (~1.8–2.4 A DC).
* **Cam Switch (1 - 0 - 2):** 1: Inverter/Battery, 0: OFF, 2: Generator (in shed).
* **Victron 75|15 MPPT:** Max 15A charge current, 75V max input.
* **ESP32-S3:** Direct 12V-to-5V DC-DC supply (<0.5 W), 24/7 autonomous logging.

> Detailed hardware schematics and specifications: [`battery_specifications.md`](./references/battery_specifications.md)  
> Critical step-load test analysis & plots: [`docs/reports/INVERTER_STANDBY_ANALYSIS.md`](file:///home/dusjagr/Documents/PlatformIO/Projects/RandeSolar/docs/reports/INVERTER_STANDBY_ANALYSIS.md)
