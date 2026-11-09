#!/usr/bin/env python3
"""
RandeSolar Yesterday & Today Full-System Performance Plotter
Analyzes Sunday 8 Nov to Monday 9 Nov 2026 telemetry at RandeLab (857 m ü. M.).
"""
import os
import shutil
import urllib.request
import json
from datetime import datetime, timedelta

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np

# 1. Fetch telemetry for yesterday and today (from 2026-11-08T00:00:00Z to now)
url = 'https://pakfuetvwpffwfrrxshz.supabase.co/rest/v1/solar_telemetry?select=*&created_at=gte.2026-11-08T00:00:00Z&order=created_at.asc&limit=1000'
headers = {
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU'
}

req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))

times = []
v_bat = []
p_solar = []
yield_wh = []
t_wx = []
t_chip = []

for d in data:
    ts_str = d['created_at'][:19]
    dt_utc = datetime.strptime(ts_str, '%Y-%m-%dT%H:%M:%S')
    dt_local = dt_utc + timedelta(hours=1)  # MEZ (UTC+1)
    bv = d.get('battery_voltage')
    if bv is not None:
        times.append(dt_local)
        v_bat.append(bv)
        p_solar.append(d.get('solar_power') or 0.0)
        yield_wh.append(d.get('yield_today_wh') or 0.0)
        t_wx.append(d.get('wx_temp'))
        t_chip.append(d.get('chip_temp'))

times = np.array(times)
v_bat = np.array(v_bat)
p_solar = np.array(p_solar)
yield_wh = np.array(yield_wh)

# Matplotlib dark technical style
plt.style.use('dark_background')
fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 12), dpi=150, sharex=True, gridspec_kw={'height_ratios': [1.4, 1.0, 0.8]})
fig.patch.set_facecolor('#090d16')

for ax in (ax1, ax2, ax3):
    ax.set_facecolor('#0d1322')
    ax.grid(True, linestyle='--', color='#1e293b', alpha=0.7)
    for spine in ax.spines.values():
        spine.set_color('#334155')

# ==================== PANEL 1: Battery Bank Voltage ====================
ax1.plot(times, v_bat, color='#38bdf8', linewidth=2.0, label='Battery Bank Voltage (12V 380Ah AGM)', zorder=4)
ax1.fill_between(times, v_bat, 11.4, color='#38bdf8', alpha=0.08, zorder=2)

# Reference Threshold Lines
ax1.axhline(14.40, color='#f59e0b', linestyle=':', linewidth=1.2, alpha=0.8, label='Absorption / Bulk Limit (14.40V)')
ax1.axhline(13.80, color='#10b981', linestyle='--', linewidth=1.2, alpha=0.8, label='Float Voltage (13.80V)')
ax1.axhline(12.70, color='#06b6d4', linestyle='-', linewidth=1.0, alpha=0.7, label='100% Resting Voltage (12.70V)')
ax1.axhline(12.00, color='#eab308', linestyle='--', linewidth=1.1, alpha=0.8, label='40% SoC Warning (12.00V)')
ax1.axhline(11.80, color='#ef4444', linestyle='-', linewidth=1.5, alpha=0.9, label='Critical Cutoff / Sulfation Risk (11.80V)')

# Danger shading below 11.8V
ax1.axhspan(11.0, 11.8, color='#ef4444', alpha=0.12, zorder=1)

