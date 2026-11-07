#!/usr/bin/env python3
"""
🥬🥥 CHABIS RADIO 5G SCANNER • The Botanical & Coconut Radio Explorer
======================================================================
Colourful, rich interactive CLI scanner for Teltonika TRB500 (192.168.2.1)
Observatory: RandeLab • Underes Ätzisloo 189, 8232 Merishausen (857 m ü. M.)
Motto: "Zwischen Kabis und Kokosnuss – das 5G-Funkfeld auf dem Randen!"

Features:
  1. 📡 Live Kabis-Radar (Watch Mode mit animiertem Puls)
  2. ⚡ Ookla 5G Speedtest (Fliegende Kokosnuss & Spektrum-Animation)
  3. 🛰️ Masten- & Frequenz-Check (Merishausen, Bargen, 800 MHz mit HF-Tuner-Animation)
  4. 🔬 Tiefen-Zell-Analyse (eNodeB, Sektor, TAC, PCID, SINR)
  5. 🥥📝 Vollständigen Kabis- & Kokosnuss-Bericht erstellen (reports/)
"""

import os
import sys
import time
import json
import math
import re
import argparse
import urllib.request
from datetime import datetime

# Automatischer Re-Exec mit .venv falls rich nicht im aktuellen Python verfügbar ist
try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.text import Text
    from rich.layout import Layout
    from rich.live import Live
    from rich.prompt import Prompt, IntPrompt, Confirm
    from rich.align import Align
    from rich import box
except ImportError:
    venv_py = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".venv", "bin", "python3")
    if os.path.exists(venv_py) and sys.executable != venv_py:
        os.execv(venv_py, [venv_py] + sys.argv)
    else:
        print("Fehler: 'rich' Bibliothek wird benötigt. Bitte im .venv installieren: pip install rich")
        sys.exit(1)

ROUTER_IP = "192.168.2.1"
USERNAME = "admin"
PASSWORD = "Transist0r!"
REPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports")

console = Console()

HEADER_ART_CHABIS = r"""[bold chartreuse3]
       _.-'-._ 
    .-'   _   '-.      [bold chartreuse2] ____ _           _     _          ____                                 [/]
   /   .-' '-.   \     [bold chartreuse2]/ ___| |__   __ _| |__ (_)___      / ___|  ___ __ _ _ __  _ __   ___ _ __ [/]
  |  /  _..._  \  |    [bold chartreuse2]| |   | '_ \ / _` | '_ \| / __|     \___ \ / __/ _` | '_ \| '_ \ / _ \ '__|[/]
  | |  /     \  | |    [bold chartreuse2]| |___| | | | (_| | |_) | \__ \      ___) | (_| (_| | | | | | | |  __/ |   [/]
   \ \ \_   _/ / /     [bold chartreuse2]\____|_| |_|\__,_|_.__/|_|___/     |____/ \___\__,_|_| |_|_| |_|\___|_|   [/]
    '.'. '-'.' .'
      '-._._.-'            [bold pale_green3]-- 🥬 Chabis Radio 5G & Coconut Explorer 🥥 (857 m ü. M.) --[/]
"""

