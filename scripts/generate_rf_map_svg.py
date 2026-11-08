import base64, math, os

# 1. Read base64 OSM background
with open('docs/maps/osm_randen_bg.png', 'rb') as f:
    b64_bg = base64.b64encode(f.read()).decode('utf-8')

# Canvas Dimensions
CANVAS_W = 1440
CANVAS_H = 1080
MAP_X = 16
MAP_Y = 16
MAP_W = 1024
MAP_H = 1024

SIDEBAR_X = 1056
SIDEBAR_Y = 16
SIDEBAR_W = 368
SIDEBAR_H = 1024

# Mapping Function
zoom = 13
x_min, y_min = 4289, 2853

def latlon2pixel(lat, lon):
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    gx = (lon + 180.0) / 360.0 * n
    gy = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    px = MAP_X + (gx - x_min) * 256
    py = MAP_Y + (gy - y_min) * 256
    return px, py

rl_x, rl_y = latlon2pixel(47.7701, 8.5738)

# 1 km in pixels is ~ 78 px
PX_PER_KM = 77.8

svg = []
svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {CANVAS_W} {CANVAS_H}" width="100%" height="100%" style="background:#0b0f19; font-family:system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">')

# Definitions &amp; Filters
svg.append('''
  <defs>
    <!-- Glow Filters -->
    <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <filter id="glow-pink" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <filter id="glow-gold" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.6"/>
    </filter>
    <linearGradient id="beam-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="beam-pink" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ec4899" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ec4899" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="beam-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="beam-green" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#10b981" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="beam-de" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.9"/>
      <stop offset="50%" stop-color="#f59e0b" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.2"/>
    </linearGradient>
    <pattern id="grid-dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="#334155" opacity="0.3"/>
    </pattern>
  </defs>
''')

# Clip Path for Map
svg.append(f'''
  <clipPath id="map-clip">
    <rect x="{MAP_X}" y="{MAP_Y}" width="{MAP_W}" height="{MAP_H}" rx="12"/>
  </clipPath>
''')

# Map Group with Clip
svg.append(f'<g clip-path="url(#map-clip)">')

# 1. Stitched OSM Background
svg.append(f'  <image href="data:image/png;base64,{b64_bg}" x="{MAP_X}" y="{MAP_Y}" width="{MAP_W}" height="{MAP_H}"/>')

# 2. Subtle Darkening/Styling Overlay so vector elements pop cleanly
svg.append(f'  <rect x="{MAP_X}" y="{MAP_Y}" width="{MAP_W}" height="{MAP_H}" fill="#0f172a" fill-opacity="0.32"/>')

# 3. Distance Circles from RandeLab (1km, 2km, 3km, 5km)
for km in [1, 2, 3, 5]:
    r = km * PX_PER_KM
    svg.append(f'  <circle cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="{r:.1f}" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.45"/>')
    svg.append(f'  <text x="{rl_x + r + 4:.1f}" y="{rl_y - 4:.1f}" fill="#38bdf8" font-size="10" font-weight="bold" opacity="0.8">{km} km</text>')

# 4. Swiss / German Border Line Accent
# Approximate border coordinates from west to east
border_pts = [
    (47.8130, 8.4900), (47.8080, 8.5200), (47.8050, 8.5450),
    (47.8020, 8.5700), (47.7980, 8.5850), (47.7940, 8.6050),
    (47.7900, 8.6300), (47.7850, 8.6500)
]
b_path_d = []
for i, (b_lat, b_lon) in enumerate(border_pts):
    bx, by = latlon2pixel(b_lat, b_lon)
    b_path_d.append(f'{"M" if i==0 else "L"} {bx:.1f} {by:.1f}')
b_path_str = " ".join(b_path_d)

