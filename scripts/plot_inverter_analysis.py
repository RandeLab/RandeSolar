#!/usr/bin/env python3
"""
RandeSolar Inverter Standby & Step-Load Analysis Plotter
Generates high-resolution publication-grade telemetry plots for the inverter experiment
conducted on Sunday, 8 Nov 2026 at RandeLab (857 m ü. M.).
"""
import os
import urllib.request
import json
from datetime import datetime, timedelta

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np

# 1. Fetch live telemetry from Supabase
url = 'https://pakfuetvwpffwfrrxshz.supabase.co/rest/v1/solar_telemetry?select=*&created_at=gte.2026-11-08T17:00:00Z&order=created_at.asc'
headers = {
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU'
}

req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))

times, volts = [], []
for d in data:
    ts_str = d['created_at'][:19]
    dt_utc = datetime.strptime(ts_str, '%Y-%m-%dT%H:%M:%S')
    dt_local = dt_utc + timedelta(hours=1) # UTC+1 MEZ
    bv = d.get('battery_voltage')
    if bv is not None:
        times.append(dt_local)
        volts.append(bv)

times = np.array(times)
volts = np.array(volts)

# Plot styling: Technical dark theme
plt.style.use('dark_background')
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 9), gridspec_kw={'height_ratios': [1.2, 1]}, dpi=150)
fig.patch.set_facecolor('#0b0f19')
for ax in (ax1, ax2):
    ax.set_facecolor('#0f172a')
    ax.grid(True, linestyle='--', color='#1e293b', alpha=0.7)
    for spine in ax.spines.values():
        spine.set_color('#334155')

# ----------------- PANEL 1: FULL 7-HOUR TELEMETRY TRAJECTORY -----------------
ax1.plot(times, volts, color='#38bdf8', linewidth=2.0, label='Batteriespannung (V)', zorder=4)
ax1.scatter(times, volts, color='#0284c7', s=14, alpha=0.6, zorder=5)

# Shaded phases
t_on_start = datetime(2026, 11, 8, 21, 2, 58)
t_on_end   = datetime(2026, 11, 8, 21, 43, 1)
t_off_rest = datetime(2026, 11, 8, 23, 1, 18)
t_p2_start = datetime(2026, 11, 8, 23, 3, 47)
t_p2_end   = datetime(2026, 11, 8, 23, 6, 0)

# Phase 1: Inverter ON
ax1.axvspan(t_on_start, t_on_end, color='#ef4444', alpha=0.18, zorder=2, label='Test 1: Inverter AN (40 Min. Leerlauf)')
# Phase 2: Inverter OFF Rebound
ax1.axvspan(t_on_end, t_off_rest, color='#10b981', alpha=0.12, zorder=2, label='Erholung & Plateau (Inverter AUS)')
# Phase 3: Pulse 2
ax1.axvspan(t_p2_start, t_p2_end, color='#f59e0b', alpha=0.25, zorder=2, label='Test 2: Kurzer Lastpuls')