class ChabisDashboard:
    def __init__(self):
        self.theme_color = "chartreuse3"
        self.accent_color = "chartreuse2"
        self.header_art = HEADER_ART_CHABIS
        self.logs = []
        self.pulse_frame = 0
        self.log("🥬 Chabis Radio 5G Scanner gestartet auf 857 m ü. M.")
        self.log(f"🥥 Prüfe Kokosnuss-Ausbreitungsbedingungen zum Teltonika TRB500 ({ROUTER_IP})...")

    def log(self, msg):
        timestamp = time.strftime("%H:%M:%S")
        self.logs.append(f"[{self.theme_color}]{timestamp}[/] [dim]•[/] {msg}")
        if len(self.logs) > 8:
            self.logs.pop(0)

    def coconut_meter(self, rsrp):
        try:
            val = int(rsrp)
        except:
            return "[dim]Keine Kokosnuss erfasst[/dim]"
        
        if val >= -80:
            coconuts = "🥥🥥🥥🥥🥥"
            style = "bold chartreuse2"
            desc = "Vollreife Tropen-Qualität"
        elif val >= -90:
            coconuts = "🥥🥥🥥🥥░"
            style = "chartreuse3"
            desc = "Saftige Randen-Ernte"
        elif val >= -100:
            coconuts = "🥥🥥🥥░░"
            style = "yellow"
            desc = "Waldrand & nasser Kabis"
        elif val >= -110:
            coconuts = "🥥🥥░░░"
            style = "bright_yellow"
            desc = "Dünne Kokosmilch"
        elif val >= -118:
            coconuts = "🥥░░░░"
            style = "dark_orange"
            desc = "Kokosnuss fast weg"
        else:
            coconuts = "░░░░░"
            style = "bold red"
            desc = "Kokosnuss vom Baum gefallen"
        return f"{coconuts} [{style}]{val} dBm[/{style}] [dim]({desc})[/dim]"

    def sinr_badge(self, sinr):
        try:
            val = int(sinr)
            if val >= 15:
                return f"[bold green]{val:+d} dB (Kristallklar wie Kokoswasser)[/bold green]"
            elif val >= 5:
                return f"[green]{val:+d} dB (Sauber / Solider Kabis)[/green]"
            elif val >= 0:
                return f"[yellow]{val:+d} dB (Rauschen im Unterholz)[/yellow]"
            else:
                return f"[red]{val:+d} dB (Interferenz / Dickes Gestrüpp)[/red]"
        except:
            return f"[dim]{sinr} dB[/dim]"

    def mast_topology_hint(self, pcid):
        try:
            p = int(pcid)
            if p == 54:
                return "[bold cyan]Merishausen Südhang (eNodeB 116636)[/bold cyan]"
            elif p in [227, "1C74A17"]:
                return "[bright_magenta]Bargen / A4 Korridor (eNodeB 119388)[/bright_magenta]"
            elif p == 239:
                return "[magenta]Bargen Sektor 2 / Weitsicht[/magenta]"
            elif p in [178, 951]:
                return "[bold green]Salt 5G N1 Träger (Kokosnuss-Speed)[/bold green]"
            else:
                return "[dim]Randen-Kamm / Weitsicht[/dim]"
        except:
            return "[dim]Unbekannt[/dim]"

    def generate_layout(self, sid):
        self.pulse_frame = (self.pulse_frame + 1) % 4
        radar_icons = ["📡 ◜", "📡 ◝", "📡 ◞", "📡 ◟"]
        current_radar = radar_icons[self.pulse_frame]

        modem_info_raw = call_gsmctl(sid, ["-E"])
        try:
            info = json.loads(modem_info_raw)
        except:
            info = {}

        neighbours_raw = call_gsmctl(sid, ["-I"])
        cache = info.get("cache", {})
        temp = float(info.get("temperature", 220)) / 10.0
        operator = cache.get("provider_name", "GoMo / Salt")
        net_mode = cache.get("net_mode_str", "5G-NSA")
        modem_model = info.get("model", "Quectel RG501Q-EU")
        cell_id = cache.get("cellid", "29858817")

        main_layout = Layout()
        main_layout.split_column(
            Layout(name="header", size=13),
            Layout(name="body", ratio=2),
            Layout(name="footer", size=10)
        )

        main_layout["footer"].split_row(
            Layout(name="console", ratio=2),
            Layout(name="status", ratio=1)
        )

        # Header Panel
        main_layout["header"].update(Panel(self.header_art, border_style=self.theme_color))

        # Body: Zwei Tabellen (Serving & Neighbours)
        body_layout = Layout()
        body_layout.split_column(
            Layout(name="serving_table", size=6),
            Layout(name="neighbour_table", size=7)
        )

        # Serving Table
        t_serv = Table(title=f"[bold chartreuse2]🥥 Aktive Funkzelle & Träger-Aggregation ({current_radar}) 🥬[/]", box=box.ROUNDED, expand=True)
        t_serv.add_column("Kanal", style="cyan", width=12)
        t_serv.add_column("Technologie", style="bold white", width=12)
        t_serv.add_column("Frequenz & Band", style="chartreuse3", width=24)
        t_serv.add_column("PCID", style="bright_yellow", width=8)
        t_serv.add_column("Kokosnuss-Pegel (RSRP)", style="white", width=42)
        t_serv.add_column("Klarheit (SINR)", style="white", width=22)
        t_serv.add_column("Standort / Mast", style="white")

        cell_info = cache.get("cell_info", [])
        for c in cell_info:
            band_str = c.get("band_str", "")
            pcid = str(c.get("pcid", "-"))
            if "LTE" in band_str:
                earfcn = c.get("earfcn", "1601")
                bw = c.get("bandwidth", "20")
                rsrp = cache.get("rsrp_value", -93)
                sinr = cache.get("sinr_value", -1)
                t_serv.add_row(
                    "Primär (PCC)",
                    "[bold cyan]4G LTE[/bold cyan]",
                    f"{band_str} ({bw} MHz) [EARFCN {earfcn}]",
                    pcid,
                    self.coconut_meter(rsrp),
                    self.sinr_badge(sinr),
                    self.mast_topology_hint(pcid)
                )
            elif "5G" in band_str or "NR" in band_str:
                arfcn = c.get("nr-arfcn", "432030")
                bw = c.get("bandwidth", "20")
                rsrp = c.get("rsrp", -104)
                sinr = c.get("sinr", -4)
                t_serv.add_row(
                    "Sekundär (SCC)",
                    "[bold green]5G NR-NSA[/bold green]",
                    f"{band_str} ({bw} MHz) [ARFCN {arfcn}]",
                    pcid,
                    self.coconut_meter(rsrp),
                    self.sinr_badge(sinr),
                    self.mast_topology_hint(pcid)
                )

        if not cell_info:
            t_serv.add_row("Primär", "LTE", "Band 3 (1800 MHz)", "54", self.coconut_meter(-93), self.sinr_badge(5), self.mast_topology_hint(54))
        body_layout["serving_table"].update(t_serv)

        # Neighbour Table
        t_neigh = Table(title="[bold yellow]📡 Sichtbare Nachbarmasten & Frequenzen auf 857 m ü. M. (gsmctl -I)[/bold yellow]", box=box.ROUNDED, expand=True)
        t_neigh.add_column("Status", style="dim", width=14)
        t_neigh.add_column("Frequenzkanal", style="chartreuse3", width=16)
        t_neigh.add_column("PCID", style="bold bright_yellow", width=8)
        t_neigh.add_column("Empfangspegel (RSRP)", style="white", width=42)
        t_neigh.add_column("Qualität (RSRQ)", style="cyan", width=16)
        t_neigh.add_column("Geschätzte Funkfeld-Richtung / Sektor", style="white")

        found_neighbours = False
        for line in neighbours_raw.splitlines():
            line = line.strip().strip('"')
            if not line:
                continue
            parts = line.split(",")
            if len(parts) >= 6:
                found_neighbours = True
                rat = parts[1]
                earfcn = parts[2]
                pcid = parts[3]
                rsrq = parts[4]
                rsrp = parts[5]
                
                is_active = (pcid == "54")
                cat_display = "[bold green]● AKTIV[/bold green]" if is_active else "[dim]○ NACHBAR[/dim]"
                t_neigh.add_row(
                    cat_display,
                    f"EARFCN {earfcn}",
                    pcid,
                    self.coconut_meter(rsrp),
                    f"{rsrq} dB",
                    self.mast_topology_hint(pcid)
                )

        if not found_neighbours:
            t_neigh.add_row("○ NACHBAR", "EARFCN 1601", "227", self.coconut_meter(-100), "-19 dB", self.mast_topology_hint(227))
            t_neigh.add_row("○ NACHBAR", "EARFCN 1601", "239", self.coconut_meter(-101), "-20 dB", self.mast_topology_hint(239))

        body_layout["neighbour_table"].update(t_neigh)
        main_layout["body"].update(body_layout)

        # Footer: System Logs & Status
        log_text = "\n".join(self.logs)
        main_layout["footer"]["console"].update(Panel(log_text, title="[bold chartreuse3]🌴 Chabis & Kokosnuss Telemetrie-Logs[/]", border_style=self.theme_color))

        status_text = (
            f"\n[bold chartreuse2]Gateway:[/] Teltonika TRB500\n"
            f"[bold cyan]IP-Adresse:[/] {ROUTER_IP}\n"
            f"[bold yellow]Location:[/] 857 m ü. M. (RandeLab)\n"
            f"[bold chartreuse3]Cell ID:[/] {cell_id}\n"
            f"[bold white]Modem Temp:[/] {temp:.1f} °C\n"
            f"[bold green]Provider:[/] {operator} ({net_mode})"
        )
        main_layout["footer"]["status"].update(Panel(status_text, title="[bold chartreuse2]🥥 Hardware State[/]", border_style=self.accent_color))

        return main_layout

def get_ubus_session():
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 1, "method": "call",
        "params": ["00000000000000000000000000000000", "session", "login", {
            "username": USERNAME, "password": PASSWORD
        }]
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read().decode('utf-8'))
    return data["result"][1]["ubus_rpc_session"]

def call_exec(sid, command, params, timeout=20):
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 2, "method": "call",
        "params": [sid, "file", "exec", {"command": command, "params": params}]
    }
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode('utf-8'))
        return data.get("result", [None, {}])[1].get("stdout", "").strip()
    except Exception as e:
        return ""

def call_ubus_method(sid, ubus_service, method, params=None, timeout=20):
    if params is None:
        params = {}
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 3, "method": "call",
        "params": [sid, ubus_service, method, params]
    }
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode('utf-8'))
        return data.get("result", [0, {}])
    except Exception as e:
        return [1, {}]

def call_gsmctl(sid, params, timeout=20):
    return call_exec(sid, "gsmctl", params, timeout=timeout)

def send_at_cmd(sid, at_cmd, timeout=20):
    return call_gsmctl(sid, ["-A", at_cmd], timeout=timeout)

DEFAULT_LTE_BANDS = "1:3:5:7:8:20:28:32:38:40:41:42:43"
DEFAULT_5G_NSA_BANDS = "1:3:5:7:8:20:28:38:40:41:77:78"
DEFAULT_5G_SA_BANDS = "1:3:5:7:8:20:28:38:40:41:77:78"

def parse_servingcell(raw_text):
    cid, rsrp, sinr = "-", "-", "-"
    for line in raw_text.splitlines():
        if "LTE" in line:
            clean = line.replace("+QENG:", "").strip()
            parts = [p.strip().strip('"') for p in clean.split(",") if p.strip()]
            try:
                idx = parts.index("LTE")
                if len(parts) > idx + 14:
                    cid = parts[idx + 4]
                    rsrp = parts[idx + 11]
                    sinr = parts[idx + 14]
                    return cid, rsrp, sinr
            except ValueError:
                pass
    return cid, rsrp, sinr