svg.append(f'  <!-- Swiss-German Border Line -->')
svg.append(f'  <path d="{b_path_str}" fill="none" stroke="#ef4444" stroke-width="3.5" stroke-dasharray="8 6" opacity="0.85"/>')
svg.append(f'  <path d="{b_path_str}" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="2 12" opacity="0.9"/>')
svg.append(f'  <rect x="520" y="380" width="220" height="22" rx="4" fill="#0f172a" fill-opacity="0.8" stroke="#ef4444" stroke-width="1"/>')
svg.append(f'  <text x="630" y="395" text-anchor="middle" fill="#f87171" font-size="11" font-weight="bold" letter-spacing="1">🇨🇭 SCHWEIZ  |  DEUTSCHLAND 🇩🇪</text>')

# 5. Radio Beams from RandeLab to Towers
masts = [
    {
        'id': 'merishausen',
        'name': 'Mast Merishausen Südhang',
        'sub': 'Salt / GoMo • LTE B3 + 5G N1',
        'lat': 47.7585, 'lon': 8.5910,
        'badge': '🏆 44.8 Mbit/s | RSRP -93 dBm | SINR 11 dB',
        'stroke': '#06b6d4', 'beam': 'url(#beam-cyan)',
        'flag': '🇨🇭', 'rat': '5G-NSA High-Speed',
        'dist': '1.82 km • 135°'
    },
    {
        'id': 'bargen',
        'name': 'Mast Bargen (A4-Korridor)',
        'sub': 'Salt / GoMo • LTE Band 20 (800 MHz)',
        'lat': 47.7890, 'lon': 8.6045,
        'badge': '🌲 Reichweiten-König: 14.3 / 54.8 Mbit/s • -88 dBm',
        'stroke': '#ec4899', 'beam': 'url(#beam-pink)',
        'flag': '🇨🇭', 'rat': '4G LTE Wald-Durchdringung',
        'dist': '3.11 km • 48°'
    },
    {
        'id': 'randen_b8',
        'name': 'Lokale Zelle Randen',
        'sub': 'Salt / GoMo • LTE Band 8 (900 MHz)',
        'lat': 47.7640, 'lon': 8.5790,
        'badge': '🔋 Ruhe-Anker: -81 dBm (10 MHz) • 9.7 / 14.9 Mbit/s',
        'stroke': '#10b981', 'beam': 'url(#beam-green)',
        'flag': '🇨🇭', 'rat': '4G LTE Grundversorgung',
        'dist': '0.78 km • 150°'
    },
    {
        'id': 'hagenturm',
        'name': 'Hagenturm / Randenturm (912 m)',
        'sub': 'Swisscom (228 01) &amp; Sunrise (228 02)',
        'lat': 47.7785, 'lon': 8.5290,
        'badge': '🏔️ Höchster Punkt SH • 4G LTE &amp; 5G NR Sichtlinie',
        'stroke': '#f59e0b', 'beam': 'url(#beam-gold)',
        'flag': '🇨🇭', 'rat': 'Swisscom / Sunrise 5G',
        'dist': '3.48 km • 286°'
    },
    {
        'id': 'wiechs',
        'name': 'Wiechs am Randen (Baden-Württ.)',
        'sub': 'Telekom.de (262 01) &amp; Vodafone (262 02)',
        'lat': 47.8050, 'lon': 8.5860,
        'badge': '🇩🇪 DE Grenz-Overspill: 5G NR Empfang am Randen!',
        'stroke': '#ef4444', 'beam': 'url(#beam-de)',
        'flag': '🇩🇪', 'rat': 'Telekom / Vodafone 5G',
        'dist': '3.99 km • 13°'
    },
    {
        'id': 'tengen',
        'name': 'Tengen / Kommingen (Hegau)',
        'sub': '1+1 (262 23) &amp; O2-de (262 03)',
        'lat': 47.8180, 'lon': 8.5520,
        'badge': '🇩🇪 Neues 1+1 5G Kernnetz &amp; O2 LTE direkt empfangen',
        'stroke': '#8b5cf6', 'beam': 'url(#beam-de)',
        'flag': '🇩🇪', 'rat': '1+1 / O2 5G',
        'dist': '5.57 km • 343°'
    }
]

