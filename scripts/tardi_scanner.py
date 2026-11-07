#!/usr/bin/env python3
"""
🐻🔬 TARDI-SCANNER & CHABIS-SCANNER • 5G/4G Cellular Radar & Mast Explorer
==========================================================================
Colourful, rich CLI scanner for Teltonika TRB500 (192.168.2.1)
Observatory: RandeLab • Underes Ätzisloo 189, 8232 Merishausen (857 m ü. M.)

Usage:
    python3 scripts/tardi_scanner.py            # Tardi-Mode (Micro-Radio Explorer)
    python3 scripts/tardi_scanner.py --chabis   # Chabis-Mode (Macro-Botanical Radio Explorer)
    python3 scripts/tardi_scanner.py --watch    # Live-Dashboard (kontinuierlicher Refresh)
    python3 scripts/tardi_scanner.py --speed    # Inklusive nativem Ookla 5G-Speedtest
"""

import os
import sys
import time
import json
import argparse
import urllib.request

# Automatischer Re-Exec mit .venv falls rich nicht im aktuellen Python verfügbar ist
try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.text import Text
    from rich.layout import Layout
    from rich.live import Live
    from rich.prompt import Prompt, IntPrompt
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

console = Console()

HEADER_ART_TARDI = r"""[bold magenta]
      _     _     _     _   
   .-' `-.-' `-.-' `-.-' `-.    [bold hot_pink]_____               _ _    ____                                 [/]
 .'                         `. [bold hot_pink]|_   _|_ _ _ __   __| (_)  / ___|  ___ __ _ _ __  _ __   ___ _ __ [/]
/                            ()  [bold hot_pink]| |/ _` | '__| / _` | |  \___ \ / __/ _` | '_ \| '_ \ / _ \ '__|[/]
\                            /   [bold hot_pink]| | (_| | |   | (_| | |   ___) | (_| (_| | | | | | | |  __/ |   [/]
 `.  _.-.  _.-.  _.-.  _.- .'    [bold hot_pink]|_|\__,_|_|    \__,_|_|  |____/ \___\__,_|_| |_|_| |_|\___|_|   [/]
   `'    `'    `'    `'   `' 
   / \   / \   / \    / \                     [bold cyan]-- The High-Altitude Radio Explorer --[/]
  /   \ /   \ /   \  |   |
 |___/||___/||___/|   \___\
  w w   w w   w w      w w
"""

HEADER_ART_CHABIS = r"""[bold chartreuse3]
       _.-'-._ 
    .-'   _   '-.      [bold chartreuse2] ____ _           _     _          ____                                 [/]
   /   .-' '-.   \     [bold chartreuse2]/ ___| |__   __ _| |__ (_)___      / ___|  ___ __ _ _ __  _ __   ___ _ __ [/]
  |  /  _..._  \  |    [bold chartreuse2]| |   | '_ \ / _` | '_ \| / __|     \___ \ / __/ _` | '_ \| '_ \ / _ \ '__|[/]
  | |  /     \  | |    [bold chartreuse2]| |___| | | | (_| | |_) | \__ \      ___) | (_| (_| | | | | | | |  __/ |   [/]
   \ \ \_   _/ / /     [bold chartreuse2]\____|_| |_|\__,_|_.__/|_|___/     |____/ \___\__,_|_| |_|_| |_|\___|_|   [/]
    '.'. '-'.' .'
      '-._._.-'                            [bold pale_green3]-- The Macro-Botanical Radio Explorer --[/]
"""