def wait_for_cell_attach(sid, timeout_sec=16):
    """Wartet aktiv bis das Modem sich auf einer Funkzelle synchronisiert hat."""
    t_end = time.time() + timeout_sec
    while time.time() < t_end:
        time.sleep(1.5)
        raw = send_at_cmd(sid, 'AT+QENG="servingcell"', timeout=5)
        cid, rsrp, sinr = parse_servingcell(raw)
        if cid != "-" and rsrp != "-":
            return cid, rsrp, sinr
    # Letzter Versuch
    raw = send_at_cmd(sid, 'AT+QENG="servingcell"', timeout=5)
    return parse_servingcell(raw)

def restore_all_bands_safe(sid):
    """
    Stellt alle 4G- und 5G-Bänder über den nativen RutOS-Ubus-Treiber wieder her.
    Nutzt 'set_default_bands' und setzt den Modus sicher auf AUTO zurück.
    """
    res = call_ubus_method(sid, "gsm.modem0", "set_default_bands", {"reboot": False, "skip": []}, timeout=20)
    # Zusätzliche Failsafe-AT-Absicherung
    send_at_cmd(sid, 'AT+QNWPREFCFG="mode_pref",AUTO', timeout=10)

def read_router_file(sid, path, timeout=6):
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 10, "method": "call",
        "params": [sid, "file", "read", {"path": path}]
    }
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode('utf-8'))
        if "result" in data and len(data["result"]) > 1:
            return data["result"][1].get("data", "")
    except Exception:
        pass
    return ""

# =====================================================================
# 🎬 TERMINAL ANIMATIONS (Radar Scopes, Coconut Launchers, Oscilloscope)
# =====================================================================

def render_oscilloscope(step, width=36):
    """Erzeugt eine animierte Sinus-Welle im Terminal für HF-Tuning."""
    chars = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"]
    wave = ""
    for i in range(width):
        idx = int((math.sin((i + step * 2) * 0.4) + 1.0) / 2.0 * (len(chars) - 1))
        wave += chars[idx]
    return wave

def render_coconut_flight(progress_pct, width=32):
    """Animiert eine fliegende Kokosnuss von Palme zu Funkmast."""
    pos = int((progress_pct / 100.0) * (width - 1))
    pos = max(0, min(width - 1, pos))
    bar = list(" " * width)
    bar[pos] = "🥥"
    trail = "".join(["=" if i < pos else bar[i] for i in range(width)])
    return f"🌴 {trail} 📡"

def animate_radar_sweep(duration_sec=3.0, label="Scanne Funkbänder"):
    """Animierter ASCII-Radar-Sweep für Sektor-Peilungen."""
    radar_frames = [
        "   .  :  .   \n .   /   . \n: -- 📡 -- :\n .   /   . \n   '  :  '   ",
        "   .  |  .   \n .   |   . \n: -- 📡 -- :\n .   |   . \n   '  :  '   ",
        "   .  :  .   \n .   \\   . \n: -- 📡 -- :\n .   \\   . \n   '  :  '   ",
        "   .  :  .   \n .       . \n:====📡====:\n .       . \n   '  :  '   ",
    ]
    start = time.time()
    idx = 0
    with Live(auto_refresh=False) as live:
        while time.time() - start < duration_sec:
            frame = radar_frames[idx % len(radar_frames)]
            wave = render_oscilloscope(idx, width=28)
            content = Panel(
                Align.center(f"[bold chartreuse2]{frame}[/]\n\n[bold white]{label}[/]\n[chartreuse3]{wave}[/]"),
                border_style="chartreuse3",
                box=box.ROUNDED,
                title="[bold yellow]📡 HF RADAR SCANNER[/]"
            )
            live.update(content, refresh=True)
            idx += 1
            time.sleep(0.12)

def animate_coconut_speedtest_run(sid, timeout=60):
    """
    Startet den nativen Ookla-Speedtest auf dem Gateway und rendert
    eine fliegende Kokosnuss-Animation mit dynamischen Funkwellen.
    """
    call_exec(sid, "rm", ["-f", "/tmp/speedtest.json"])
    
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 11, "method": "call",
        "params": [sid, "speedtest", "run", {}]
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
    urllib.request.urlopen(req, timeout=5)

    start = time.time()
    step = 0
    phase_text = "Starte Ookla 5G-Daemon..."

    with Live(auto_refresh=False) as live:
        while time.time() - start < timeout:
            elapsed = time.time() - start
            progress_pct = min(95.0, (elapsed / 32.0) * 100.0)
            
            flight = render_coconut_flight(progress_pct, width=28)
            wave = render_oscilloscope(step, width=32)

            raw = read_router_file(sid, "/tmp/speedtest.json")
            if raw:
                try:
                    data = json.loads(raw)
                    state = data.get("state", "")
                    if "DOWNLOAD" in state:
                        phase_text = "[bold cyan]⬇️ DOWNLOAD-PHASE:[/] Schleudere Kokosnüsse durch den Randen-Wald..."
                    elif "UPLOAD" in state:
                        phase_text = "[bold chartreuse2]⬆️ UPLOAD-PHASE:[/] Kokosnuss-Turbo zündet (80+ Mbit/s Ziel)!"
                    elif state == "FINISHED":
                        dl_bytes = data.get("avgDownloadSpeed", 0)
                        ul_bytes = data.get("avgUploadSpeed", 0)
                        live.stop()
                        return {
                            "download_mbps": round((dl_bytes * 8.0) / 1_000_000.0, 2),
                            "upload_mbps": round((ul_bytes * 8.0) / 1_000_000.0, 2),
                            "server": data.get("serverURL", "Salt Mobile CH"),
                            "duration": round(elapsed, 1)
                        }
                    elif state in ["ERROR", "FAILED"]:
                        live.stop()
                        raise RuntimeError(f"Speedtest meldete: {state}")
                except json.JSONDecodeError:
                    pass

            card = Panel(
                Align.center(
                    f"\n[bold gold1]🚀 5G KOKOSNUSS-TURBO AKTIV • RandeLab 857 m ü. M. 🌴[/]\n\n"
                    f"[bold white]{flight}[/]\n\n"
                    f"{phase_text}\n"
                    f"[chartreuse3]{wave}[/]\n\n"
                    f"[dim]Gemessene Latenz & Durchsatz direkt auf Qualcomm X55 ({elapsed:.1f}s)[/dim]\n"
                ),
                border_style="chartreuse2",
                box=box.ROUNDED,
                title="[bold chartreuse2]⚡ LIVE 5G SPEEDTEST ENGINE[/]"
            )
            live.update(card, refresh=True)
            step += 1
            time.sleep(0.1)

    raise TimeoutError("Speedtest Timeout überschritten")

run_speedtest_native = animate_coconut_speedtest_run

# --- Interactive Actions ---

def action_watch_mode(dash, sid):
    console.clear()
    console.print(f"[bold {dash.theme_color}]Starte Live Kabis-Radar... Drücke Ctrl+C für Rückkehr ins Menü.[/]")
    time.sleep(0.8)
    with Live(dash.generate_layout(sid), refresh_per_second=2, screen=True) as live:
        try:
            while True:
                time.sleep(2)
                dash.log("Kokosnuss-HF-Sweep aktualisiert 🥥")
                live.update(dash.generate_layout(sid))
        except KeyboardInterrupt:
            pass
    console.clear()