# Draw Beams
for m in masts:
    mx, my = latlon2pixel(m['lat'], m['lon'])
    svg.append(f'  <line x1="{rl_x:.1f}" y1="{rl_y:.1f}" x2="{mx:.1f}" y2="{my:.1f}" stroke="{m["stroke"]}" stroke-width="2.5" stroke-dasharray="6 3" stroke-opacity="0.85"/>')

# Draw Mast Markers &amp; Badges
for m in masts:
    mx, my = latlon2pixel(m['lat'], m['lon'])
    col = m['stroke']
    
    # Pulsing halo
    svg.append(f'  <circle cx="{mx:.1f}" cy="{my:.1f}" r="14" fill="{col}" fill-opacity="0.25" stroke="{col}" stroke-width="1.5"/>')
    svg.append(f'  <circle cx="{mx:.1f}" cy="{my:.1f}" r="6" fill="{col}" stroke="#ffffff" stroke-width="1.5"/>')

    # Card positioning (smart offsets based on direction from RandeLab)
    dx = mx - rl_x
    dy = my - rl_y
    card_w = 230
    card_h = 58
    
    # Offset positioning
    if dx >= 0 and dy >= 0: # SE
        cx = mx + 16
        cy = my - 10
    elif dx >= 0 and dy < 0: # NE
        cx = mx + 16
        cy = my - 30
    elif dx < 0 and dy >= 0: # SW
        cx = mx - card_w - 16
        cy = my - 10
    else: # NW
        cx = mx - card_w - 16
        cy = my - 25

    # Boundary protection
    cx = max(MAP_X + 10, min(MAP_X + MAP_W - card_w - 10, cx))
    cy = max(MAP_Y + 10, min(MAP_Y + MAP_H - card_h - 10, cy))

    svg.append(f'  <!-- Card for {m["id"]} -->')
    svg.append(f'  <g filter="url(#card-shadow)">')
    svg.append(f'    <rect x="{cx:.1f}" y="{cy:.1f}" width="{card_w}" height="{card_h}" rx="6" fill="#0f172a" fill-opacity="0.92" stroke="{col}" stroke-width="1.5"/>')
    svg.append(f'    <text x="{cx + 10:.1f}" y="{cy + 17:.1f}" fill="#ffffff" font-size="11.5" font-weight="bold">{m["flag"]} {m["name"]}</text>')
    svg.append(f'    <text x="{cx + 10:.1f}" y="{cy + 33:.1f}" fill="{col}" font-size="9.5" font-weight="600">{m["sub"]}</text>')
    svg.append(f'    <text x="{cx + 10:.1f}" y="{cy + 48:.1f}" fill="#94a3b8" font-size="8.8">{m["dist"]} • {m["badge"]}</text>')
    svg.append(f'  </g>')

# 6. RandeLab Central Hub (📍 857 m)
svg.append(f'  <!-- RandeLab Central Station -->')
svg.append(f'  <circle cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="32" fill="#06b6d4" fill-opacity="0.2" stroke="#06b6d4" stroke-width="2" stroke-dasharray="3 3"/>')
svg.append(f'  <circle cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="18" fill="#ec4899" fill-opacity="0.35" stroke="#ec4899" stroke-width="2"/>')
svg.append(f'  <circle cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="7" fill="#fbbf24" stroke="#ffffff" stroke-width="2"/>')

# RandeLab Badge
rl_cw, rl_ch = 270, 72
rl_cx = rl_x - rl_cw / 2
rl_cy = rl_y + 24
svg.append(f'  <g filter="url(#card-shadow)">')
svg.append(f'    <rect x="{rl_cx:.1f}" y="{rl_cy:.1f}" width="{rl_cw}" height="{rl_ch}" rx="8" fill="#0f172a" fill-opacity="0.95" stroke="#38bdf8" stroke-width="2"/>')
svg.append(f'    <text x="{rl_cx + 12:.1f}" y="{rl_cy + 20:.1f}" fill="#38bdf8" font-size="13" font-weight="bold">📍 RANDELAB OBSERVATORIUM</text>')
svg.append(f'    <text x="{rl_cx + 12:.1f}" y="{rl_cy + 37:.1f}" fill="#facc15" font-size="10.5" font-weight="bold">Höhe: 857 m ü. M. • Underes Ätzisloo 189</text>')
svg.append(f'    <text x="{rl_cx + 12:.1f}" y="{rl_cy + 52:.1f}" fill="#e2e8f0" font-size="9.5">📡 Teltonika TRB500 (Snapdragon X55)</text>')
svg.append(f'    <text x="{rl_cx + 12:.1f}" y="{rl_cy + 65:.1f}" fill="#94a3b8" font-size="9">⚡ ESP32-S3 (24/7 Direkt an 12V Batterie)</text>')
svg.append(f'  </g>')

