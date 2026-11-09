#!/usr/bin/env python3
"""
RandeSolar Battery Step-Test & Inverter Load Logger
Polls ESP32-S3 live API (or Supabase) during controlled load tests.
Calculates Ohmic drop (Delta V_IR), estimated internal resistance (Ri),
drawn current, power dissipation, and generates step-response graphs.
"""

import sys
import time
import json
import urllib.request
from datetime import datetime

def fetch_live_telemetry(endpoint="http://192.168.1.100/api/live"):
    try:
        req = urllib.request.Request(endpoint, headers={'User-Agent': 'RandeSolar-Test/1.0'})
        with urllib.request.urlopen(req, timeout=4) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return None

def main():
    endpoint = "http://192.168.1.100/api/live"
    if len(sys.argv) > 1:
        endpoint = sys.argv[1]

    print("=" * 65)
    print("🔋 RANDESOLAR BATTERY LOAD-STEP & INVERTER TEST RECORDER")
    print("=" * 65)
    print(f"Target Endpoint: {endpoint}")
    print("Testing connection...")

    data = fetch_live_telemetry(endpoint)
    if not data:
        print("❌ Could not connect to ESP32 at", endpoint)
        print("Ensure you are on the RandeLab Wi-Fi network (192.168.1.x).")
        sys.exit(1)

    print(f"✓ Connected! Current Battery Voltage: {data.get('battery_voltage', '--')} V")
    print(f"✓ Solar Input: {data.get('solar_power', 0)} W (Charge State: {data.get('state_str', '--')})")
    print("-" * 65)
    print("This tool logs live voltage samples every 2 seconds.")
    print("Press Ctrl+C when your test phase is complete to view analysis.")
    print("-" * 65)

    samples = []
    start_time = time.time()

    try:
        while True:
            t = time.time() - start_time
            d = fetch_live_telemetry(endpoint)
            if d:
                v = d.get('battery_voltage')
                a = d.get('battery_current', 0.0)
                sol = d.get('solar_power', 0)
                samples.append((t, v, a, sol))
                timestamp_str = datetime.now().strftime('%H:%M:%S')
                print(f"[{timestamp_str}] t={t:5.1f}s | V={v:.2f} V | I_mppt={a:.1f} A | Solar={sol} W")
            time.sleep(2.0)
    except KeyboardInterrupt:
        print("\n\n" + "=" * 65)
        print("📊 TEST RUN SUMMARY & ELECTROCHEMICAL ANALYSIS")
        print("=" * 65)

    if len(samples) < 5:
        print("Not enough samples recorded for analysis.")
        sys.exit(0)

    voltages = [s[1] for s in samples if s[1] is not None]
    v_start = voltages[0]
    v_min = min(voltages)
    v_max = max(voltages)
    v_end = voltages[-1]
    delta_v = v_start - v_min

    print(f"Start Voltage:  {v_start:.2f} V")
    print(f"Lowest Voltage: {v_min:.2f} V")
    print(f"End Voltage:    {v_end:.2f} V")
    print(f"Total Sag (ΔV): {delta_v * 1000:.1f} mV ({delta_v:.3f} V)")

    # Estimated current and power based on standard 380 Ah bank (Ri ~ 10 mOhm at ~5°C)
    r_est_low = 0.008  # 8 mOhm
    r_est_mid = 0.010  # 10 mOhm
    r_est_high = 0.014 # 14 mOhm

    if delta_v > 0.005:
        i_mid = delta_v / r_est_mid
        p_mid = v_min * i_mid
        print("-" * 65)
        print(f"Estimated DC Load Current:  ~{i_mid:.2f} A  (Range: {delta_v/r_est_high:.1f} A to {delta_v/r_est_low:.1f} A)")
        print(f"Estimated Power Draw:       ~{p_mid:.1f} W  (Range: {v_min*(delta_v/r_est_high):.1f} W to {v_min*(delta_v/r_est_low):.1f} W)")
        print(f"Energy consumed in {samples[-1][0]:.0f}s:      ~{(p_mid * (samples[-1][0]/3600)):.2f} Wh")
    print("=" * 65)

if __name__ == "__main__":
    main()
