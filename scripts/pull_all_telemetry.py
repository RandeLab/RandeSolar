#!/usr/bin/env python3
"""
RandeSolar Telemetry Harvester & Analyzer
Pulls all historical records from Supabase into data/solar_telemetry.csv & .json,
and analyzes maximum charging voltages, power peaks, and solar patterns.
"""
import os
import json
import urllib.request
import csv
from datetime import datetime

SUPABASE_URL = "https://pakfuetvwpffwfrrxshz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU"

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

CSV_PATH = os.path.join(OUTPUT_DIR, "solar_telemetry.csv")
JSON_PATH = os.path.join(OUTPUT_DIR, "solar_telemetry.json")

print("[1/3] 📡 Connecting to Supabase and pulling all telemetry records...")

all_rows = []
offset = 0
page_size = 1000

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}"
}

while True:
    url = f"{SUPABASE_URL}/rest/v1/solar_telemetry?select=*&order=created_at.asc&limit={page_size}&offset={offset}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            batch = json.loads(resp.read().decode('utf-8'))
            if not batch:
                break
            all_rows.extend(batch)
            print(f"      Downloaded {len(all_rows)} records so far (offset {offset})...")
            if len(batch) < page_size:
                break
            offset += page_size
    except Exception as e:
        print(f"Error fetching batch at offset {offset}: {e}")
        break

total_count = len(all_rows)
print(f"\n[2/3] 💾 Total records fetched: {total_count}")

if total_count > 0:
    # Save to JSON
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(all_rows, f, indent=2, ensure_ascii=False)
    print(f"      Saved JSON: {JSON_PATH} ({os.path.getsize(JSON_PATH) / 1024 / 1024:.2f} MB)")

    # Save to CSV
    keys = list(all_rows[0].keys())
    # Ensure all possible keys across all rows are included
    all_keys = set()
    for row in all_rows:
        all_keys.update(row.keys())
    fieldnames = sorted(list(all_keys))
    # Put created_at, solar_power, battery_voltage, battery_current first
    priority = ["id", "created_at", "solar_power", "battery_voltage", "battery_current", "yield_today_wh", "charge_state", "state_str"]
    ordered_fields = [k for k in priority if k in fieldnames] + [k for k in fieldnames if k not in priority]

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=ordered_fields)
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"      Saved CSV:  {CSV_PATH} ({os.path.getsize(CSV_PATH) / 1024 / 1024:.2f} MB)")

print("\n[3/3] 🔬 Analyzing Charging Voltage & Solar Records...")

if total_count == 0:
    print("No data found!")
    exit(0)

first_date = all_rows[0].get("created_at")
last_date = all_rows[-1].get("created_at")

# Filter valid battery voltages
valid_voltages = [r for r in all_rows if r.get("battery_voltage") is not None and r.get("battery_voltage") > 5.0]

# Active charging: solar_power > 0 or battery_current > 0.1
charging_rows = [r for r in valid_voltages if (r.get("solar_power") or 0) > 0 or (r.get("battery_current") or 0) > 0.1]

# Sort by battery voltage descending
valid_sorted_by_volt = sorted(valid_voltages, key=lambda r: r.get("battery_voltage") or 0, reverse=True)
charging_sorted_by_volt = sorted(charging_rows, key=lambda r: r.get("battery_voltage") or 0, reverse=True)

max_volt_overall = valid_sorted_by_volt[0] if valid_sorted_by_volt else None
max_volt_charging = charging_sorted_by_volt[0] if charging_sorted_by_volt else None

# Peak solar power
peak_solar_row = max(all_rows, key=lambda r: r.get("solar_power") or 0)
max_solar_w = peak_solar_row.get("solar_power") or 0

# Min voltage
min_volt_row = min(valid_voltages, key=lambda r: r.get("battery_voltage") or 99.0)

print(f"\n==================== RANDESOLAR TELEMETRY SUMMARY ====================")
print(f"📅 Observation Period:     {first_date}  -->  {last_date}")
print(f"📦 Total Data Points:       {total_count} records")
print(f"⚡ Peak Solar Power:        {max_solar_w} W  (at {peak_solar_row.get('created_at')})")
print(f"🔋 Lowest Battery Voltage:  {min_volt_row.get('battery_voltage'):.2f} V  (at {min_volt_row.get('created_at')})")
if max_volt_charging:
    print(f"⚡ HIGHEST CHARGING VOLT:   {max_volt_charging.get('battery_voltage'):.2f} V  (at {max_volt_charging.get('created_at')})")
    print(f"   ↳ Solar: {max_volt_charging.get('solar_power')} W | Current: {max_volt_charging.get('battery_current')} A | State: {max_volt_charging.get('charge_state')} ({max_volt_charging.get('state_str')})")
if max_volt_overall:
    print(f"⚡ Highest Voltage Overall: {max_volt_overall.get('battery_voltage'):.2f} V  (at {max_volt_overall.get('created_at')})")

print(f"\n--- TOP 10 HIGHEST CHARGING VOLTAGE RECORDS ---")
for idx, r in enumerate(charging_sorted_by_volt[:10], 1):
    ts = r.get("created_at")
    v = r.get("battery_voltage")
    i = r.get("battery_current")
    w = r.get("solar_power")
    st = r.get("charge_state")
    st_name = r.get("state_str") or str(st)
    t1 = r.get("temp_dallas1")
    t_str = f" | T_Stübli: {t1}°C" if t1 is not None else ""
    print(f"{idx:2d}. {v:.2f} V | Solar: {w:3d} W | {i:+5.1f} A | State: {st_name:10s} | Time: {ts}{t_str}")

print(f"======================================================================\n")