# 7. Compass Rose in Top-Right of Map
cmp_x = MAP_X + MAP_W - 55
cmp_y = MAP_Y + 55
svg.append(f'  <!-- Compass Rose -->')
svg.append(f'  <g transform="translate({cmp_x}, {cmp_y})">')
svg.append(f'    <circle cx="0" cy="0" r="28" fill="#0f172a" fill-opacity="0.85" stroke="#475569" stroke-width="1.5"/>')
svg.append(f'    <polygon points="0,-22 6,-4 0,0" fill="#ef4444"/>')
svg.append(f'    <polygon points="0,-22 -6,-4 0,0" fill="#dc2626"/>')
svg.append(f'    <polygon points="0,22 6,4 0,0" fill="#94a3b8"/>')
svg.append(f'    <polygon points="0,22 -6,4 0,0" fill="#64748b"/>')
svg.append(f'    <polygon points="-22,0 -4,-6 0,0" fill="#64748b"/>')
svg.append(f'    <polygon points="22,0 4,-6 0,0" fill="#94a3b8"/>')
svg.append(f'    <text x="0" y="-25" text-anchor="middle" fill="#ef4444" font-size="11" font-weight="bold">N</text>')
svg.append(f'    <text x="0" y="33" text-anchor="middle" fill="#94a3b8" font-size="9">S</text>')
svg.append(f'    <text x="32" y="3" text-anchor="middle" fill="#94a3b8" font-size="9">O</text>')
svg.append(f'    <text x="-32" y="3" text-anchor="middle" fill="#94a3b8" font-size="9">W</text>')
svg.append(f'  </g>')

# 8. Scale Bar Bottom-Left of Map
sc_x = MAP_X + 24
sc_y = MAP_Y + MAP_H - 30
km2_px = 2 * PX_PER_KM
svg.append(f'  <!-- Scale Bar -->')
svg.append(f'  <g transform="translate({sc_x}, {sc_y})">')
svg.append(f'    <rect x="-8" y="-18" width="{km2_px + 24}" height="32" rx="4" fill="#0f172a" fill-opacity="0.85" stroke="#334155"/>')
svg.append(f'    <line x1="0" y1="0" x2="{km2_px}" y2="0" stroke="#ffffff" stroke-width="3"/>')
svg.append(f'    <line x1="0" y1="-5" x2="0" y2="5" stroke="#ffffff" stroke-width="2"/>')
svg.append(f'    <line x1="{km2_px/2}" y1="-4" x2="{km2_px/2}" y2="4" stroke="#ffffff" stroke-width="1.5"/>')
svg.append(f'    <line x1="{km2_px}" y1="-5" x2="{km2_px}" y2="5" stroke="#ffffff" stroke-width="2"/>')
svg.append(f'    <text x="0" y="-8" fill="#ffffff" font-size="9" text-anchor="middle">0</text>')
svg.append(f'    <text x="{km2_px/2}" y="-8" fill="#ffffff" font-size="9" text-anchor="middle">1 km</text>')
svg.append(f'    <text x="{km2_px}" y="-8" fill="#ffffff" font-size="9" text-anchor="middle">2 km</text>')
svg.append(f'    <text x="{km2_px/2}" y="10" fill="#94a3b8" font-size="8" text-anchor="middle">OpenStreetMap Cartography</text>')
svg.append(f'  </g>')