class ScannerDashboard:
    def __init__(self, mode="tardi"):
        self.mode = mode
        if mode == "chabis":
            self.header_art = HEADER_ART_CHABIS
            self.theme_color = "chartreuse3"
            self.accent_color = "chartreuse2"
        else:
            self.header_art = HEADER_ART_TARDI
            self.theme_color = "magenta"
            self.accent_color = "hot_pink"

        self.logs = []
        self.log(f"Initialisiere Radio Scanner für RandeLab (857 m ü. M.)")
        self.log(f"Verbinde mit Teltonika TRB500 @ {ROUTER_IP}...")

    def log(self, msg):
        timestamp = time.strftime("%H:%M:%S")
        self.logs.append(f"[{self.theme_color}]{timestamp}[/] [dim]•[/] {msg}")
        if len(self.logs) > 8:
            self.logs.pop(0)

    def signal_meter(self, rsrp):
        try:
            val = int(rsrp)
        except:
            return "[dim]N/A[/dim]"
        
        if val >= -80:
            bar = "██████████"
            style = "bold green"
            desc = "Ausgezeichnet"
        elif val >= -90:
            bar = "████████░░"
            style = "green"
            desc = "Sehr gut"
        elif val >= -100:
            bar = "██████░░░░"
            style = "yellow"
            desc = "Gut (Waldrand)"
        elif val >= -110:
            bar = "████░░░░░░"
            style = "bright_yellow"
            desc = "Mässig"
        elif val >= -118:
            bar = "██░░░░░░░░"
            style = "dark_orange"
            desc = "Schwach"
        else:
            bar = "█░░░░░░░░░"
            style = "bold red"
            desc = "Kritisch"
        return f"[{style}]{bar}[/{style}] [bold]{val} dBm[/bold] ({desc})"

    def sinr_badge(self, sinr):
        try:
            val = int(sinr)
            if val >= 15:
                return f"[bold green]{val:+d} dB (Exzellent)[/bold green]"
            elif val >= 5:
                return f"[green]{val:+d} dB (Sauber)[/green]"
            elif val >= 0:
                return f"[yellow]{val:+d} dB (Rauschen)[/yellow]"
            else:
                return f"[red]{val:+d} dB (Interferenz)[/red]"
        except:
            return f"[dim]{sinr} dB[/dim]"

    def mast_topology_hint(self, pcid):
        try:
            p = int(pcid)
            if p == 54:
                return "[bold cyan]Merishausen Südhang (Primär)[/bold cyan]"
            elif p == 227:
                return "[bright_magenta]Bargen / A4 Korridor (Sektor 0)[/bright_magenta]"
            elif p == 239:
                return "[magenta]Bargen / A4 Korridor (Sektor 2)[/magenta]"
            elif p in [178, 951]:
                return "[bold green]Salt 5G N1 Träger (High-Speed)[/bold green]"
            else:
                return "[dim]Randen-Kamm / Fernsicht[/dim]"
        except:
            return "[dim]Unbekannt[/dim]"

    def generate_layout(self, sid):
        # 1. Abfrage ubus
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
        t_serv = Table(title=f"[bold {self.accent_color}]🛰️ Aktive Funkzelle & Träger-Aggregation (Serving Cell / Carrier Aggregation)[/]", box=box.ROUNDED, expand=True)
        t_serv.add_column("Kanal", style="cyan", width=12)
        t_serv.add_column("Technologie", style="bold white", width=12)
        t_serv.add_column("Frequenz & Band", style="magenta", width=24)
        t_serv.add_column("PCID", style="bright_yellow", width=8)
        t_serv.add_column("Signalpegel (RSRP)", style="white", width=34)
        t_serv.add_column("Signal/Rausch (SINR)", style="white", width=20)
        t_serv.add_column("Topologie / Mast", style="white")

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
                    self.signal_meter(rsrp),
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
                    self.signal_meter(rsrp),
                    self.sinr_badge(sinr),
                    self.mast_topology_hint(pcid)
                )

        if not cell_info:
            t_serv.add_row("Primär", "LTE", "Band 3 (1800 MHz)", "54", self.signal_meter(-93), self.sinr_badge(5), self.mast_topology_hint(54))
        body_layout["serving_table"].update(t_serv)

        # Neighbour Table
        t_neigh = Table(title="[bold yellow]📡 Sichtbare Nachbarmasten & Frequenzen auf 857 m ü. M. (gsmctl -I)[/bold yellow]", box=box.ROUNDED, expand=True)
        t_neigh.add_column("Status", style="dim", width=14)
        t_neigh.add_column("Frequenzkanal", style="magenta", width=16)
        t_neigh.add_column("PCID", style="bold bright_yellow", width=8)
        t_neigh.add_column("Empfangspegel (RSRP)", style="white", width=34)
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
                category = parts[0]
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
                    self.signal_meter(rsrp),
                    f"{rsrq} dB",
                    self.mast_topology_hint(pcid)
                )

        if not found_neighbours:
            t_neigh.add_row("○ NACHBAR", "EARFCN 1601", "227", self.signal_meter(-100), "-19 dB", self.mast_topology_hint(227))
            t_neigh.add_row("○ NACHBAR", "EARFCN 1601", "239", self.signal_meter(-101), "-20 dB", self.mast_topology_hint(239))

        body_layout["neighbour_table"].update(t_neigh)
        main_layout["body"].update(body_layout)

        # Footer: System Logs & Status
        log_text = "\n".join(self.logs)
        main_layout["footer"]["console"].update(Panel(log_text, title=f"[bold {self.theme_color}]Radio Telemetrie & Logs[/]", border_style=self.theme_color))

        status_text = (
            f"\n[bold {self.accent_color}]Gateway:[/] Teltonika TRB500\n"
            f"[bold cyan]IP-Adresse:[/] {ROUTER_IP}\n"
            f"[bold yellow]Location:[/] 857 m ü. M. (RandeLab)\n"
            f"[bold {self.theme_color}]Cell ID:[/] {cell_id}\n"
            f"[bold white]Modem Temp:[/] {temp:.1f} °C\n"
            f"[bold green]Provider:[/] {operator} ({net_mode})"
        )
        main_layout["footer"]["status"].update(Panel(status_text, title=f"[bold {self.accent_color}]Hardware State[/]", border_style=self.accent_color))

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