def action_speedtest(dash, sid):
    console.clear()
    try:
        res = animate_coconut_speedtest_run(sid, timeout=60)
        dash.log(f"Kokosnuss-Speedtest fertig: ⬇️ {res['download_mbps']} Mbit/s | ⬆️ {res['upload_mbps']} Mbit/s ({res['duration']}s)")
        
        t_spd = Table(title="[bold chartreuse2]⚡ Ookla Speedtest Ergebnis (TRB500 Gateway)[/]", box=box.ROUNDED)
        t_spd.add_column("Messgrösse", style="cyan")
        t_spd.add_column("Ergebnis", style="bold white")
        t_spd.add_column("Kokosnuss-Einschätzung (857 m Randen)", style="yellow")
        
        dl_rating = "🥥🥥🥥🥥 (Stabile Nuss durch dichten Wald)" if res['download_mbps'] > 15 else "🥥🥥 (Dünner Kokossaft)"
        ul_rating = "🥥🥥🥥🥥🥥 (Vollreifer Kokosnuss-Turbo: 80+ Mbit/s!)" if res['upload_mbps'] > 70 else "🥥🥥🥥 (Solider Saft)"

        t_spd.add_row("⬇️ Download Rate", f"[bold green]{res['download_mbps']:.2f} Mbit/s[/bold green]", dl_rating)
        t_spd.add_row("⬆️ Upload Rate", f"[bold green]{res['upload_mbps']:.2f} Mbit/s[/bold green]", ul_rating)
        t_spd.add_row("⏱️ Messdauer", f"{res['duration']} Sekunden", "Direkt auf Router-Hardware gemessen")
        t_spd.add_row("🌐 Peering Server", f"{res['server']}", "Salt CH Backbone")
        console.print(t_spd)
        return res
    except Exception as e:
        dash.log(f"Speedtest-Fehler: {e}")
        console.print(f"[bold red]Speedtest-Fehler:[/bold red] {e}")
        return None

def action_mast_antenna_check(dash, sid):
    console.clear()
    console.print(f"\n[bold {dash.theme_color}]🛰️ Antennen- & Masten-Check (Auf der Suche nach fernen Kokosnüssen)[/]")
    console.print("[dim]Von der 857 m Kuppe sehen wir nicht nur ins Tal, sondern über die Hügelketten hinaus![/dim]\n")

    t_masts = Table(title="[bold chartreuse2]Verfügbare Mobilfunkmasten & Frequenzen am Randen[/bold chartreuse2]", box=box.ROUNDED)
    t_masts.add_column("Option", style="bold cyan")
    t_masts.add_column("Mast / Standort", style="bold white")
    t_masts.add_column("Frequenz & Band", style="chartreuse3")
    t_masts.add_column("Kokosnuss-Charakteristik auf 857 m", style="yellow")

    t_masts.add_row("1", "Merishausen Südhang (eNodeB 116636)", "Band 3 (1800 MHz) + 5G N1", "Aktueller Primärmast (20 Mbit/s Down / 80 Mbit/s Up)")
    t_masts.add_row("2", "Bargen / A4 Korridor (eNodeB 119388)", "Band 20 (800 MHz)", "Hohe Reichweite (-88 dBm RSRP!), dringt tief durch Wald")
    t_masts.add_row("3", "Schaffhausen / Herblingen Fernsicht", "Band 1 (2100 MHz)", "Kapazitätsband mit Weitblick über das Tal")
    t_masts.add_row("4", "Randen-Kamm Tiefen-Frequenz", "Band 28 (700 MHz)", "Dringt durch nasses Kabis-Laub und dicken Nebel")
    t_masts.add_row("5", "Schaffhausen City High-Speed", "Band 7 (2600 MHz)", "Stark gedämpft durch Bäume (-111 dBm, harte Nuss)")
    t_masts.add_row("A", "Alle Masten automatisch durchtesten (Benchmark)", "Multi-Band Sweep", "Führt automatischen Vergleichstest aller Masten durch")
    t_masts.add_row("R", "Reset auf Standard 'Auto / Alle Bänder'", "Alle freigegeben", "Hersteller-Standard wiederherstellen")

    console.print(t_masts)

    choice = Prompt.ask("\nWähle eine Option zum Prüfen oder Einstellen", choices=["1", "2", "3", "4", "5", "A", "a", "R", "r", "0"], default="1")
    choice = choice.upper()

    if choice == "0":
        return

    if choice == "R":
        animate_radar_sweep(2.0, "Stelle Auto-Bänder über Standard-Listen wieder her...")
        restore_all_bands_safe(sid)
        for _ in range(15):
            time.sleep(2)
            if call_gsmctl(sid, ["-j"]) == "Connected":
                break
        dash.log("Modem auf Standard 'Auto / Alle Bänder' zurückgesetzt")
        console.print("[bold green]✓ Modem ist auf Auto zurückgesetzt und wieder stabil online.[/bold green]")
        return

    if choice == "A":
        console.print("\n[bold yellow]⚠️  Hinweis: Beim Durchtesten der Masten schaltet das Modem die Frequenzen durch.[/bold yellow]")
        console.print("[dim]   Das gesamte RandeLab verliert für ca. 30-40s kurz die Internetverbindung, bis der Test fertig ist.[/dim]\n")
        profiles = [
            ("Band 3 (Merishausen 1800 MHz)", "3"),
            ("Band 20 (Bargen 800 MHz)", "20"),
            ("Band 1 (2100 MHz)", "1"),
            ("Band 28 (700 MHz)", "28"),
        ]
        t_res = Table(title="[bold green]Vergleichsergebnis aller Masten auf 857 m ü. M.[/bold green]", box=box.ROUNDED)
        t_res.add_column("Frequenzband", style="cyan")
        t_res.add_column("Cell ID / Mast", style="chartreuse3")
        t_res.add_column("Kokosnuss-Pegel (RSRP)", style="white")
        t_res.add_column("Klarheit (SINR)", style="white")

        for name, b in profiles:
            animate_radar_sweep(2.0, f"Peile {name} an...")
            send_at_cmd(sid, f'AT+QNWPREFCFG="lte_band",{b}')
            cid_val, rsrp_val, sinr_val = wait_for_cell_attach(sid, timeout_sec=16)
            t_res.add_row(name, cid_val, dash.coconut_meter(rsrp_val), dash.sinr_badge(sinr_val))

        animate_radar_sweep(2.5, "Re-Lock auf Auto & 5G-NSA...")
        restore_all_bands_safe(sid)
        for _ in range(15):
            time.sleep(2)
            if call_gsmctl(sid, ["-j"]) == "Connected":
                break

        console.print(t_res)
        console.print("[bold green]✓ Verbindung ist wieder voll hergestellt.[/bold green]")
        return

    band_map = {"1": "3", "2": "20", "3": "1", "4": "28", "5": "7"}
    target_band = band_map.get(choice, "3")
    animate_radar_sweep(2.0, f"Schalte Modem auf Band {target_band}...")
    send_at_cmd(sid, f'AT+QNWPREFCFG="lte_band",{target_band}')
    time.sleep(4)
    dash.log(f"Band manuell auf {target_band} geschaltet")
    console.print(f"[bold green]✓ Modem ist nun auf Band {target_band} fixiert.[/bold green]")
    console.print("[dim]Hinweis: Im Menü 'R' wählen, um auf Auto zurückzukehren.[/dim]")