# Annotations of Critical Events
# 1. Acute Low 11.47V
idx_min = np.argmin(v_bat)
t_min = times[idx_min]
v_min_val = v_bat[idx_min]
ax1.scatter([t_min], [v_min_val], color='#ef4444', s=100, zorder=5, edgecolor='white')
ax1.annotate(f'Acute Low: {v_min_val:.2f}V (07:33 CET)\nUncontrolled Inverter Idle (~25W)',
             xy=(t_min, v_min_val), xytext=(t_min + timedelta(hours=1.5), 11.60),
             arrowprops=dict(facecolor='#ef4444', shrink=0.08, width=1.5, headwidth=6),
             color='#fca5a5', fontsize=9.5, fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.4', facecolor='#1e1b4b', edgecolor='#ef4444', alpha=0.9))

# 2. Charging Peak (Solar + Generator)
idx_max = np.argmax(v_bat)
t_max = times[idx_max]
v_max_val = v_bat[idx_max]
ax1.scatter([t_max], [v_max_val], color='#10b981', s=80, zorder=5, edgecolor='white')
ax1.annotate(f'Charge Peak: {v_max_val:.2f}V\nAbsorption Charging',
             xy=(t_max, v_max_val), xytext=(t_max - timedelta(hours=3.5), 14.1),
             arrowprops=dict(facecolor='#10b981', shrink=0.08, width=1.5, headwidth=6),
             color='#6ee7b7', fontsize=9, fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#064e3b', edgecolor='#10b981', alpha=0.9))

# 3. Evening Step Test (21:02)
t_step = datetime(2026, 11, 8, 21, 2, 0)
ax1.axvspan(t_step, t_step + timedelta(minutes=42), color='#a855f7', alpha=0.25, zorder=2)
ax1.annotate('Inverter Step Test\n40 min (-20 mV, Ri ~10 mΩ)',
             xy=(t_step + timedelta(minutes=20), 12.69), xytext=(t_step - timedelta(hours=4.5), 12.25),
             arrowprops=dict(facecolor='#c084fc', shrink=0.08, width=1.2, headwidth=5),
             color='#e9d5ff', fontsize=8.5, fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#3b0764', edgecolor='#a855f7', alpha=0.9))

# 4. Mod & Key Switch ON (01:15)
t_mod = datetime(2026, 11, 9, 1, 15, 0)
ax1.axvline(t_mod, color='#f97316', linestyle='--', linewidth=1.5, alpha=0.9)
ax1.annotate('Remote Key Switch ON\nInverter Idle Active (12.64V)',
             xy=(t_mod, 12.64), xytext=(t_mod - timedelta(hours=4.5), 13.1),
             arrowprops=dict(facecolor='#fb923c', shrink=0.08, width=1.2, headwidth=5),
             color='#fed7aa', fontsize=8.5, fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#431407', edgecolor='#f97316', alpha=0.9))

ax1.set_ylabel('Battery Voltage [V]', fontsize=11, fontweight='bold', color='#cbd5e1')
ax1.set_ylim(11.3, 14.6)
ax1.legend(loc='lower left', fontsize=8.5, facecolor='#090d16', edgecolor='#334155', ncol=2)
ax1.set_title('RandeSolar Power Telemetry: Sunday 8 Nov – Monday 9 Nov 2026 (RandeLab 857 m ü. M.)',
              fontsize=14, fontweight='bold', color='#f8fafc', pad=12)

# ==================== PANEL 2: Solar Generation & Yield ====================
ax2.plot(times, p_solar, color='#eab308', linewidth=1.6, label='Solar PV Power [W]', zorder=4)
ax2.fill_between(times, p_solar, 0, color='#eab308', alpha=0.15, zorder=2)
ax2.set_ylabel('Solar Power [W]', fontsize=11, fontweight='bold', color='#facc15')
ax2.set_ylim(-5, max(p_solar) * 1.15)

ax2_twin = ax2.twinx()
ax2_twin.plot(times, yield_wh, color='#34d399', linewidth=1.8, linestyle='-.', label='Daily Yield [Wh]', zorder=4)
ax2_twin.set_ylabel('Daily Yield [Wh]', fontsize=11, fontweight='bold', color='#34d399')
ax2_twin.set_ylim(-10, max(yield_wh) * 1.15)
ax2_twin.grid(False)

# Combine legends
lines2_1, labels2_1 = ax2.get_legend_handles_labels()
lines2_2, labels2_2 = ax2_twin.get_legend_handles_labels()
ax2.legend(lines2_1 + lines2_2, labels2_1 + labels2_2, loc='upper left', fontsize=8.5, facecolor='#090d16', edgecolor='#334155')

# ==================== PANEL 3: Environmental Temperatures ====================
valid_t = [t for t in t_wx if t is not None]
valid_c = [c for c in t_chip if c is not None]
if valid_t:
    ax3.plot(times, t_wx, color='#60a5fa', linewidth=1.5, label='Ambient Weather Temp [°C] (857 m ü. M.)')
if valid_c:
    ax3.plot(times, t_chip, color='#f43f5e', linewidth=1.2, linestyle=':', label='ESP32-S3 Chip Temp [°C]')

ax3.axhline(0.0, color='#94a3b8', linestyle=':', linewidth=0.8, alpha=0.6)
ax3.set_ylabel('Temperature [°C]', fontsize=11, fontweight='bold', color='#93c5fd')
ax3.legend(loc='upper left', fontsize=8.5, facecolor='#090d16', edgecolor='#334155')
ax3.set_xlabel('Local Time [MEZ / UTC+1]', fontsize=11, fontweight='bold', color='#cbd5e1')

# Formatting x-axis
ax3.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M\n%d.%m'))
ax3.xaxis.set_major_locator(mdates.HourLocator(byhour=[0, 4, 8, 12, 16, 20]))
ax3.set_xlim(times[0], times[-1] + timedelta(minutes=15))

plt.tight_layout()

# Save outputs
png_path = 'docs/reports/randesolar_yesterday_today_performance.png'
svg_path = 'docs/reports/randesolar_yesterday_today_performance.svg'
plt.savefig(png_path, dpi=180, facecolor=fig.get_facecolor(), bbox_inches='tight')
plt.savefig(svg_path, format='svg', facecolor=fig.get_facecolor(), bbox_inches='tight')
plt.close()
print(f'Successfully generated {png_path} and {svg_path}')

# Copy to artifacts directory
artifact_dir = '/home/dusjagr/.gemini/antigravity/brain/5afe7d28-dc3b-4a87-8c40-0f827c10dae2'
shutil.copy(png_path, os.path.join(artifact_dir, 'randesolar_yesterday_today_performance.png'))
print('Copied to artifacts directory!')