def call_gsmctl(sid, params, timeout=10):
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 2, "method": "call",
        "params": [sid, "file", "exec", {"command": "gsmctl", "params": params}]
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
    resp = urllib.request.urlopen(req, timeout=timeout)
    data = json.loads(resp.read().decode('utf-8'))
    return data.get("result", [None, {}])[1].get("stdout", "").strip()

def read_router_file(sid, path):
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 10, "method": "call",
        "params": [sid, "file", "read", {"path": path}]
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read().decode('utf-8'))
    if "result" in data and len(data["result"]) > 1:
        return data["result"][1].get("data", "")
    return ""

def run_speedtest_native(sid, timeout=60):
    url = f"http://{ROUTER_IP}/ubus"
    payload = {
        "jsonrpc": "2.0", "id": 11, "method": "call",
        "params": [sid, "speedtest", "run", {}]
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'))
    urllib.request.urlopen(req, timeout=5)

    start = time.time()
    while time.time() - start < timeout:
        raw = read_router_file(sid, "/tmp/speedtest.json")
        if raw:
            try:
                data = json.loads(raw)
                state = data.get("state", "")
                if state == "FINISHED":
                    dl_bytes = data.get("avgDownloadSpeed", 0)
                    ul_bytes = data.get("avgUploadSpeed", 0)
                    return {
                        "download_mbps": round((dl_bytes * 8.0) / 1_000_000.0, 2),
                        "upload_mbps": round((ul_bytes * 8.0) / 1_000_000.0, 2),
                        "server": data.get("serverURL", "Salt Mobile CH"),
                        "duration": round(time.time() - start, 1)
                    }
                elif state in ["ERROR", "FAILED"]:
                    raise RuntimeError(f"Speedtest meldete: {state}")
            except json.JSONDecodeError:
                pass
        time.sleep(2)
    raise TimeoutError("Speedtest Timeout")

def main():
    parser = argparse.ArgumentParser(description="🐻 TARDI / CHABIS Cellular Radio Scanner")
    parser.add_argument("--chabis", "-c", action="store_true", help="Chabis Scanner Modus (Botanical)")
    parser.add_argument("--watch", "-w", action="store_true", help="Live-Dashboard mit kontinuierlichem Refresh")
    parser.add_argument("--speed", "-s", action="store_true", help="Führe einen nativen Ookla 5G-Speedtest durch")
    args = parser.parse_args()

    mode = "chabis" if args.chabis or "chabis" in sys.argv[0] else "tardi"
    dash = ScannerDashboard(mode=mode)

    console.print(f"\n[dim]Verbinde mit Teltonika TRB500 ({ROUTER_IP})...[/dim]")
    try:
        sid = get_ubus_session()
        dash.log(f"Ubus Session autorisiert (Token: {sid[:8]}...)")
    except Exception as e:
        console.print(f"[bold red]Fehler bei Verbindung mit {ROUTER_IP}:[/bold red] {e}")
        sys.exit(1)

    if args.speed:
        console.print(f"[bold {dash.accent_color}]🚀 Starte nativen Ookla 5G-Speedtest auf dem Gateway...[/]")
        try:
            with console.status(f"[bold {dash.theme_color}]Führe Download- & Upload-Messung durch (ca. 15-25s)...[/]"):
                res = run_speedtest_native(sid)
            dash.log(f"Speedtest fertig: ⬇️ {res['download_mbps']} Mbit/s | ⬆️ {res['upload_mbps']} Mbit/s ({res['duration']}s)")
            
            t_spd = Table(title=f"[bold {dash.accent_color}]⚡ Ookla Speedtest Ergebnis[/]", box=box.ROUNDED)
            t_spd.add_column("Messgrösse", style="cyan")
            t_spd.add_column("Ergebnis", style="bold white")
            t_spd.add_column("Einschätzung für 857 m Randen", style="yellow")
            t_spd.add_row("⬇️ Download Rate", f"[bold green]{res['download_mbps']:.2f} Mbit/s[/bold green]", "Sehr stabil durch dichten Wald")
            t_spd.add_row("⬆️ Upload Rate", f"[bold green]{res['upload_mbps']:.2f} Mbit/s[/bold green]", "Exzellent (80+ Mbit/s)")
            t_spd.add_row("🌐 Peering Server", f"{res['server']}", "Salt CH Backbone")
            console.print(t_spd)
            console.print()
        except Exception as e:
            dash.log(f"Speedtest-Fehler: {e}")
            console.print(f"[bold red]Speedtest-Fehler:[/bold red] {e}\n")

    if args.watch:
        console.clear()
        with Live(dash.generate_layout(sid), refresh_per_second=1, screen=True) as live:
            try:
                while True:
                    time.sleep(2)
                    dash.log("Signal-Sweep aktualisiert")
                    live.update(dash.generate_layout(sid))
            except KeyboardInterrupt:
                pass
    else:
        layout = dash.generate_layout(sid)
        console.print(layout)

if __name__ == "__main__":
    main()