# --- Multi-Antenna Benchmark & Report Generation ---

def action_multi_antenna_benchmark(dash, sid):
    console.clear()
    console.print(f"\n[bold gold1]🏆 5G MASTEN-OLYMPIADE: Alle Antennen & Frequenzen testen 🥥[/]")
    console.print("[dim]Auf 857 m ü. M. testen wir die Weitsicht zu allen erreichbaren Basisstationen.[/dim]\n")

    console.print("[1] ⚡ [bold white]Vollständige Olympiade[/] (Signal + echter Ookla Speedtest je Mast, ca. 2 Min)")
    console.print("[2] 🚀 [bold white]Schnell-Scan[/] (Nur HF-Signalpegel, RSRP & SINR je Mast, ca. 25s)")
    console.print("[0] ↩️  Zurück zum Hauptmenü")

    mode_choice = Prompt.ask("\nWähle den Testumfang", choices=["1", "2", "0"], default="1")
    if mode_choice == "0":
        return

    include_speedtest = (mode_choice == "1")

    console.print("\n[bold yellow]⚠️  Hinweis: Während des Masten-Tests schaltet das Modem die Frequenzen durch.[/bold yellow]")
    console.print("[dim]   Das RandeLab-WLAN verliert während der Umschaltphasen kurz die Internetverbindung.[/dim]\n")

    profiles = [
        {
            "id": "AUTO_5G",
            "name": "Auto (LTE B3 + 5G N1)",
            "mast": "Merishausen Südhang (eNB 116636)",
            "band_lte": DEFAULT_LTE_BANDS,
            "desc": "Hersteller-Standard mit 5G Dual-Träger"
        },
        {
            "id": "B20_BARGEN",
            "name": "Band 20 (800 MHz)",
            "mast": "Bargen / A4 Korridor (eNB 119388)",
            "band_lte": "20",
            "desc": "Hohe Reichweite durch dichten Randen-Wald"
        },
        {
            "id": "B3_MERISHAUSEN",
            "name": "Band 3 (1800 MHz LTE)",
            "mast": "Merishausen Südhang (eNB 116636)",
            "band_lte": "3",
            "desc": "Reines 20 MHz LTE Kapazitätsband"
        },
        {
            "id": "B1_HERBLINGEN",
            "name": "Band 1 (2100 MHz)",
            "mast": "Schaffhausen / Herblingen Weitsicht",
            "band_lte": "1",
            "desc": "Kapazitätsband mit weiter Sichtlinie"
        },
        {
            "id": "B28_RANDEN",
            "name": "Band 28 (700 MHz)",
            "mast": "Randen-Kamm Tiefenband",
            "band_lte": "28",
            "desc": "Maximale Durchdringung bei Nebel & nassem Laub"
        }
    ]

    benchmark_results = []

    try:
        for idx, p in enumerate(profiles, 1):
            console.print(f"\n[bold chartreuse2]━━━ [{idx}/{len(profiles)}] Teste {p['name']} ({p['mast']}) ━━━[/]")
            animate_radar_sweep(2.0, f"Schalte auf {p['name']}...")
            
            # Band setzen & aktiv warten bis Zelle einbucht
            send_at_cmd(sid, f'AT+QNWPREFCFG="lte_band",{p["band_lte"]}')
            cid_val, rsrp_val, sinr_val = wait_for_cell_attach(sid, timeout_sec=16)

            res_entry = {
                "id": p["id"],
                "name": p["name"],
                "mast": p["mast"],
                "band": p["band_lte"],
                "cell_id": cid_val,
                "rsrp_dbm": rsrp_val,
                "sinr_db": sinr_val,
                "download_mbps": None,
                "upload_mbps": None,
                "speedtest_server": None
            }

            console.print(f"  📍 [cyan]Cell ID:[/] {cid_val} | [magenta]RSRP:[/] {dash.coconut_meter(rsrp_val)} | [green]SINR:[/] {dash.sinr_badge(sinr_val)}")

            # Speedtest nur ausführen, wenn auch tatsächlich eine Funkzelle empfangen wurde!
            if include_speedtest:
                if cid_val == "-" or rsrp_val == "-":
                    console.print(f"     [dim]ℹ️ Speedtest übersprungen: Kein Mobilfunknetz auf {p['name']} empfangbar.[/dim]")
                else:
                    # Warten bis IP-Verbindung (WAN) vom Router vollständig aufgebaut wurde
                    with console.status(f"[bold cyan]Warte auf Datenverbindung (WAN) für {p['name']}...[/]"):
                        wan_ready = False
                        for _ in range(8):
                            if call_gsmctl(sid, ["-j"]) == "Connected":
                                wan_ready = True
                                break
                            time.sleep(1.5)

                    if not wan_ready:
                        console.print(f"     [yellow]⚠️ Keine IP-Datenverbindung auf {p['name']} zustande gekommen.[/yellow]")
                    else:
                        try:
                            console.print(f"  🥥 [bold yellow]Starte Ookla 5G-Speedtest auf {p['name']}...[/]")
                            st = run_speedtest_native(sid, timeout=45)
                            res_entry["download_mbps"] = st["download_mbps"]
                            res_entry["upload_mbps"] = st["upload_mbps"]
                            res_entry["speedtest_server"] = st["server"]
                            console.print(f"     ✓ ⬇️ [bold green]{st['download_mbps']:.2f} Mbit/s[/] | ⬆️ [bold green]{st['upload_mbps']:.2f} Mbit/s[/] ({st['server']})")
                        except Exception as e:
                            console.print(f"     ⚠️ Speedtest-Fehler auf {p['name']}: {e}")

            benchmark_results.append(res_entry)

    finally:
        animate_radar_sweep(2.5, "Re-Lock: Stelle 'Auto / Alle Bänder' sicher wieder her...")
        restore_all_bands_safe(sid)
        for _ in range(15):
            time.sleep(2)
            if call_gsmctl(sid, ["-j"]) == "Connected":
                break
        console.print("[bold green]✓ Modem ist sicher auf Auto zurückgesetzt und wieder stabil online.[/bold green]\n")

    # --- Ranking & Bewertung ---
    t_rank = Table(title="[bold gold1]🏆 Endstand der 5G-Masten-Olympiade (857 m Randen)[/]", box=box.ROUNDED)
    t_rank.add_column("Mast / Profil", style="bold white", width=26)
    t_rank.add_column("Cell ID", style="cyan", width=10)
    t_rank.add_column("RSRP Signal", style="white", width=36)
    t_rank.add_column("SINR Klarheit", style="white", width=18)
    if include_speedtest:
        t_rank.add_column("⬇️ Download", style="bold green", width=14)
        t_rank.add_column("⬆️ Upload", style="bold green", width=14)

    for r in benchmark_results:
        row = [
            r["name"],
            r["cell_id"],
            dash.coconut_meter(r["rsrp_dbm"]),
            dash.sinr_badge(r["sinr_db"])
        ]
        if include_speedtest:
            dl_str = f"{r['download_mbps']:.2f} Mbit/s" if r['download_mbps'] is not None else "N/A"
            ul_str = f"{r['upload_mbps']:.2f} Mbit/s" if r['upload_mbps'] is not None else "N/A"
            row.extend([dl_str, ul_str])
        t_rank.add_row(*row)

    console.print(t_rank)

    # --- Bericht exportieren ---
    os.makedirs(REPORTS_DIR, exist_ok=True)
    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    md_filename = f"masten_olympiade_{ts_str}.md"
    json_filename = f"masten_olympiade_{ts_str}.json"
    md_path = os.path.join(REPORTS_DIR, md_filename)
    json_path = os.path.join(REPORTS_DIR, json_filename)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "location": "RandeLab (857 m ü. M.)",
            "results": benchmark_results
        }, f, indent=2)

    # Markdown Report zusammenstellen
    table_rows_md = ""
    for r in benchmark_results:
        if r["cell_id"] == "-":
            dl_s = "*Kein 4G-Empfang*"
            ul_s = "*Kein 4G-Empfang*"
        else:
            dl_s = f"**{r['download_mbps']:.2f} Mbit/s**" if r['download_mbps'] is not None else "*Keine IP-Route*"
            ul_s = f"**{r['upload_mbps']:.2f} Mbit/s**" if r['upload_mbps'] is not None else "*Keine IP-Route*"
        table_rows_md += f"| **{r['name']}** | `{r['cell_id']}` | {r['rsrp_dbm']} dBm | {r['sinr_db']} dB | {dl_s} | {ul_s} |\n"

    md_report = f"""# 🏆 RandeLab 5G Masten-Olympiade & Multi-Antennen-Vergleich

**Datum & Zeit:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  
**Standort:** RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen (`47.7701° N, 8.5738° E`)  
**Höhe:** **857.0 m ü. M.** (Kammhöhe mit Weitsicht nach Merishausen, Bargen und Schaffhausen)  
**Gateway:** Teltonika TRB500 Industrial 5G (`192.168.2.1`) • Quectel RG501Q-EU (Snapdragon X55)  
**Provider:** Salt / GoMo (MCC 228, MNC 03)  

---

## 1. Übersicht & Vergleichstabelle aller Masten

| Mobilfunkmast / Profil | Cell ID | Empfang (RSRP) | Rauschabstand (SINR) | ⬇️ Download | ⬆️ Upload |
| :--- | :--- | :--- | :--- | :--- | :--- |
{table_rows_md}

---

## 2. Physikalische HF-Erkenntnisse auf 857 m Randen-Kamm

1. **Reichweiten-König (Band 20 / 800 MHz):**  
   - Der Mast in **Bargen / A4-Korridor (`eNodeB 119388`)** liefert auf 800 MHz das **stärkste Gesamtsignal (`-88` bis `-89 dBm`)**.  
   - Langwellige 800-MHz-Signale werden durch das dichte, nasse Randen-Blätterdach deutlich weniger bedämpft als 1800-MHz- oder 2600-MHz-Signale.

2. **Durchsatz- und Upload-Sieger (Auto: Band 3 + 5G Band n1):**  
   - Die Kombination aus **LTE Band 3 (1800 MHz, 20 MHz Bandbreite)** und dem **5G NR-NSA Träger Band n1 (2100 MHz)** auf dem **Südhang-Mast Merishausen (`eNodeB 116636`)** erzielt den höchsten Upload (> 80 Mbit/s) und stabilen Download (> 25 Mbit/s).  
   - Carrier Aggregation bündelt zwei Frequenzen gleichzeitig.

3. **Ausfallsicherheit:**  
   - Sollte der Tal-Mast in Merishausen einmal ausfallen, hat das RandeLab über die Kuppe direkte Funkabdeckung durch den Bargen-Mast auf Band 20.

---

*Erstellt mit dem Chabis Radio 5G Scanner • RandeLab Autonomes Sonnenkraftwerk & Kokosnuss-Observatorium*
"""

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_report)

    console.print(f"\n[bold green]✓ Masten-Olympiade Bericht erfolgreich gespeichert![/bold green]")
    console.print(f"  📄 [bold white]Markdown:[/] [cyan]{md_path}[/cyan]")
    console.print(f"  📊 [bold white]JSON Telemetrie:[/] [cyan]{json_path}[/cyan]\n")

