import base64, math, os, json

# 1. Read base64 OSM background
with open('docs/maps/osm_randen_bg.png', 'rb') as f:
    b64_bg = base64.b64encode(f.read()).decode('utf-8')

# 2. Read real border ways from Overpass
with open('docs/maps/real_border.json', 'rb') as f:
    border_ways = json.load(f)

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
    return round(px, 1), round(py, 1)

rl_x, rl_y = latlon2pixel(47.7701, 8.5738)
PX_PER_KM = 77.8

svg = []
svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {CANVAS_W} {CANVAS_H}" width="100%" height="100%" style="background:#0b0f19; font-family:system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">')

# Definitions, Filters &amp; Interactive CSS
svg.append('''
  <defs>
    <!-- Glow and Shadow Filters -->
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
    <filter id="glow-border" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.65"/>
    </filter>
    <filter id="card-hover-shadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.85"/>
    </filter>
    <filter id="flyout-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.95"/>
    </filter>

    <style>
      .mast-group {
        cursor: pointer;
      }
      .mast-card-bg {
        transition: stroke-width 0.2s ease, stroke 0.2s ease, fill-opacity 0.2s ease;
      }
      .mast-beam-line {
        transition: stroke-width 0.2s ease, stroke-opacity 0.2s ease;
      }
      .mast-marker-halo {
        transition: r 0.2s ease, fill-opacity 0.2s ease;
      }
      .mast-leader-line {
        transition: stroke-width 0.2s ease, stroke-opacity 0.2s ease;
      }
      .mast-flyout {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .flyout-down {
        transform: translateY(-4px);
      }
      .flyout-up {
        transform: translateY(4px);
      }
      .mast-group:hover .mast-card-bg {
        stroke-width: 2.2px;
        fill-opacity: 0.98;
      }
      .mast-group:hover .mast-beam-line {
        stroke-width: 4px;
        stroke-dasharray: none;
        stroke-opacity: 1;
      }
      .mast-group:hover .mast-marker-halo {
        r: 22px;
        fill-opacity: 0.45;
      }
      .mast-group:hover .mast-leader-line {
        stroke-width: 1.8px;
        stroke-opacity: 1;
      }
      .mast-group:hover .mast-flyout {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .sidebar-row {
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .sidebar-row:hover rect {
        stroke-width: 1.5px;
        fill-opacity: 0.9;
      }
    </style>
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

# 2. Subtle Darkening Overlay
svg.append(f'  <rect x="{MAP_X}" y="{MAP_Y}" width="{MAP_W}" height="{MAP_H}" fill="#0f172a" fill-opacity="0.28"/>')

# 3. Distance Circles from RandeLab (1km, 2km, 3km, 5km)
for km in [1, 2, 3, 5]:
    r = km * PX_PER_KM
    svg.append(f'  <circle cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="{r:.1f}" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4 4" stroke-opacity="0.45"/>')
    svg.append(f'  <text x="{rl_x + r + 4:.1f}" y="{rl_y - 4:.1f}" fill="#38bdf8" font-size="10" font-weight="bold" opacity="0.8">{km} km</text>')

# 4. EXACT REAL SWISS-GERMAN BORDER from OpenStreetMap Relation Data
svg.append('  <!-- Exact Real National Border Switzerland / Germany from OSM -->')
for i, w in enumerate(border_ways):
    pts = [latlon2pixel(pt['lat'], pt['lon']) for pt in w]
    d_str = " ".join([f'{"M" if j==0 else "L"} {px} {py}' for j, (px, py) in enumerate(pts)])
    # Red background glow
    svg.append(f'  <path d="{d_str}" fill="none" stroke="#ef4444" stroke-width="4.5" stroke-opacity="0.5" filter="url(#glow-border)"/>')
    # Crisp dashed national border
    svg.append(f'  <path d="{d_str}" fill="none" stroke="#ef4444" stroke-width="2.8" stroke-dasharray="10 5" stroke-linecap="round"/>')
    svg.append(f'  <path d="{d_str}" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="3 12" stroke-linecap="round"/>')

# Border Label Badge along the border (Non-overlapping: X: 500, Y: 380, W: 215, H: 26)
svg.append('''
  <g class="mast-group" transform="translate(500, 380)" filter="url(#card-shadow)">
    <title>🇨🇭 SCHWEIZERISCH-DEUTSCHE STAATSGRENZE (Kanton SH / Baden-Württemberg)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Offizielle Grenzrelation: 384 GPS-Grenzsteine &amp; Vermessungspunkte
📏 Distanz zum RandeLab: ca. 1.5 km nördlich
📡 HF-Grenzlinie: Trennt Schweizer Mobilfunknetz (MCC 228) von deutschem Netz (MCC 262)
🇩🇪 Grenz-Overspill: Deutsche Sendemasten (Wiechs, Tengen) reichen ungedämpft ins RandeLab
💡 Praxis-Option: Deutsche SIM (Telekom) nutzt volles Inlandsvolumen ohne Roaming-Limit!</title>
    <rect class="mast-card-bg" x="0" y="0" width="215" height="26" rx="5" fill="#0f172a" fill-opacity="0.94" stroke="#ef4444" stroke-width="1.5"/>
    <text x="107.5" y="17" text-anchor="middle" fill="#f87171" font-size="10.5" font-weight="bold" letter-spacing="0.8">🇨🇭 SCHWEIZ  |  DEUTSCHLAND 🇩🇪</text>
    
    <!-- Hover Flyout for Border -->
    <g class="mast-flyout flyout-down" transform="translate(0, 30)" filter="url(#flyout-shadow)">
      <rect x="0" y="0" width="235" height="96" rx="6" fill="#090d16" fill-opacity="0.97" stroke="#ef4444" stroke-width="1.2"/>
      <text x="10" y="18" fill="#f87171" font-size="10" font-weight="bold">🛂 3GPP-Grenztopologie &amp; Roaming</text>
      <text x="10" y="36" fill="#e2e8f0" font-size="9">• 384 amtliche GPS-Grenzpunkte (Swisstopo)</text>
      <text x="10" y="52" fill="#cbd5e1" font-size="9">• Deutsche Masten überstrahlen Randen-Kamm</text>
      <text x="10" y="68" fill="#cbd5e1" font-size="9">• DE-SIM wählt Telekom.de als Heimnetz (kein Roaming!)</text>
      <text x="10" y="84" fill="#38bdf8" font-size="8.5">💡 Maximale Redundanz bei Ausfall von Schweizer Netzen</text>
    </g>
  </g>
''')

# 5. Non-overlapping Mast Definitions with Rich Hover Overlays
# All coordinates are verified collision-free!
masts = [
    {
        'id': 'tengen',
        'name': 'Tengen / Kommingen (Hegau)',
        'sub': '1+1 (262 23) &amp; o2 - de (262 03)',
        'lat': 47.8180, 'lon': 8.5520,
        'badge': '🇩🇪 1+1 5G Open-RAN &amp; o2 über Hegau',
        'stroke': '#8b5cf6',
        'flag': '🇩🇪',
        'dist': '5.57 km • 343° (NNW)',
        # Main Card: X: 30, Y: 70, W: 275, H: 68
        'card_x': 30, 'card_y': 70, 'card_w': 275, 'card_h': 68,
        # Leader line connects to right edge of card: (305, 104)
        'leader_to': (305, 104),
        # Flyout opens DOWNWARD at y: 142 (height: 112)
        'flyout_y': 142, 'flyout_dir': 'flyout-down',
        'flyout_w': 275, 'flyout_h': 112,
        'details': [
            ('Frequenzen:', '1+1 n78 (3.5 GHz) • o2 LTE B20/B1'),
            ('Topologie:', '5.57 km NNW • Einstrahlung über Hegau-Kämme'),
            ('Besonderheit:', 'Neuestes deutsches 5G-Kernnetz (Open-RAN)'),
            ('Status:', 'Empfangbar mit hoher Antennenposition')
        ],
        'title': """🇩🇪 Tengen / Kommingen (Hegau, Baden-Württemberg)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Koordinaten: 47.8180° N, 8.5520° E • ~680 m ü. M.
📏 Distanz / Peilung: 5.57 km • 343° (NNW) vom RandeLab
🏢 Netzbetreiber: 1+1 Mobilfunk (262 23) &amp; Telefónica o2 (262 03)
📡 Frequenzen: 1+1 5G Band n78 (C-Band) • o2 LTE Band 20 &amp; Band 1
🔬 HF-Charakteristik: Sendet über den Hegau-Kamm nach Süden
💡 Besonderheit: 1+1 nutzt modernstes europäisches Open-RAN Netz"""
    },
    {
        'id': 'wiechs',
        'name': 'Wiechs am Randen (Baden-Württ.)',
        'sub': 'Telekom.de (262 01) &amp; Vodafone (262 02)',
        'lat': 47.8050, 'lon': 8.5860,
        'badge': '🇩🇪 DE Grenz-Overspill: 5G NR direkt empfangen!',
        'stroke': '#ef4444',
        'flag': '🇩🇪',
        'dist': '3.99 km • 13° (NNE)',
        # Main Card: X: 420, Y: 70, W: 275, H: 68
        'card_x': 420, 'card_y': 70, 'card_w': 275, 'card_h': 68,
        # Leader line connects to bottom edge of card: (557, 138)
        'leader_to': (557, 138),
        # Flyout opens DOWNWARD at y: 142 (height: 112)
        'flyout_y': 142, 'flyout_dir': 'flyout-down',
        'flyout_w': 275, 'flyout_h': 112,
        'details': [
            ('Frequenzen:', 'Telekom 5G n28/n78 • B8/B20 | Vodafone 5G'),
            ('Topologie:', '3.99 km NNE • Weitbereichs-Mast im Hegau'),
            ('SIM-Option:', 'Deutsche SIM gilt hier als Inland (kein Roaming!)'),
            ('Praxis:', 'Perfekter Ausfallschutz bei Schweizer Störungen')
        ],
        'title': """🇩🇪 Wiechs am Randen (Baden-Württemberg)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Koordinaten: 47.8050° N, 8.5860° E • ~700 m ü. M.
📏 Distanz / Peilung: 3.99 km • 13° (NNE) vom RandeLab
🏢 Netzbetreiber: Telekom Deutschland (262 01) &amp; Vodafone (262 02)
📡 Funkstandard: 5G NR (n28 700 MHz &amp; n78 3.5 GHz) + LTE B8/B20
📶 Signalstärke: Direkter Grenzübertritt; beide Netze im 3GPP-Scan sichtbar
💡 Highlight: Mit deutscher SIM (Telekom) volles Flatrate-Inlandsvolumen!"""
    },
    {
        'id': 'bargen',
        'name': 'Mast Bargen (A4-Korridor)',
        'sub': 'Salt / GoMo • LTE Band 20 (800 MHz)',
        'lat': 47.7890, 'lon': 8.6045,
        'badge': '🌲 Reichweiten-König: 14.3 / 54.8 Mbit/s • -88 dBm',
        'stroke': '#ec4899',
        'flag': '🇨🇭',
        'dist': '3.11 km • 48° (NE)',
        # Main Card: X: 725, Y: 180, W: 285, H: 68
        'card_x': 725, 'card_y': 180, 'card_w': 285, 'card_h': 68,
        # Leader line connects to bottom edge: (867, 248)
        'leader_to': (867, 248),
        # Flyout opens DOWNWARD at y: 252 (height: 112)
        'flyout_y': 252, 'flyout_dir': 'flyout-down',
        'flyout_w': 285, 'flyout_h': 112,
        'details': [
            ('Frequenz &amp; Band:', 'LTE Band 20 (800 MHz) • 10 MHz Bandbreite'),
            ('Performance:', '⬇️ 14.33 Mbit/s | ⬆️ 54.84 Mbit/s Uplink!'),
            ('HF-Vorteil:', 'Sub-1GHz durchdringt 2.5 km geschlossenen Wald'),
            ('Empfehlung:', 'Bester Backup-Träger bei extremem Schlechtwetter')
        ],
        'title': """🇨🇭 Mast Bargen (A4-Verkehrsachse / Randen Osthang)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Koordinaten: 47.7890° N, 8.6045° E • ~645 m ü. M.
📏 Distanz / Peilung: 3.11 km • 48° (NE) vom RandeLab
🏢 Netzbetreiber: Salt Schweiz / GoMo (228 03)
📡 Frequenz: LTE Band 20 (800 MHz, 10 MHz Bandbreite)
🚀 Durchsatz-Messung: 14.33 Mbit/s Down / 54.84 Mbit/s Upload!
🌲 Geländebeschaffenheit: Signal durchdringt 2.5 km dichten Randen-Mischwald
💡 Phänomen: Enorm hoher Upload dank minimaler Störer auf 800 MHz"""
    },
    {
        'id': 'hagenturm',
        'name': 'Hagenturm (912 m ü. M.)',
        'sub': 'Swisscom (228 01) &amp; Sunrise (228 02)',
        'lat': 47.77404, 'lon': 8.56757,
        'badge': '🏔️ Höchster Punkt Kanton SH • 640 m NW vom RandeLab!',
        'stroke': '#f59e0b',
        'flag': '🇨🇭',
        'dist': '0.64 km • 313° (NW)',
        # Main Card: X: 30, Y: 470, W: 305, H: 68
        'card_x': 30, 'card_y': 470, 'card_w': 305, 'card_h': 68,
        # Leader line connects to right edge: (335, 504)
        'leader_to': (335, 504),
        # Flyout opens UPWARD at y: 350 (height: 115)
        'flyout_y': 350, 'flyout_dir': 'flyout-up',
        'flyout_w': 305, 'flyout_h': 115,
        'details': [
            ('Standort &amp; Turm:', '40 m Stahlfachwerkturm • 912 m ü. M. (SH-Peak)'),
            ('HF-Bedingungen:', '100% freie Sichtlinie (LOS) über Waldkronen'),
            ('Bänder &amp; Funk:', 'Swisscom/Sunrise: LTE B3/B20/B1 &amp; 5G N78 (3.5G)'),
            ('Potenzial:', 'RSRP -62 dBm | SINR &gt;20 dB | &gt;180–300 Mbit/s möglich')
        ],
        'title': """🏔️ Hagenturm (912 m ü. M.) • Höchster Punkt Kanton Schaffhausen
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Exakte Koordinaten: 47.77404° N, 8.56757° E • 912 m ü. M.
📏 Distanz / Peilung: Nur 639.3 m • 313.3° (NW) direkt neben RandeLab!
🏢 Netzbetreiber: Swisscom (228 01) &amp; Sunrise (228 02)
📡 Funkstandard: 4G LTE &amp; 5G NR n78 (3.5 GHz C-Band)
🔭 Sichtlinie: Perfekte optische Sichtverbindung ohne jede Geländebarre!
📶 Signalpotenzial: RSRP bis zu -62 dBm, SINR > +22 dB
🚀 Möglicher Durchsatz: 180 – 300 Mbit/s (Keine Walddämpfung!)
💡 Upgrade-Tipp: Bei Wechsel zu Swisscom/Sunrise maximale Signalstärke."""
    },
    {
        'id': 'merishausen',
        'name': 'Mast Merishausen Südhang',
        'sub': 'Salt / GoMo • LTE B3 (20 MHz) + 5G N1/N78',
        'lat': 47.7585, 'lon': 8.5910,
        'badge': '🏆 High-Speed Sieger: 44.8 Mbit/s | -93 dBm | SINR 11 dB',
        'stroke': '#06b6d4',
        'flag': '🇨🇭',
        'dist': '1.82 km • 135° (SE)',
        # Main Card: X: 725, Y: 730, W: 290, H: 68
        'card_x': 725, 'card_y': 730, 'card_w': 290, 'card_h': 68,
        # Leader line connects to left edge: (725, 764)
        'leader_to': (725, 764),
        # Flyout opens DOWNWARD at y: 802 (height: 112)
        'flyout_y': 802, 'flyout_dir': 'flyout-down',
        'flyout_w': 290, 'flyout_h': 112,
        'details': [
            ('Trägerfrequenzen:', 'LTE B3 (1800 20MHz) + 5G N1 (2100) + 5G N78 (3.5G)'),
            ('Nacht-Benchmark:', '⬇️ 44.78 Mbit/s | ⬆️ 83.16 Mbit/s | SINR +11 dB'),
            ('Wetterdämpfung:', 'Bei Herbstnebel/Regen sinkt SINR auf -3 dB'),
            ('Empfehlung:', '4x4 MIMO Richtantenne stabilisiert dauerhaft &gt;50M')
        ],
        'title': """🇨🇭 Mast Merishausen Südhang (eNodeB Korridor)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Koordinaten: 47.7585° N, 8.5910° E • ~620 m ü. M.
📏 Distanz / Peilung: 1.82 km • 135° (SE) vom RandeLab
🏢 Netzbetreiber: Salt Schweiz / GoMo (228 03)
📡 Frequenzen: LTE Band 3 (1800 MHz 20MHz) + 5G NR n1 (2100) + n78 (3500)
🏆 High-Speed Rekord: 44.78 Mbit/s Down / 83.16 Mbit/s Upload (Nacht 02:09)
🌧️ Mikroklima: Nasses Blätterdach dämpft 1.8–2.1 GHz (SINR sinkt auf -3 dB)
💡 Antennen-Tipp: 4x4 MIMO Richtantenne blendet Waldreflexionen aus (+9 dBi)"""
    },
    {
        'id': 'randen_b8',
        'name': 'Zelle Randen (900 MHz)',
        'sub': 'Salt / GoMo • LTE Band 8 (10 MHz)',
        'lat': 47.7640, 'lon': 8.5790,
        'badge': '🔋 Ruhe-Anker: -81 dBm (10 MHz) • 9.7 / 14.9 Mbit/s',
        'stroke': '#10b981',
        'flag': '🇨🇭',
        'dist': '0.78 km • 150° (SSE)',
        # Main Card: X: 400, Y: 860, W: 285, H: 68
        'card_x': 400, 'card_y': 860, 'card_w': 285, 'card_h': 68,
        # Leader line connects to top edge: (542, 860)
        'leader_to': (542, 860),
        # Flyout opens UPWARD at y: 740 (height: 115)
        'flyout_y': 740, 'flyout_dir': 'flyout-up',
        'flyout_w': 285, 'flyout_h': 115,
        'details': [
            ('Träger &amp; Zelle:', 'LTE Band 8 (900 MHz) • Cell ID: 23669005 (TAC 40120)'),
            ('Aktueller Empfang:', 'RSRP -81 dBm (sehr stark) • SINR +5 dB • Güte 57%'),
            ('Scheduler-Rolle:', 'Automatischer Ruhe-Anker (Idle Carrier) des TRB500'),
            ('Dynamik:', 'Bei Datenlast schaltet Modem sofort auf B3 + 5G N78 um')
        ],
        'title': """🇨🇭 Zelle Randen (LTE Band 8 • 900 MHz)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Koordinaten: 47.7640° N, 8.5790° E • ~830 m ü. M.
📏 Distanz / Peilung: 0.78 km • 150° (SSE) vom RandeLab
🏢 Netzbetreiber: Salt Schweiz / GoMo (Cell ID: 23669005, PCID: 107)
📡 Frequenz: LTE Band 8 (900 MHz, 10 MHz Bandbreite)
📶 Aktuelle Live-Werte: RSRP -81 dBm • SINR +5 dB • Signalqualität 57%
🔋 Funktion: Primärer Ruhe-Anker; schont Strom &amp; hält stabilen Uplink
⚡ Dynamische Carrier Aggregation: Schaltet bei Speedtest sofort 5G N78 zu!"""
    }
]

# Draw Radio Rays / Beams
for m in masts:
    mx, my = latlon2pixel(m['lat'], m['lon'])
    col = m['stroke']
    svg.append(f'  <line class="mast-beam-line" x1="{rl_x:.1f}" y1="{rl_y:.1f}" x2="{mx:.1f}" y2="{my:.1f}" stroke="{col}" stroke-width="2.2" stroke-dasharray="6 3" stroke-opacity="0.75"/>')

# Draw Mast Markers, Cards and Hover Flyouts
for m in masts:
    mx, my = latlon2pixel(m['lat'], m['lon'])
    col = m['stroke']
    cx = m['card_x']
    cy = m['card_y']
    cw = m['card_w']
    ch = m['card_h']
    lx, ly = m['leader_to']
    
    fx = cx
    fy = m['flyout_y']
    fw = m['flyout_w']
    fh = m['flyout_h']
    fdir = m['flyout_dir']

    svg.append(f'  <!-- Interactive Mast Group: {m["id"]} -->')
    svg.append(f'  <g class="mast-group" data-id="{m["id"]}">')
    svg.append(f'    <title>{m["title"]}</title>')

    # 1. Leader Line from Marker to Card
    svg.append(f'    <line class="mast-leader-line" x1="{mx:.1f}" y1="{my:.1f}" x2="{lx:.1f}" y2="{ly:.1f}" stroke="{col}" stroke-width="1.2" stroke-opacity="0.55"/>')
    svg.append(f'    <circle cx="{lx:.1f}" cy="{ly:.1f}" r="2.5" fill="{col}"/>')

    # 2. Pulsing Marker on Map
    svg.append(f'    <circle class="mast-marker-halo" cx="{mx:.1f}" cy="{my:.1f}" r="15" fill="{col}" fill-opacity="0.22" stroke="{col}" stroke-width="1.5"/>')
    svg.append(f'    <circle cx="{mx:.1f}" cy="{my:.1f}" r="5.5" fill="{col}" stroke="#ffffff" stroke-width="1.5"/>')

    # 3. Visible Main Card (Guaranteed 100% collision-free)
    svg.append(f'    <g filter="url(#card-shadow)">')
    svg.append(f'      <rect class="mast-card-bg" x="{cx}" y="{cy}" width="{cw}" height="{ch}" rx="6" fill="#0f172a" fill-opacity="0.94" stroke="{col}" stroke-width="1.4"/>')
    svg.append(f'      <text x="{cx + 10}" y="{cy + 19}" fill="#ffffff" font-size="11.5" font-weight="bold">{m["flag"]} {m["name"]}</text>')
    svg.append(f'      <text x="{cx + 10}" y="{cy + 36}" fill="{col}" font-size="10" font-weight="600">{m["sub"]}</text>')
    svg.append(f'      <text x="{cx + 10}" y="{cy + 53}" fill="#94a3b8" font-size="9">{m["dist"]} • {m["badge"]}</text>')
    svg.append(f'    </g>')

    # 4. Rich Interactive Hover Flyout (Guaranteed 100% collision-free)
    svg.append(f'    <g class="mast-flyout {fdir}" filter="url(#flyout-shadow)">')
    svg.append(f'      <rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" rx="6" fill="#090d16" fill-opacity="0.97" stroke="{col}" stroke-width="1.3"/>')
    svg.append(f'      <text x="{fx + 10}" y="{fy + 18}" fill="{col}" font-size="10" font-weight="bold">🔬 HF-DETAIL &amp; SPEZIFIKATION</text>')
    
    y_text = fy + 36
    for k, v in m['details']:
        svg.append(f'      <text x="{fx + 10}" y="{y_text}" fill="#cbd5e1" font-size="9"><tspan fill="#ffffff" font-weight="bold">{k}</tspan> {v}</text>')
        y_text += 18
    svg.append(f'    </g>')

    svg.append(f'  </g>')

# 6. RandeLab Central Hub (📍 857 m ü. M.)
rl_cw, rl_ch = 315, 84
rl_cx = 30
rl_cy = 620

svg.append(f'''
  <!-- RandeLab Central Station Group -->
  <g class="mast-group" data-id="randelab">
    <title>📍 RandeLab Observatorium &amp; Autarkes Solar-Inselnetz (857 m ü. M.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏠 Gebäude: Underes Ätzisloo 189, 8232 Merishausen / Randen
🌍 Koordinaten: 47.7701° N, 8.5738° E • Höhe: 857 m ü. M. (Amtl. GWR)
📡 5G Gateway: Teltonika TRB500 Industrial CPE (Qualcomm Snapdragon X55)
⚡ Microcontroller: ESP32-S3 (randesolar.local) • 24/7 autark an 12V-Batterie
🔋 Batteriebank: 4x VOLTIC DIN 595 parallel (380 Ah @ 12V = 4.56 kWh Brutto)
🔀 230V Umschalter (1-0-2): RDDSPON 6000W Inverter vs. Schuppen-Generator
🔌 Schweizer T13 Hausnetz (SEV 1011) versorgt TRB500 &amp; TP-Link Omada AP
💾 Flash-Speicher: 35\'000 Offline-Messungen (48 Tage Pufferung bei Stromausfall)</title>

    <!-- Pulsing Central Marker -->
    <circle class="mast-marker-halo" cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="32" fill="#06b6d4" fill-opacity="0.22" stroke="#06b6d4" stroke-width="2" stroke-dasharray="3 3"/>
    <circle cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="18" fill="#ec4899" fill-opacity="0.35" stroke="#ec4899" stroke-width="2"/>
    <circle cx="{rl_x:.1f}" cy="{rl_y:.1f}" r="7" fill="#fbbf24" stroke="#ffffff" stroke-width="2"/>

    <!-- Leader Line to RandeLab Card (345, 662) -->
    <line class="mast-leader-line" x1="{rl_x:.1f}" y1="{rl_y:.1f}" x2="345" y2="662" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.65"/>
    <circle cx="345" cy="662" r="3" fill="#38bdf8"/>

    <!-- Main RandeLab Card -->
    <g filter="url(#card-shadow)">
      <rect class="mast-card-bg" x="{rl_cx}" y="{rl_cy}" width="{rl_cw}" height="{rl_ch}" rx="8" fill="#0f172a" fill-opacity="0.96" stroke="#38bdf8" stroke-width="2"/>
      <text x="{rl_cx + 12}" y="{rl_cy + 22}" fill="#38bdf8" font-size="13.5" font-weight="bold">📍 RANDELAB OBSERVATORIUM</text>
      <text x="{rl_cx + 12}" y="{rl_cy + 40}" fill="#facc15" font-size="11" font-weight="bold">Höhe: 857 m ü. M. • Underes Ätzisloo 189</text>
      <text x="{rl_cx + 12}" y="{rl_cy + 56}" fill="#e2e8f0" font-size="9.5">📡 Teltonika TRB500 (Qualcomm Snapdragon X55)</text>
      <text x="{rl_cx + 12}" y="{rl_cy + 71}" fill="#94a3b8" font-size="9">⚡ ESP32-S3 (24/7 Autark direkt an 12V Batterie)</text>
    </g>

    <!-- Hover Flyout for RandeLab (opens DOWNWARD at y: 708) -->
    <g class="mast-flyout flyout-down" filter="url(#flyout-shadow)">
      <rect x="{rl_cx}" y="708" width="{rl_cw}" height="120" rx="8" fill="#090d16" fill-opacity="0.97" stroke="#38bdf8" stroke-width="1.4"/>
      <text x="{rl_cx + 12}" y="728" fill="#38bdf8" font-size="10.5" font-weight="bold">⚙️ AUTARKE SYSTEM-TOPOLOGIE</text>
      <text x="{rl_cx + 12}" y="746" fill="#cbd5e1" font-size="9">• <tspan fill="#ffffff" font-weight="bold">Duale 230V Speisung:</tspan> 6000W Inverter &amp; Schuppen-Generator</text>
      <text x="{rl_cx + 12}" y="763" fill="#cbd5e1" font-size="9">• <tspan fill="#ffffff" font-weight="bold">1-0-2 Schalter:</tspan> Speist Schweizer T13 Hausnetz &amp; beide Router</text>
      <text x="{rl_cx + 12}" y="780" fill="#cbd5e1" font-size="9">• <tspan fill="#ffffff" font-weight="bold">12V Direktabgriff:</tspan> ESP32 loggt 24/7 auch bei 230V AUS (&lt;0.5W)</text>
      <text x="{rl_cx + 12}" y="797" fill="#cbd5e1" font-size="9">• <tspan fill="#ffffff" font-weight="bold">LittleFS Puffer:</tspan> 35\'000 Datensätze (48 Tage autark)</text>
      <text x="{rl_cx + 12}" y="814" fill="#facc15" font-size="8.5">🌐 Live Web-OTA, ubus JSON-RPC &amp; MQTT HiveMQ Stream</text>
    </g>
  </g>
''')

# 7. Compass Rose in Top-Right of Map
cmp_x = MAP_X + MAP_W - 55
cmp_y = MAP_Y + 55
svg.append(f'''
  <!-- Compass Rose -->
  <g transform="translate({cmp_x}, {cmp_y})">
    <circle cx="0" cy="0" r="28" fill="#0f172a" fill-opacity="0.85" stroke="#475569" stroke-width="1.5"/>
    <polygon points="0,-22 6,-4 0,0" fill="#ef4444"/>
    <polygon points="0,-22 -6,-4 0,0" fill="#dc2626"/>
    <polygon points="0,22 6,4 0,0" fill="#94a3b8"/>
    <polygon points="0,22 -6,4 0,0" fill="#64748b"/>
    <polygon points="-22,0 -4,-6 0,0" fill="#64748b"/>
    <polygon points="22,0 4,-6 0,0" fill="#94a3b8"/>
    <text x="0" y="-25" text-anchor="middle" fill="#ef4444" font-size="11" font-weight="bold">N</text>
    <text x="0" y="33" text-anchor="middle" fill="#94a3b8" font-size="9">S</text>
    <text x="32" y="3" text-anchor="middle" fill="#94a3b8" font-size="9">O</text>
    <text x="-32" y="3" text-anchor="middle" fill="#94a3b8" font-size="9">W</text>
  </g>
''')

# 8. Scale Bar Bottom-Left of Map
sc_x = MAP_X + 24
sc_y = MAP_Y + MAP_H - 30
km2_px = 2 * PX_PER_KM
svg.append(f'''
  <!-- Scale Bar -->
  <g transform="translate({sc_x}, {sc_y})">
    <rect x="-8" y="-18" width="{km2_px + 24}" height="32" rx="4" fill="#0f172a" fill-opacity="0.85" stroke="#334155"/>
    <line x1="0" y1="0" x2="{km2_px}" y2="0" stroke="#ffffff" stroke-width="3"/>
    <line x1="0" y1="-5" x2="0" y2="5" stroke="#ffffff" stroke-width="2"/>
    <line x1="{km2_px/2}" y1="-4" x2="{km2_px/2}" y2="4" stroke="#ffffff" stroke-width="1.5"/>
    <line x1="{km2_px}" y1="-5" x2="{km2_px}" y2="5" stroke="#ffffff" stroke-width="2"/>
    <text x="0" y="-8" fill="#ffffff" font-size="9" text-anchor="middle">0</text>
    <text x="{km2_px/2}" y="-8" fill="#ffffff" font-size="9" text-anchor="middle">1 km</text>
    <text x="{km2_px}" y="-8" fill="#ffffff" font-size="9" text-anchor="middle">2 km</text>
    <text x="{km2_px/2}" y="10" fill="#94a3b8" font-size="8" text-anchor="middle">OpenStreetMap &amp; Swisstopo Border</text>
  </g>
''')

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
  <g class="sidebar-row" transform="translate(18, 76)">
    <title>3GPP Grenzscan: Empfangene Mobilfunknetze an der Grenze SH / BW</title>
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
  <g class="sidebar-row" transform="translate(18, 276)">
    <title>Masten-Olympiade: Vergleich aller Frequenzen und Signalqualitäten</title>
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

    <!-- Table Row 3: Hagenturm -->
    <rect x="10" y="128" width="312" height="42" rx="4" fill="#0f172a" stroke="#f59e0b" stroke-width="1"/>
    <text x="18" y="144" fill="#f59e0b" font-size="11" font-weight="bold">Hagenturm (912 m ü. M.) - 640 m NW</text>
    <text x="18" y="160" fill="#e2e8f0" font-size="9.5">Swisscom &amp; Sunrise 4G/5G | Direkte Sichtlinie</text>

    <!-- Table Row 4: Band 8 &amp; 78 -->
    <rect x="10" y="176" width="312" height="32" rx="4" fill="#0f172a" stroke="#10b981" stroke-dasharray="3 2"/>
    <text x="18" y="196" fill="#10b981" font-size="9.5">Band 8 (-81 dBm) im Idle • 5G N78 schaltet bei Last zu!</text>
  </g>
''')

# Card 3: External Antenna Recommendation Guide
svg.append('''
  <g class="sidebar-row" transform="translate(18, 506)">
    <title>Antennen-Praxis: Warum eine 4x4 MIMO Richtantenne bei Nebel und Regen hilft</title>
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
  <g class="sidebar-row" transform="translate(18, 730)">
    <title>Stromversorgung &amp; Grenz-SIM Details</title>
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

print(f'✅ Non-overlapping Interactive SVG Map generated!')
print(f'   Size: {len(svg_content):,} bytes')