svg.append('</g>') # End of Map Clip Group

# Map Outer Border
svg.append(f'<rect x="{MAP_X}" y="{MAP_Y}" width="{MAP_W}" height="{MAP_H}" rx="12" fill="none" stroke="#334155" stroke-width="2"/>')

# =========================================================================
# RIGHT SIDEBAR: Comprehensive Telemetry &amp; RF Engineering Panel
# =========================================================================
svg.append(f'<g transform="translate({SIDEBAR_X}, {SIDEBAR_Y})">')

# Background Container
svg.append(f'  <rect x="0" y="0" width="{SIDEBAR_W}" height="{SIDEBAR_H}" rx="12" fill="#111827" stroke="#1e293b" stroke-width="1.5"/>')

# Header
svg.append('''
  <g transform="translate(18, 28)">
    <text x="0" y="0" fill="#38bdf8" font-size="17" font-weight="bold" letter-spacing="0.5">HF-RADAR &amp; GRENZNETZ</text>
    <text x="0" y="18" fill="#94a3b8" font-size="11">Observatorium Randen (857 m ü. M.)</text>
    <line x1="0" y1="28" x2="332" y2="28" stroke="#334155" stroke-width="1" stroke-dasharray="4 4"/>
  </g>
''')

# Card 1: 3GPP Border Scan Summary
svg.append('''
  <g transform="translate(18, 76)">
    <rect x="0" y="0" width="332" height="185" rx="8" fill="#1e293b" fill-opacity="0.65" stroke="#334155" stroke-width="1"/>
    <text x="12" y="20" fill="#facc15" font-size="12" font-weight="bold">📡 3GPP-Grenzscan (MCC 228 &amp; 262)</text>
    <text x="12" y="36" fill="#94a3b8" font-size="9.5">Empfangene Mobilfunknetze über den Randen-Kamm:</text>
    
    <text x="12" y="58" fill="#ffffff" font-size="10.5" font-weight="bold">🇨🇭 Schweiz (MCC 228):</text>
    <text x="24" y="74" fill="#38bdf8" font-size="10">• Salt / GoMo (228 03): <tspan fill="#e2e8f0">4G LTE &amp; 3G (Home)</tspan></text>
    <text x="24" y="90" fill="#38bdf8" font-size="10">• Swisscom (228 01): <tspan fill="#e2e8f0">4G LTE &amp; 5G NR</tspan></text>
    <text x="24" y="106" fill="#38bdf8" font-size="10">• Sunrise (228 02): <tspan fill="#e2e8f0">4G LTE &amp; 5G NR</tspan></text>

    <text x="12" y="128" fill="#ffffff" font-size="10.5" font-weight="bold">🇩🇪 Deutschland (MCC 262 - Hegau / BW):</text>
    <text x="24" y="144" fill="#f87171" font-size="10">• Telekom.de (262 01): <tspan fill="#e2e8f0">5G NR Broadcast</tspan></text>
    <text x="24" y="160" fill="#f87171" font-size="10">• vodafone.de (262 02): <tspan fill="#e2e8f0">5G NR Broadcast</tspan></text>
    <text x="24" y="176" fill="#f87171" font-size="10">• 1+1 (262 23) &amp; o2 (262 03): <tspan fill="#e2e8f0">5G &amp; 4G LTE</tspan></text>
  </g>
''')