# Annotations
ax1.annotate('Inverter eingeschaltet (21:02)\nΔV = -20 mV Einbruch',
             xy=(t_on_start, 12.69), xytext=(datetime(2026, 11, 8, 19, 45), 12.66),
             arrowprops=dict(arrowstyle='->', color='#f87171', lw=1.5),
             color='#f87171', fontsize=9, fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#1e1e2e', edgecolor='#f87171', alpha=0.85))

ax1.annotate('Inverter ausgeschaltet (21:43)\n+40 mV Erholungsplateau',
             xy=(datetime(2026, 11, 8, 22, 0), 12.73), xytext=(datetime(2026, 11, 8, 22, 10), 12.78),
             arrowprops=dict(arrowstyle='->', color='#34d399', lw=1.5),
             color='#34d399', fontsize=9, fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#1e1e2e', edgecolor='#34d399', alpha=0.85))

ax1.annotate('Puls 2 (23:03)\n-50 mV Drop',
             xy=(t_p2_start, 12.68), xytext=(datetime(2026, 11, 8, 23, 15), 12.73),
             arrowprops=dict(arrowstyle='->', color='#fbbf24', lw=1.5),
             color='#fbbf24', fontsize=9, fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#1e1e2e', edgecolor='#fbbf24', alpha=0.85))

ax1.set_ylabel('Klemmenspannung (V)', fontsize=11, color='#94a3b8', fontweight='bold')
ax1.set_ylim(12.60, 12.88)
ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
ax1.xaxis.set_major_locator(mdates.HourLocator(interval=1))
ax1.legend(loc='upper right', framealpha=0.85, facecolor='#1e293b', edgecolor='#334155', fontsize=8.5)
ax1.set_title('RandeSolar: Batteriespannung & Wechselrichter-Leerlaufversuch (857 m ü. M.)', fontsize=13, fontweight='bold', color='#f8fafc', pad=12)

# ----------------- PANEL 2: ZOOM ON STEP-RESPONSE (20:45 - 22:30) -----------------
zoom_mask = (times >= datetime(2026, 11, 8, 20, 45)) & (times <= datetime(2026, 11, 8, 22, 30))
z_times = times[zoom_mask]
z_volts = volts[zoom_mask]

ax2.plot(z_times, z_volts, color='#f43f5e', linewidth=2.2, marker='o', markersize=4.5,
         markerfacecolor='#fda4af', markeredgecolor='#e11d48', label='Zoom: 2-Minuten-Abtastung (V)', zorder=4)

ax2.axvspan(t_on_start, t_on_end, color='#ef4444', alpha=0.18, zorder=2)
ax2.axvspan(t_on_end, datetime(2026, 11, 8, 22, 30), color='#10b981', alpha=0.12, zorder=2)

# Step response lines
ax2.axhline(12.71, color='#64748b', linestyle=':', alpha=0.6)
ax2.axhline(12.69, color='#f87171', linestyle='--', alpha=0.7)
ax2.axhline(12.73, color='#34d399', linestyle='--', alpha=0.7)

ax2.text(datetime(2026, 11, 8, 21, 15), 12.695, 'Leerlauf-Last: 12.69 V (stabil)', color='#fca5a5', fontsize=9, fontweight='bold')
ax2.text(datetime(2026, 11, 8, 21, 55), 12.735, 'Ruhespannung: 12.73 V (+40 mV Rebound)', color='#6ee7b7', fontsize=9, fontweight='bold')

# Estimate overlay box
calc_text = (
    "KRITISCHE LEISTUNGSABSCHÄTZUNG:\n"
    "• Ohmscher Sprung (ΔV_IR): ~20 mV\n"
    "• Ri (Kälte ~3°C, 100Ah AGM): 8–12 mΩ\n"
    "• Ruhestrom Inverter: ~1.8 – 2.4 A\n"
    "• Standby-Leistung: ~22 – 28 Watt\n"
    "• 24h Leerlauf-Verbrauch: ~550–650 Wh/Tag!\n"
    "  (Zieht die Batterie im Winter in <2 Tagen tot)"
)
ax2.text(0.02, 0.20, calc_text, transform=ax2.transAxes, fontsize=8.5,
         verticalalignment='bottom', fontfamily='monospace', color='#f8fafc',
         bbox=dict(boxstyle='round,pad=0.6', facecolor='#090d16', edgecolor='#475569', alpha=0.92))

ax2.set_xlabel('Uhrzeit (MEZ, Sonntag 8. Nov 2026)', fontsize=10, color='#94a3b8', fontweight='bold')
ax2.set_ylabel('Klemmenspannung (V)', fontsize=10, color='#94a3b8', fontweight='bold')
ax2.set_ylim(12.67, 12.76)
ax2.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
ax2.xaxis.set_major_locator(mdates.MinuteLocator(byminute=[0, 15, 30, 45]))
ax2.legend(loc='lower right', framealpha=0.85, facecolor='#1e293b', edgecolor='#334155', fontsize=8.5)

plt.tight_layout()

# Save figure
os.makedirs('docs/reports', exist_ok=True)
png_path = 'docs/reports/inverter_standby_drain_plot.png'
svg_path = 'docs/reports/inverter_standby_drain_plot.svg'
artifact_png = '/home/dusjagr/.gemini/antigravity/brain/5afe7d28-dc3b-4a87-8c40-0f827c10dae2/inverter_standby_drain_plot.png'

plt.savefig(png_path, dpi=180, facecolor=fig.get_facecolor(), edgecolor='none')
plt.savefig(svg_path, facecolor=fig.get_facecolor(), edgecolor='none')
plt.savefig(artifact_png, dpi=180, facecolor=fig.get_facecolor(), edgecolor='none')
print(f'[SUCCESS] Plots saved to {png_path}, {svg_path}, and {artifact_png}')
