#!/usr/bin/env python3
"""
RandeSolar Night 1 vs Night 2 Inverter Drain Comparison Plotter
Compares Sunday morning unmonitored drain vs Monday morning key-switch monitored drain.
Can be run dynamically tomorrow morning to include the completed Night 2 profile!
"""
import os
import shutil
import urllib.request
import json
from datetime import datetime, timedelta

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

# 1. Fetch Supabase Telemetry
headers = {
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU'
}

# Night 1: Sunday 8 Nov 00:00 UTC (01:00 MEZ) to 07:30 UTC (08:30 MEZ)
url1 = 'https://pakfuetvwpffwfrrxshz.supabase.co/rest/v1/solar_telemetry?select=created_at,battery_voltage&created_at=gte.2026-11-08T00:00:00Z&created_at=lte.2026-11-08T07:30:00Z&order=created_at.asc'
req1 = urllib.request.Request(url1, headers=headers)
with urllib.request.urlopen(req1) as resp:
    data1 = json.loads(resp.read().decode())

# Night 2: Monday 9 Nov 00:00 UTC (01:00 MEZ) to now (or 07:30 UTC tomorrow)
url2 = 'https://pakfuetvwpffwfrrxshz.supabase.co/rest/v1/solar_telemetry?select=created_at,battery_voltage&created_at=gte.2026-11-09T00:00:00Z&created_at=lte.2026-11-09T08:00:00Z&order=created_at.asc'
req2 = urllib.request.Request(url2, headers=headers)
with urllib.request.urlopen(req2) as resp:
    data2 = json.loads(resp.read().decode())

def parse_night(records, t0_dt):
    hours, volts = [], []
    for r in records:
        if r.get('battery_voltage') is not None:
            ts = datetime.strptime(r['created_at'][:19], '%Y-%m-%dT%H:%M:%S')
            h = (ts - t0_dt).total_seconds() / 3600.0
            hours.append(h)
            volts.append(r['battery_voltage'])
    return np.array(hours), np.array(volts)

t0_night1 = datetime(2026, 11, 8, 0, 0, 0)
t0_night2 = datetime(2026, 11, 9, 0, 0, 0)

h1, v1 = parse_night(data1, t0_night1)
h2, v2 = parse_night(data2, t0_night2)

# Styling
plt.style.use('dark_background')
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 10), dpi=150, gridspec_kw={'height_ratios': [1.3, 0.9]})
fig.patch.set_facecolor('#090d16')

for ax in (ax1, ax2):
    ax.set_facecolor('#0d1322')
    ax.grid(True, linestyle='--', color='#1e293b', alpha=0.7)
    for spine in ax.spines.values():
        spine.set_color('#334155')

# ==================== PANEL 1: Voltage Trajectory Overlay ====================
# Reference bands
ax1.axhspan(11.0, 11.8, color='#ef4444', alpha=0.12, label='Sulfation Danger Zone (<11.80V)')
ax1.axhline(12.70, color='#06b6d4', linestyle=':', linewidth=1.0, alpha=0.6, label='100% Resting (12.70V)')
ax1.axhline(12.00, color='#eab308', linestyle='--', linewidth=1.1, alpha=0.7, label='40% SoC Warning (12.00V)')
ax1.axhline(11.80, color='#ef4444', linestyle='-', linewidth=1.3, alpha=0.8, label='Critical Limit (11.80V)')

# Night 1: Sunday
ax1.plot(h1, v1, color='#f43f5e', linewidth=2.4, label='Night 1: Sunday 8 Nov (Started Undercharged @ 12.26V)', zorder=4)