# Card 2: Physical RF Frequency Benchmark
svg.append('''
  <g transform="translate(18, 276)">
    <rect x="0" y="0" width="332" height="215" rx="8" fill="#1e293b" fill-opacity="0.65" stroke="#334155" stroke-width="1"/>
    <text x="12" y="20" fill="#38bdf8" font-size="12" font-weight="bold">🏆 Masten-Olympiade &amp; Frequenzen</text>
    
    <!-- Table Row 1: B3 + N1 -->
    <rect x="10" y="32" width="312" height="42" rx="4" fill="#0f172a" stroke="#06b6d4" stroke-width="1"/>
    <text x="18" y="48" fill="#06b6d4" font-size="11" font-weight="bold">Auto: Band 3 (1.8G) + 5G N1 (2.1G)</text>
    <text x="18" y="64" fill="#e2e8f0" font-size="9.5">⬇️ 44.78 Mbit/s | ⬆️ 83.16 Mbit/s | SINR 11 dB</text>

    <!-- Table Row 2: Band 20 -->
    <rect x="10" y="80" width="312" height="42" rx="4" fill="#0f172a" stroke="#ec4899" stroke-width="1"/>
    <text x="18" y="96" fill="#ec4899" font-size="11" font-weight="bold">Band 20 (800 MHz) - Bargen A4</text>
    <text x="18" y="112" fill="#e2e8f0" font-size="9.5">⬇️ 14.33 Mbit/s | ⬆️ 54.84 Mbit/s | -88 dBm (Wald-Sieger)</text>

    <!-- Table Row 3: Band 8 -->
    <rect x="10" y="128" width="312" height="42" rx="4" fill="#0f172a" stroke="#10b981" stroke-width="1"/>
    <text x="18" y="144" fill="#10b981" font-size="11" font-weight="bold">Band 8 (900 MHz) - Randen Lokal</text>
    <text x="18" y="160" fill="#e2e8f0" font-size="9.5">⬇️ 9.65 Mbit/s | ⬆️ 14.92 Mbit/s | RSRP -81 dBm (Idle)</text>

    <!-- Table Row 4: Band 78 -->
    <rect x="10" y="176" width="312" height="32" rx="4" fill="#0f172a" stroke="#f59e0b" stroke-dasharray="3 2"/>
    <text x="18" y="196" fill="#f59e0b" font-size="9.5">🚀 5G N78 (3.5 GHz) schaltet dynamisch bei Volllast zu!</text>
  </g>
''')

# Card 3: External Antenna Recommendation Guide
svg.append('''
  <g transform="translate(18, 506)">
    <rect x="0" y="0" width="332" height="210" rx="8" fill="#1e293b" fill-opacity="0.65" stroke="#334155" stroke-width="1"/>
    <text x="12" y="20" fill="#ec4899" font-size="12" font-weight="bold">📡 Antennen-Upgrade-Praxis</text>
    
    <text x="12" y="40" fill="#ffffff" font-size="10.5" font-weight="bold">Empfehlung: 4×4 MIMO Richtantenne</text>
    <text x="12" y="55" fill="#94a3b8" font-size="9.5">(z. B. Poynting XPOL-2-5G / Panorama WMM4G)</text>
    
    <text x="12" y="76" fill="#38bdf8" font-size="9.5">• <tspan font-weight="bold" fill="#ffffff">Störfilter-Effekt:</tspan> Blendet Reflexionen nasser Bäume</text>
    <text x="20" y="90" fill="#94a3b8" font-size="9">und Nachbarmasten aus (SINR von -3 auf +12 dB!).</text>
    
    <text x="12" y="110" fill="#38bdf8" font-size="9.5">• <tspan font-weight="bold" fill="#ffffff">Signalgewinn:</tspan> +6 bis +9 dBi extra Trägerleistung.</text>
    <text x="20" y="124" fill="#94a3b8" font-size="9">Verwandelt -93 dBm in bärenstarke -84 dBm.</text>
    
    <text x="12" y="144" fill="#38bdf8" font-size="9.5">• <tspan font-weight="bold" fill="#ffffff">Wetterunempfindlich:</tspan> Stabilisiert 50–120 Mbit/s</text>
    <text x="20" y="158" fill="#94a3b8" font-size="9">selbst bei dichtem Randen-Herbstnebel und Regen.</text>

    <rect x="10" y="172" width="312" height="28" rx="4" fill="#0f172a" stroke="#ec4899" stroke-width="1"/>
    <text x="18" y="190" fill="#f472b6" font-size="9" font-weight="bold">⚠️ Kabel-Regel: Koaxialkabel kurz halten (max. 3–5 m)!</text>
  </g>
''')