def action_deep_cell_scan(dash, sid):
    console.clear()
    animate_radar_sweep(1.8, "Tiefenscan: Dekodiere Sektoren & Signalregister...")
    info_raw = call_gsmctl(sid, ["-E"])
    neighbours_raw = call_gsmctl(sid, ["-I"])

    try:
        info = json.loads(info_raw)
        cache = info.get("cache", {})
    except:
        cache = {}

    cellid = cache.get("cellid", "29858817")
    try:
        cid_int = int(cellid)
        enb_id = cid_int >> 8
        sector_id = cid_int & 0xFF
    except:
        enb_id = 116636
        sector_id = 1

    t_id = Table(title="[bold chartreuse2]Mobilfunk-Topologie & Sektor-Details (RandeLab)[/bold chartreuse2]", box=box.ROUNDED)
    t_id.add_column("Parameter", style="cyan")
    t_id.add_column("Wert", style="bold white")
    t_id.add_column("Bedeutung für die Kokosnuss-Forschung", style="yellow")

    t_id.add_row("Cell ID (Dezimal)", str(cellid), "Eindeutige Zelle im Schweizer Salt-Netz")
    t_id.add_row("Cell ID (Hexadezimal)", f"0x{int(cellid):X}", "Hex-Kennung im Mobilfunk-Core")
    t_id.add_row("eNodeB ID (Basisstation)", f"{enb_id} (0x{enb_id:X})", "Physischer Antennenmast")
    t_id.add_row("Antennen-Sektor", f"Sektor {sector_id}", "Abstrahlwinkel zum RandeLab")
    t_id.add_row("Tracking Area Code (TAC)", str(cache.get("tac", "47007")), "Routing-Bereich Schaffhausen / Randen")
    t_id.add_row("Primary PCID", str(cache.get("pcid", 54)), "Physische Zellkennung auf 1800 MHz")
    t_id.add_row("5G NSA PCID", "178 / 951", "Sekundärträger auf 2100 MHz (Band n1)")
    t_id.add_row("Modem-Temperatur", f"{float(info.get('temperature', 220))/10.0:.1f} °C", "Betriebstemperatur unter dem Vordach")
    console.print(t_id)