# Night 2: Monday (Current data)
if len(h2) > 0:
    ax1.plot(h2, v2, color='#38bdf8', linewidth=2.8, label=f'Night 2: Monday 9 Nov (Started Healthy @ {v2[0]:.2f}V)', zorder=5)
    last_h = h2[-1]
    last_v = v2[-1]
    ax1.scatter([last_h], [last_v], color='#38bdf8', s=100, zorder=6, edgecolor='white')

    # Model projections for remainder of Night 2:
    # Model A: Inverter stays ON (25W idle drain, ~0.022 V/h drop on 380Ah bank)
    proj_h = np.linspace(last_h, 7.0, 50)
    proj_v_on = last_v - 0.022 * (proj_h - last_h)
    ax1.plot(proj_h, proj_v_on, color='#38bdf8', linestyle='--', linewidth=2.0, alpha=0.8,
             label=f'Projection if Left ON: ~{proj_v_on[-1]:.2f}V at 08:00 CET (-175 Wh)')

    # Model B: Inverter switched OFF via Key Switch (+20mV IR rebound, then resting ~0.002 V/h drop)
    proj_v_off = (last_v + 0.020) - 0.002 * (proj_h - last_h)
    ax1.plot(proj_h, proj_v_off, color='#10b981', linestyle=':', linewidth=2.2, alpha=0.85,
             label=f'Projection if Switched OFF: ~{proj_v_off[-1]:.2f}V at 08:00 CET (Autarky preserved)')

    # Annotate Night 1 collapse
    idx_min1 = np.argmin(v1)
    ax1.scatter([h1[idx_min1]], [v1[idx_min1]], color='#ef4444', s=90, zorder=6, edgecolor='white')
    ax1.annotate(f'Night 1 Low: {v1[idx_min1]:.2f}V\nCell Voltage Collapse!',
                 xy=(h1[idx_min1], v1[idx_min1]), xytext=(h1[idx_min1] - 2.8, 11.55),
                 arrowprops=dict(facecolor='#ef4444', shrink=0.08, width=1.5, headwidth=6),
                 color='#fca5a5', fontsize=9, fontweight='bold',
                 bbox=dict(boxstyle='round,pad=0.3', facecolor='#1e1b4b', edgecolor='#ef4444'))

ax1.set_ylabel('Battery Voltage [V]', fontsize=11, fontweight='bold', color='#cbd5e1')
ax1.set_ylim(11.35, 12.85)
ax1.set_xlim(0, 7.5)
ax1.legend(loc='lower left', fontsize=8.5, facecolor='#090d16', edgecolor='#334155', ncol=2)
ax1.set_title('Inverter Standby Drain Comparison: Night 1 (Unmonitored) vs Night 2 (Key-Switch Test)',
              fontsize=13, fontweight='bold', color='#f8fafc', pad=12)

# ==================== PANEL 2: Cumulative Energy Drain & Discharge Rate ====================
# Calculate cumulative energy (Wh) based on 25W idle draw
t_axis = np.linspace(0, 7.0, 100)
wh_drain = 25.0 * t_axis # 25 W continuous idle
ah_drain = (25.0 / 12.6) * t_axis

ax2.plot(t_axis, wh_drain, color='#fb923c', linewidth=2.0, label='Inverter Standby Energy Loss [Wh] (@ 25W Idle)', zorder=4)
ax2.fill_between(t_axis, wh_drain, 0, color='#fb923c', alpha=0.15, zorder=2)
ax2.set_ylabel('Cumulative Loss [Wh]', fontsize=11, fontweight='bold', color='#fb923c')
ax2.set_ylim(0, 220)

ax2_twin = ax2.twinx()
ax2_twin.plot(t_axis, ah_drain, color='#c084fc', linewidth=1.8, linestyle='--', label='Amp-Hours Drained [Ah]', zorder=4)
ax2_twin.set_ylabel('Loss [Ah] @ 12.6V', fontsize=11, fontweight='bold', color='#c084fc')
ax2_twin.set_ylim(0, 220 / 12.6)
ax2_twin.grid(False)

lines2_1, labels2_1 = ax2.get_legend_handles_labels()
lines2_2, labels2_2 = ax2_twin.get_legend_handles_labels()
ax2.legend(lines2_1 + lines2_2, labels2_1 + labels2_2, loc='upper left', fontsize=8.5, facecolor='#090d16', edgecolor='#334155')

ax2.set_xlabel('Elapsed Night Hours [h since 01:00 CET]', fontsize=11, fontweight='bold', color='#cbd5e1')
ax2.set_xlim(0, 7.5)

# Add custom clock labels along bottom
clock_labels = ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00']
ax2.set_xticks(range(8))
ax2.set_xticklabels(clock_labels)
ax1.set_xticks(range(8))
ax1.set_xticklabels(clock_labels)

plt.tight_layout()

# Save outputs
png_path = 'docs/reports/inverter_night_comparison.png'
svg_path = 'docs/reports/inverter_night_comparison.svg'
plt.savefig(png_path, dpi=180, facecolor=fig.get_facecolor(), bbox_inches='tight')
plt.savefig(svg_path, format='svg', facecolor=fig.get_facecolor(), bbox_inches='tight')
plt.close()
print(f'Successfully generated {png_path} and {svg_path}')

# Copy to artifacts directory
artifact_dir = '/home/dusjagr/.gemini/antigravity/brain/5afe7d28-dc3b-4a87-8c40-0f827c10dae2'
shutil.copy(png_path, os.path.join(artifact_dir, 'inverter_night_comparison.png'))
print('Copied to artifacts directory!')