# Card 4: Power Architecture &amp; German SIM Option
svg.append('''
  <g transform="translate(18, 730)">
    <rect x="0" y="0" width="332" height="270" rx="8" fill="#1e293b" fill-opacity="0.65" stroke="#334155" stroke-width="1"/>
    <text x="12" y="20" fill="#10b981" font-size="12" font-weight="bold">⚡ Duale Stromversorgung &amp; Grenz-SIM</text>

    <text x="12" y="42" fill="#ffffff" font-size="10.5" font-weight="bold">🔀 230V Netzumschalter (1 - 0 - 2):</text>
    <text x="12" y="58" fill="#94a3b8" font-size="9.5">• <tspan fill="#38bdf8">Stellung 1:</tspan> RDDSPON 6000W Inverter (Batteriebank)</text>
    <text x="12" y="73" fill="#94a3b8" font-size="9.5">• <tspan fill="#ef4444">Stellung 0:</tspan> AUS (Kein Ruhestromverlust bei Abwesenheit)</text>
    <text x="12" y="88" fill="#94a3b8" font-size="9.5">• <tspan fill="#f59e0b">Stellung 2:</tspan> Notstrom-Generator im Schuppen</text>
    <text x="12" y="103" fill="#e2e8f0" font-size="9">(Versorgt die 2 Router am Schweizer T13 Hausnetz)</text>

    <line x1="12" y1="116" x2="320" y2="116" stroke="#334155" stroke-width="1"/>

    <text x="12" y="134" fill="#ffffff" font-size="10.5" font-weight="bold">🔋 24/7 Autarker ESP32-S3 Direktabgriff:</text>
    <text x="12" y="150" fill="#94a3b8" font-size="9.5">• Hängt direkt an der 12V Batterie via USB-Wandler (&lt;0.5W).</text>
    <text x="12" y="165" fill="#94a3b8" font-size="9.5">• Puffert 48 Tage (35\'000 Datensätze) bei Inverter-Aus.</text>

    <line x1="12" y1="178" x2="320" y2="178" stroke="#334155" stroke-width="1"/>

    <text x="12" y="196" fill="#ffffff" font-size="10.5" font-weight="bold">🇩🇪 Deutsche SIM als Blackout-Redundanz:</text>
    <text x="12" y="212" fill="#94a3b8" font-size="9.5">• Mit manueller Netzwahl auf <tspan fill="#f87171">Telekom (262 01)</tspan> gilt die</text>
    <text x="20" y="226" fill="#94a3b8" font-size="9">Verbindung als <tspan fill="#ffffff" font-weight="bold">Inlandskontingent</tspan> (kein Roaming!).</text>
    <text x="12" y="244" fill="#94a3b8" font-size="9.5">• Ideal als autarke Zweit-Verbindung bei Schweiz-Störung.</text>
    <text x="12" y="259" fill="#38bdf8" font-size="9">• Swisscom-Wechsel bringt größere Bänder &amp; weniger Last.</text>
  </g>
''')

svg.append('</g>') # End of Sidebar Group

# Footer Watermark
svg.append(f'''
  <text x="{CANVAS_W - 20}" y="{CANVAS_H - 8}" text-anchor="end" fill="#475569" font-size="9">RandeSolar • openBrushograph Mechatronics • Stand November 2026</text>
''')

svg.append('</svg>')

svg_content = "\n".join(svg)

# Save SVG to docs/maps/randen_rf_map.svg and web/randen_rf_map.svg
os.makedirs('docs/maps', exist_ok=True)
os.makedirs('web', exist_ok=True)

with open('docs/maps/randen_rf_map.svg', 'w') as f:
    f.write(svg_content)

with open('web/randen_rf_map.svg', 'w') as f:
    f.write(svg_content)

print(f'✅ SVG Map successfully generated!')
print(f'   Size: {len(svg_content):,} bytes')
print(f'   Saved to: docs/maps/randen_rf_map.svg &amp; web/randen_rf_map.svg')