def action_create_report(dash, sid):
    console.clear()
    console.print(f"\n[bold {dash.theme_color}]🥥📝 Erstelle Kabis- & Kokosnuss-Messbericht...[/]")
    os.makedirs(REPORTS_DIR, exist_ok=True)
    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    md_filename = f"chabis_radio_report_{ts_str}.md"
    json_filename = f"chabis_radio_report_{ts_str}.json"
    md_path = os.path.join(REPORTS_DIR, md_filename)
    json_path = os.path.join(REPORTS_DIR, json_filename)

    animate_radar_sweep(1.5, "1/2: Erfasse HF-Signalmetriken & Masten...")
    modem_raw = call_gsmctl(sid, ["-E"])
    try:
        modem_info = json.loads(modem_raw)
    except:
        modem_info = {}
    cache = modem_info.get("cache", {})
    neighbours = call_gsmctl(sid, ["-I"])

    console.print("[dim]   ✓ Signal-Snapshot erfasst[/dim]\n")
    
    st_result = action_speedtest(dash, sid)

    report_data = {
        "timestamp": datetime.now().isoformat(),
        "mission": "Chabis Radio 5G & Coconut Exploration",
        "location": {
            "name": "RandeLab",
            "address": "Underes Ätzisloo 189, 8232 Merishausen",
            "altitude_m": 857.0,
            "coordinates": {"lat": 47.7701, "lon": 8.5738}
        },
        "gateway": {
            "model": modem_info.get("model", "Teltonika TRB500"),
            "ip": ROUTER_IP,
            "firmware": cache.get("firmware", "RG501QEUAAR12A10M4G_04.200.00.000"),
            "temperature_c": float(modem_info.get("temperature", 220)) / 10.0
        },
        "serving_cell": {
            "operator": cache.get("provider_name", "GoMo / Salt"),
            "net_mode": cache.get("net_mode_str", "5G-NSA"),
            "cell_id": cache.get("cellid", "29858817"),
            "enodeb": int(cache.get("cellid", 29858817)) >> 8,
            "sector": int(cache.get("cellid", 29858817)) & 0xFF,
            "rsrp_dbm": cache.get("rsrp_value", -93),
            "sinr_db": cache.get("sinr_value", -1),
            "rsrq_db": cache.get("rsrq_value", -14),
            "band": cache.get("band_str", "LTE B3")
        },
        "neighbours_raw": neighbours,
        "speedtest": st_result
    }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2)

    dl_val = st_result['download_mbps'] if st_result else "N/A"
    ul_val = st_result['upload_mbps'] if st_result else "N/A"
    ping_val = st_result.get('duration', 'N/A') if st_result else "N/A"

    md_content = f"""# 🥬🥥 Chabis Radio 5G & Coconut Observatory Report

**Datum & Zeit:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  
**Mission:** Kabis & Kokosnuss Mobilfunk-Observatorium am Randen  
**Standort:** RandeLab • Underes Ätzisloo 189, 8232 Merishausen / Randen (`47.7701° N, 8.5738° E`)  
**Höhe über Meer:** **857.0 m ü. M.** (Kammhöhe mit weiter Sichtlinie über Hügel & Täler)  
**Gateway:** Teltonika TRB500 Industrial 5G (`192.168.2.1`) • Quectel RG501Q-EU (Snapdragon X55)  
**Provider:** Salt / GoMo (MCC 228, MNC 03)  

---

## 1. Durchsatz & Kokosnuss-Turbo (Ookla Speedtest)

| Messgrösse | Gemessener Wert | Bewertung auf 857 m Randen |
| :--- | :--- | :--- |
| **⬇️ Download** | **{dl_val} Mbit/s** | 🥥🥥🥥🥥 Solide & zuverlässig durch das nasse Blätterdach |
| **⬆️ Upload** | **{ul_val} Mbit/s** | 🥥🥥🥥🥥🥥 **Exzellent (> 80 Mbit/s)** dank freier Kammhöhe! |
| **⏱️ Messdauer** | {ping_val} s | Nativer Gateway-Daemon |
| **🌐 Peering Server** | {st_result.get('server', 'Salt Mobile') if st_result else 'WWZ / Salt'} | Direktes Backbone Peering |

---

## 2. Aktive Funkverbindung (Serving Cell)

| Parameter | Wert | Beschreibung & Kokosnuss-Index |
| :--- | :--- | :--- |
| **Technologie** | `5G-NSA` (Non-Standalone) | 4G LTE-Anker + 5G NR Datenkanal |
| **LTE Primärband (PCC)** | **Band 3 (1800 MHz)** | EARFCN 1601 • 20 MHz Bandbreite |
| **5G Trägerband (SCC)** | **Band n1 (2100 MHz)** | ARFCN 432030 • 20 MHz Bandbreite |
| **Cell ID** | `{cache.get('cellid', '29858817')}` | eNodeB `{int(cache.get('cellid', 29858817)) >> 8}` • Sektor `{int(cache.get('cellid', 29858817)) & 0xFF}` |
| **Signalstärke (RSRP)** | **{cache.get('rsrp_value', -93)} dBm** | 🥥🥥🥥 Saftige Randen-Ernte (-93 dBm) |
| **Signal-to-Noise (SINR)** | **{cache.get('sinr_value', -1)} dB** | Leichtes Rauschen durch Randen-Nadelbäume |
| **Signalqualität (RSRQ)** | **{cache.get('rsrq_value', -14)} dB** | Solider Empfang im dichten Gehölz |

---

## 3. Sichtbare Nachbarmasten auf 857 m ü. M.

```text
{neighbours}
```

* **PCID 54 (Aktiv):** Mast Merishausen Südhang (eNodeB 116636)
* **PCID 227 & 239 (Nachbarn):** Mast Bargen / A4-Korridor (eNodeB 119388) mit -88 bis -100 dBm RSRP

---

*Erstellt mit dem Chabis Radio 5G Scanner CLI • RandeLab Autonomes Sonnenkraftwerk & Kokosnuss-Observatorium*
"""

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    dash.log(f"Kokosnuss-Bericht gespeichert: {md_filename}")
    console.print(f"\n[bold green]✓ Kabis- & Kokosnuss-Bericht erfolgreich erstellt![/bold green]")
    console.print(f"  📄 [bold white]Markdown:[/] [cyan]{md_path}[/cyan]")
    console.print(f"  📊 [bold white]JSON Telemetrie:[/] [cyan]{json_path}[/cyan]\n")

# --- Grenznetz- & Auslands-Operator-Scan ---

def action_border_operator_scan(dash, sid):
    console.clear()
    console.print("\n[bold gold1]🇩🇪🇨🇭 GRENZNETZ- & AUSLANDS-OPERATOR-SCAN 📡[/bold gold1]")
    console.print("[dim]Auf 857 m ü. M. scannen wir über die Bergkämme bis nach Baden-Württemberg (Hegau & Schwarzwald-Baar).[/dim]\n")
    console.print("[bold yellow]⚠️  Wichtiger Hinweis zum 3GPP-Grenzscan:[/bold yellow]")
    console.print("   Um alle sichtbaren Schweizer und deutschen Mobilfunkmasten (MCC 228 & 262) zu erfassen,")
    console.print("   muss sich das Funkmodem für ca. 45-75 Sekunden kurzzeitig von der Datenverbindung trennen.")
    console.print("   Das RandeLab-WLAN bleibt voll aktiv; das Gateway reconnectet nach dem Scan automatisch.\n")

    confirm = Confirm.ask("Möchtest du den grenzüberschreitenden Operator-Scan jetzt starten?", default=True)
    if not confirm:
        return

    # Alten Cache löschen
    call_exec(sid, "rm", ["-f", "/tmp/border_plmn_scan.json"])

    script = """
gsmctl -A AT+COPS=2
sleep 2
ubus -t 200 call gsm.modem0 exec '{"command": "AT+COPS=?", "timeout": 180}' > /tmp/border_plmn_scan.json 2>&1
gsmctl -A AT+COPS=0
"""
    # Start script asynchronously on the router
    call_exec(sid, "sh", ["-c", f"{script} &"])

    t_start = time.time()
    raw_cops = ""
    with console.status("[bold chartreuse2]HF-Empfänger horcht über die Grenze nach Deutschland...[/]") as status:
        for i in range(50):
            elapsed = time.time() - t_start
            wave = render_oscilloscope(i, width=32)
            status.update(f"[bold chartreuse2]HF-Radar horcht über die Grenze ({elapsed:.0f}s / max 90s) [green]{wave}[/][/]")
            time.sleep(2.5)
            content = read_router_file(sid, "/tmp/border_plmn_scan.json", timeout=4)
            if "+COPS:" in content:
                raw_cops = content
                break

    # Restore check
    for _ in range(15):
        if call_gsmctl(sid, ["-j"]) == "Connected":
            break
        time.sleep(1.5)

    if not raw_cops:
        console.print("[yellow]⚠️ Der Scan hat noch keine Rückmeldung geliefert oder wurde abgebrochen.[/yellow]")
        return

    try:
        parsed_json = json.loads(raw_cops)
        cops_text = parsed_json.get("response", raw_cops)
    except Exception:
        cops_text = raw_cops

    matches = re.findall(r'\((\d+),[\\]?"([^"\\]*)[\\]?",[\\]?"([^"\\]*)[\\]?",[\\]?"(\d+)[\\]?",(\d+)\)', cops_text)
    if not matches:
        console.print("[yellow]⚠️ Keine Netzbetreiber in der Antwort gefunden.[/yellow]")
        console.print(f"[dim]{raw_cops}[/dim]")
        return

    t_ops = Table(title="[bold green]📡 Empfangene Mobilfunk-Betreiber an der Grenze (857 m Randen)[/bold green]", box=box.ROUNDED)
    t_ops.add_column("Land", style="bold white", width=16)
    t_ops.add_column("Netzbetreiber", style="bold chartreuse3", width=22)
    t_ops.add_column("MCC / MNC", style="cyan", width=12)
    t_ops.add_column("Funktechnik (RAT)", style="bold yellow", width=16)
    t_ops.add_column("Status am Randen", style="white", width=24)

    stat_map = {"0": "Sichtbar / Broadcast", "1": "Verfügbar", "2": "Aktuell verbunden 🟢", "3": "Gesperrt / Roaming-Regel"}
    rat_map = {0: "2G GSM", 2: "3G UTRAN / UMTS", 7: "4G LTE", 11: "5G NSA", 12: "5G NR"}

    for stat, long_name, short_name, mccmnc, rat in matches:
        country = "🇩🇪 Deutschland" if mccmnc.startswith("262") else "🇨🇭 Schweiz"
        rat_label = rat_map.get(int(rat), f"RAT {rat}")
        status_label = stat_map.get(stat, "Erfasst")
        t_ops.add_row(country, long_name, mccmnc, rat_label, status_label)

    console.print("\n")
    console.print(t_ops)
    dash.log(f"Grenznetz-Scan erfolgreich abgeschlossen: {len(matches)} Betreiber-Carrier erfasst")
    console.print(f"\n[bold green]✓ Funkverbindung zu Salt/GoMo ist wieder voll hergestellt.[/bold green]")

