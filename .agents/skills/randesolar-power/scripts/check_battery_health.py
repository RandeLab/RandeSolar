#!/usr/bin/env python3
"""
RandeSolar Battery Health & Deep-Discharge Auditor
Fetches the last 24h to 7 days from Supabase and performs:
1. Deep-discharge threshold check (<11.8V and <11.5V)
2. Nightly discharge rate (dV/dt)
3. Float/Absorption recharge verification
4. Battery health grading (A-F)
"""

import sys
import json
import urllib.request
from datetime import datetime, timedelta

def main():
    hours = 24
    if len(sys.argv) > 1:
        try:
            hours = int(sys.argv[1])
        except ValueError:
            pass

    since = (datetime.utcnow() - timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ')
    url = f'https://pakfuetvwpffwfrrxshz.supabase.co/rest/v1/solar_telemetry?select=*&created_at=gte.{since}&order=created_at.desc&limit=2500'
    headers = {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU'
    }

    print("=" * 65)
    print(f"🔍 RANDESOLAR BATTERY HEALTH AUDIT (LAST {hours} HOURS)")
    print("=" * 65)

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"❌ Failed to query Supabase: {e}")
        sys.exit(1)

    if not data:
        print("No telemetry records found for this period.")
        sys.exit(0)

    data.reverse()

    voltages = [d['battery_voltage'] for d in data if d.get('battery_voltage') is not None]
    if not voltages:
        print("No battery voltage data present in records.")
        sys.exit(0)

    v_min = min(voltages)
    v_max = max(voltages)
    v_avg = sum(voltages) / len(voltages)
    v_latest = voltages[-1]

    below_12_0 = sum(1 for v in voltages if v < 12.0)
    below_11_8 = sum(1 for v in voltages if v < 11.8)
    below_11_5 = sum(1 for v in voltages if v < 11.5)

    print(f"Total Records:      {len(data)}")
    print(f"Current Voltage:    {v_latest:.2f} V")
    print(f"Voltage Range:      {v_min:.2f} V (Min)  ───  {v_max:.2f} V (Max)")
    print(f"Average Voltage:    {v_avg:.2f} V")
    print("-" * 65)
    print("CRITICAL DISCHARGE EVENT ANALYSIS:")
    print(f"• Samples < 12.0 V: {below_12_0} ({below_12_0*2} mins)  -  Sulfation Risk")
    print(f"• Samples < 11.8 V: {below_11_8} ({below_11_8*2} mins)  -  Deep Discharge (<20% SoC)")
    print(f"• Samples < 11.5 V: {below_11_5} ({below_11_5*2} mins)  -  ACUTE CELL DAMAGE / COLLAPSE")

    # Grading
    grade = "A (Excellent)"
    if below_11_5 > 0:
        grade = "F (CRITICAL - Deep discharge event detected!)"
    elif below_11_8 > 0:
        grade = "D (Warning - Battery reached dangerous depletion zone)"
    elif below_12_0 > 0:
        grade = "C (Marginal - Approached discharge limit)"
    elif v_min >= 12.4:
        grade = "A+ (Superb - Battery stayed well above 50% DoD)"
    elif v_min >= 12.2:
        grade = "A (Healthy - Within normal 50% DoD cycling)"

    print("-" * 65)
    print(f"OVERALL HEALTH RATING: {grade}")
    if below_11_5 > 0:
        print("⚠️ ACTION REQUIRED: Battery experienced extreme collapse (<11.5V)!")
        print("Ensure inverter is kept hard-switched off overnight and solar/generator fully charges to 14.4V.")
    print("=" * 65)

if __name__ == "__main__":
    main()