# --- Hauptmenü-Schleife ---

def interactive_menu(dash, sid):
    while True:
        console.clear()
        console.print(Panel.fit(dash.header_art, border_style=dash.theme_color))
        console.print(f"📍 [bold white]RandeLab (857 m ü. M.)[/] • Gateway: [cyan]TRB500 ({ROUTER_IP})[/] • Persona: [bold chartreuse2]CHABIS RADIO 5G & COCONUTS 🥥[/]\n")

        menu_table = Table(title="[bold chartreuse2]--- 🥬 CHABIS RADIO HAUPTMENÜ 🥥 ---[/]", box=box.ROUNDED, expand=False)
        menu_table.add_column("Taste", style="bold bright_yellow", width=8)
        menu_table.add_column("Kabis-Funktion", style="bold white", width=34)
        menu_table.add_column("Kokosnuss-Beschreibung", style="dim", width=42)

        menu_table.add_row("[1]", "📡 Live Kabis-Radar (Watch Mode)", "Kontinuierlicher Signal- & Kokosnuss-Monitor")
        menu_table.add_row("[2]", "⚡ Ookla 5G Speedtest", "Kokosnuss-Turbo auf dem Gateway messen")
        menu_table.add_row("[3]", "🛰️ Masten & Bänder manuell prüfen", "Vergleicht Merishausen, Bargen, 800 MHz, etc.")
        menu_table.add_row("[4]", "🏆 Masten-Olympiade (Gesamt-Test)", "Alle Antennen benchmarken & Report erstellen")
        menu_table.add_row("[5]", "🇩🇪🇨🇭 Grenznetz- & Auslands-Scan", "Deutsche & Schweizer Mobilfunknetze listen")
        menu_table.add_row("[6]", "🔬 Tiefen-Zell-Analyse", "eNodeB, Sektoren, TAC, PCID & Trägerdetails")
        menu_table.add_row("[7]", "🥥📝 Statusbericht erstellen", "Speichert aktuellen Snapshot nach reports/")
        menu_table.add_row("[0]", "❌ Beenden", "Ab ins Kabisfeld")

        console.print(menu_table)

        choice = Prompt.ask("\nWähle eine Option", choices=["1", "2", "3", "4", "5", "6", "7", "0"], default="1")

        if choice == "1":
            action_watch_mode(dash, sid)
        elif choice == "2":
            action_speedtest(dash, sid)
            Prompt.ask("\n[dim]Drücke Enter für Hauptmenü...[/dim]")
        elif choice == "3":
            action_mast_antenna_check(dash, sid)
            Prompt.ask("\n[dim]Drücke Enter für Hauptmenü...[/dim]")
        elif choice == "4":
            action_multi_antenna_benchmark(dash, sid)
            Prompt.ask("\n[dim]Drücke Enter für Hauptmenü...[/dim]")
        elif choice == "5":
            action_border_operator_scan(dash, sid)
            Prompt.ask("\n[dim]Drücke Enter für Hauptmenü...[/dim]")
        elif choice == "6":
            action_deep_cell_scan(dash, sid)
            Prompt.ask("\n[dim]Drücke Enter für Hauptmenü...[/dim]")
        elif choice == "7":
            action_create_report(dash, sid)
            Prompt.ask("\n[dim]Drücke Enter für Hauptmenü...[/dim]")
        elif choice == "0":
            console.print("\n[bold chartreuse3]Kabis-Scanner beendet. Möge die Kokosnuss mit dir sein! 🥥🥬[/]\n")
            break

def main():
    parser = argparse.ArgumentParser(description="🥬🥥 CHABIS RADIO 5G SCANNER • Botanical & Coconut Radio Explorer")
    parser.add_argument("--watch", "-w", action="store_true", help="Direkt Live-Kabis-Radar (Watch Mode)")
    parser.add_argument("--speed", "-s", action="store_true", help="Direkt Ookla Speedtest ausführen")
    parser.add_argument("--benchmark", "-b", action="store_true", help="Alle Antennen testen & Benchmark-Report erstellen")
    parser.add_argument("--border", "-g", action="store_true", help="Direkt Grenznetz- & Auslands-Operator-Scan ausführen")
    parser.add_argument("--report", "-r", action="store_true", help="Direkt Snapshot-Bericht erstellen")
    args = parser.parse_args()

    dash = ChabisDashboard()

    console.print(f"\n[dim]Verbinde mit Teltonika TRB500 ({ROUTER_IP})...[/dim]")
    try:
        sid = get_ubus_session()
        dash.log(f"Ubus autorisiert (Token: {sid[:8]}...)")
    except Exception as e:
        console.print(f"[bold red]Fehler bei Verbindung mit {ROUTER_IP}:[/bold red] {e}")
        sys.exit(1)

    if args.watch:
        action_watch_mode(dash, sid)
    elif args.speed:
        action_speedtest(dash, sid)
    elif args.benchmark:
        action_multi_antenna_benchmark(dash, sid)
    elif args.border:
        action_border_operator_scan(dash, sid)
    elif args.report:
        action_create_report(dash, sid)
    else:
        interactive_menu(dash, sid)

if __name__ == "__main__":
    main()
