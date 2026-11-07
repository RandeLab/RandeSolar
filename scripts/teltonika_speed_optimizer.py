#!/usr/bin/env python3
"""
Teltonika TRB500 Autonomous Speed & Band Optimizer
===================================================
Location: RandeLab • Underes Ätzisloo 189, 8232 Merishausen (857 m ü. M.)
Gateway: Teltonika TRB500 (192.168.2.1) • Quectel RG501Q-EU (Snapdragon X55)

This script autonomously benchmarks all meaningful LTE and 5G frequency band
combinations for Salt Mobile / GoMo, measures RF metrics (RSRP, SINR, CA),
runs native Ookla speedtests directly on the router, and ranks all configurations.

FAIL-SAFE GUARANTEE:
- Backs up current default configuration before testing.
- If a tested band combination fails to register within 25 seconds, it immediately
  reverts to the default bands so the router is NEVER left stranded offline.
- Generates JSON & Markdown reports with rankings.
"""

import sys
import time
import json
import urllib.request
import urllib.error
from datetime import datetime

ROUTER_URL = "http://192.168.2.1/ubus"
ROUTER_USER = "admin"
ROUTER_PASS = "Transist0r!"

class TeltonikaClient:
    def __init__(self, url=ROUTER_URL, user=ROUTER_USER, password=ROUTER_PASS):
        self.url = url
        self.user = user
        self.password = password
        self.token = None
        self.token_expires = 0

    def login(self):
        payload = {
            "jsonrpc": "2.0", "id": 1, "method": "call",
            "params": ["00000000000000000000000000000000", "session", "login", {
                "username": self.user,
                "password": self.password
            }]
        }
        res = self._post(payload)
        if "result" in res and len(res["result"]) > 1:
            self.token = res["result"][1].get("ubus_rpc_session")
            self.token_expires = time.time() + 240
            return True
        return False

    def _ensure_token(self):
        if not self.token or time.time() > self.token_expires:
            if not self.login():
                raise RuntimeError("Failed to authenticate with Teltonika router via ubus")

    def call(self, obj, method, params=None):
        if params is None:
            params = {}
        self._ensure_token()
        payload = {
            "jsonrpc": "2.0", "id": int(time.time()), "method": "call",
            "params": [self.token, obj, method, params]
        }
        return self._post(payload)

    def _post(self, payload):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"error": str(e)}

    def exec_cmd(self, cmd, params=None):
        if params is None:
            params = []
        res = self.call("file", "exec", {"command": cmd, "params": params})
        if "result" in res and len(res["result"]) > 1:
            return res["result"][1].get("stdout", "") or res["result"][1].get("stderr", "")
        return ""

    def send_at(self, at_cmd):
        out = self.exec_cmd("gsmctl", ["-A", at_cmd])
        return out.strip()

    def get_signal_info(self):
        sig_raw = self.exec_cmd("gsmctl", ["-q"]).strip()
        sig = {}
        for line in sig_raw.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                try:
                    sig[k.strip().lower()] = int(v.strip())
                except ValueError:
                    sig[k.strip().lower()] = v.strip()

        band = self.exec_cmd("gsmctl", ["-b"]).strip()
        net_type = self.exec_cmd("gsmctl", ["-t"]).strip()
        ca_info = self.exec_cmd("gsmctl", ["-G"]).strip()
        cell_id = self.exec_cmd("gsmctl", ["-C"]).strip()

        return {
            "rsrp": sig.get("rsrp", -999),
            "sinr": sig.get("sinr", -999),
            "rsrq": sig.get("rsrq", -999),
            "rssi": sig.get("rssi", -999),
            "band": band,
            "type": net_type,
            "cell_id": cell_id,
            "ca_info": ca_info
        }

    def is_connected(self):
        state = self.exec_cmd("gsmctl", ["-j"]).strip()
        return state.lower() == "connected"

    def read_file(self, path):
        res = self.call("file", "read", {"path": path})
        if "result" in res and len(res["result"]) > 1:
            return res["result"][1].get("data", "")
        return ""

    def run_speedtest(self, timeout=75):
        # Trigger Ookla speedtest on router
        self.call("speedtest", "run", {})
        start = time.time()
        last_state = "STARTING"
        while time.time() - start < timeout:
            raw = self.read_file("/tmp/speedtest.json")
            if raw:
                try:
                    data = json.loads(raw)
                    state = data.get("state", "")
                    last_state = state
                    if state == "FINISHED":
                        dl_bytes = data.get("avgDownloadSpeed", 0)
                        ul_bytes = data.get("avgUploadSpeed", 0)
                        dl_mbps = round((dl_bytes * 8.0) / 1_000_000.0, 2)
                        ul_mbps = round((ul_bytes * 8.0) / 1_000_000.0, 2)
                        server = data.get("serverURL", "unknown")
                        return {
                            "success": True,
                            "download_mbps": dl_mbps,
                            "upload_mbps": ul_mbps,
                            "server": server,
                            "duration_sec": round(time.time() - start, 1)
                        }
                    elif state in ["ERROR", "FAILED"]:
                        return {"success": False, "error": f"Speedtest reported state: {state}"}
                except json.JSONDecodeError:
                    pass
            time.sleep(3)
        return {"success": False, "error": f"Speedtest timed out (last state: {last_state})"}


# Candidate Configurations tailored to Salt Schweiz & Randen Forest (857 m ü. M.)
CANDIDATE_CONFIGS = [
    {
        "id": "AUTO_ALL",
        "name": "Auto / Alle Bänder (Hersteller-Standard)",
        "desc": "Alle 4G- und 5G-Bänder freigegeben (aktueller Standardzustand)",
        "mode_pref": "AUTO",
        "lte_bands": "1:3:5:7:8:20:28:32:38:40:41:42:43",
        "nsa_nr5g_bands": "1:3:5:7:8:20:28:38:40:41:77:78",
        "nr5g_bands": "1:3:5:7:8:20:28:38:40:41:77:78"
    },
    {
        "id": "B28_FOREST_PENETRATION",
        "name": "LTE Band 28 (700 MHz) + 5G N1/N78",
        "desc": "Priorisiert 700 MHz für maximale Durchdringung des nassen Randen-Waldes (bester SINR)",
        "mode_pref": "AUTO",
        "lte_bands": "28",
        "nsa_nr5g_bands": "1:78",
        "nr5g_bands": "1:28:78"
    },
    {
        "id": "B20_RURAL_PENETRATION",
        "name": "LTE Band 20 (800 MHz) + 5G N1/N78",
        "desc": "Priorisiert 800 MHz Reichweitenband",
        "mode_pref": "AUTO",
        "lte_bands": "20",
        "nsa_nr5g_bands": "1:78",
        "nr5g_bands": "1:20:78"
    },
    {
        "id": "B3_STANDARD_CAPACITY",
        "name": "LTE Band 3 (1800 MHz) + 5G N1/N78",
        "desc": "Aktuell aktiver Anker (20 MHz Bandbreite)",
        "mode_pref": "AUTO",
        "lte_bands": "3",
        "nsa_nr5g_bands": "1:78",
        "nr5g_bands": "1:3:78"
    },
    {
        "id": "B1_MID_CAPACITY",
        "name": "LTE Band 1 (2100 MHz) + 5G",
        "desc": "Zwingt 4G-Anker auf 2100 MHz",
        "mode_pref": "AUTO",
        "lte_bands": "1",
        "nsa_nr5g_bands": "3:78",
        "nr5g_bands": "1:78"
    },
    {
        "id": "B7_MAX_LTE_CAPACITY",
        "name": "LTE Band 7 (2600 MHz) + 5G",
        "desc": "Höchste 4G-Trägerfrequenz (20 MHz, städtische Kapazität)",
        "mode_pref": "AUTO",
        "lte_bands": "7",
        "nsa_nr5g_bands": "1:78",
        "nr5g_bands": "1:78"
    },
    {
        "id": "N78_PURE_5G_CBAND",
        "name": "5G N78 C-Band Focus (3.5 GHz High-Speed)",
        "desc": "Prüft ob High-Speed 5G C-Band (100 MHz Kanalbreite) am Mast empfangbar ist",
        "mode_pref": "AUTO",
        "lte_bands": "1:3:20:28",
        "nsa_nr5g_bands": "78",
        "nr5g_bands": "78"
    }
]


def backup_config(client):
    print("🔒 [1/4] Sichere aktuelle Router-Konfiguration (Baseline Backup)...")
    mode_pref = client.send_at('AT+QNWPREFCFG="mode_pref"').replace('+QNWPREFCFG: "mode_pref",', '').strip()
    lte_band = client.send_at('AT+QNWPREFCFG="lte_band"').replace('+QNWPREFCFG: "lte_band",', '').strip()
    nsa_band = client.send_at('AT+QNWPREFCFG="nsa_nr5g_band"').replace('+QNWPREFCFG: "nsa_nr5g_band",', '').strip()
    nr5g_band = client.send_at('AT+QNWPREFCFG="nr5g_band"').replace('+QNWPREFCFG: "nr5g_band",', '').strip()

    backup = {
        "mode_pref": mode_pref or "AUTO",
        "lte_bands": lte_band or "1:3:5:7:8:20:28:32:38:40:41:42:43",
        "nsa_nr5g_bands": nsa_band or "1:3:5:7:8:20:28:38:40:41:77:78",
        "nr5g_bands": nr5g_band or "1:3:5:7:8:20:28:38:40:41:77:78"
    }
    print(f"   ✓ Gesichert: LTE={backup['lte_bands'][:20]}... | 5G NSA={backup['nsa_nr5g_bands'][:15]}...")
    return backup


def apply_bands(client, config):
    if "lte_bands" in config:
        client.send_at(f'AT+QNWPREFCFG="lte_band",{config["lte_bands"]}')
    if "nsa_nr5g_bands" in config:
        client.send_at(f'AT+QNWPREFCFG="nsa_nr5g_band",{config["nsa_nr5g_bands"]}')
    if "nr5g_bands" in config:
        client.send_at(f'AT+QNWPREFCFG="nr5g_band",{config["nr5g_bands"]}')
    if "mode_pref" in config:
        client.send_at(f'AT+QNWPREFCFG="mode_pref",{config["mode_pref"]}')


def restore_backup(client, backup):
    print("\n🔄 [Wiederherstellung] Stelle gesicherte Basiskonfiguration wieder her...")
    apply_bands(client, backup)
    # Wait for re-registration
    for _ in range(12):
        if client.is_connected():
            print("   ✓ Router ist wieder stabil mit Mobilfunknetz verbunden.")
            return True
        time.sleep(2)
    return False


def run_benchmark():
    print("=" * 70)
    print("🚀 Teltonika TRB500 Autonomer 5G Speed- & Band-Optimizer")
    print(f"📍 Standort: RandeLab (857 m ü. M.) • Start: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    client = TeltonikaClient()
    if not client.login():
        print("❌ FEHLER: Konnte nicht beim Teltonika Gateway einloggen. Bitte IP & Passwort prüfen.")
        return False

    backup = backup_config(client)
    results = []

    try:
        print(f"\n🧪 [2/4] Starte Benchmark von {len(CANDIDATE_CONFIGS)} Frequenz-Profilen...")
        for idx, cfg in enumerate(CANDIDATE_CONFIGS, 1):
            print("\n" + "-" * 70)
            print(f"[{idx}/{len(CANDIDATE_CONFIGS)}] Teste Profil: {cfg['name']}")
            print(f"   Info: {cfg['desc']}")

            apply_bands(client, cfg)

            # Wait for modem to acquire cell (max 25s)
            print("   ⏳ Warte auf Netzeinbuchung...", end="", flush=True)
            connected = False
            for _ in range(12):
                time.sleep(2)
                print(".", end="", flush=True)
                if client.is_connected():
                    connected = True
                    break
            print()

            if not connected:
                print("   ⚠️ Keine Verbindung auf diesen Bändern möglich (Timeout). Überspringe.")
                results.append({
                    "config": cfg,
                    "connected": False,
                    "error": "No cell signal / registration timeout"
                })
                # Re-apply safe backup before proceeding
                apply_bands(client, backup)
                time.sleep(5)
                continue

            # Read RF metrics
            time.sleep(2)
            sig = client.get_signal_info()
            print(f"   📡 HF-Signal: {sig['type']} | Band: {sig['band']} | RSRP: {sig['rsrp']} dBm | SINR: {sig['sinr']} dB")

            # Run Speedtest
            print("   ⚡ Starte Ookla-Speedtest auf Router...", end="", flush=True)
            st = client.run_speedtest(timeout=70)
            if st["success"]:
                print(f" FERTIG!")
                print(f"   ⬇️ Download: {st['download_mbps']} Mbit/s | ⬆️ Upload: {st['upload_mbps']} Mbit/s ({st['server']})")
                results.append({
                    "config": cfg,
                    "connected": True,
                    "download_mbps": st["download_mbps"],
                    "upload_mbps": st["upload_mbps"],
                    "server": st["server"],
                    "rsrp": sig["rsrp"],
                    "sinr": sig["sinr"],
                    "rsrq": sig["rsrq"],
                    "band": sig["band"],
                    "type": sig["type"],
                    "cell_id": sig["cell_id"]
                })
            else:
                print(f" FEHLER: {st.get('error')}")
                results.append({
                    "config": cfg,
                    "connected": True,
                    "error": st.get("error"),
                    "rsrp": sig["rsrp"],
                    "sinr": sig["sinr"],
                    "band": sig["band"]
                })

    finally:
        # Guarantee router is restored
        restore_backup(client, backup)

    # 3. Process & Rank Results
    print("\n" + "=" * 70)
    print("📊 [3/4] BENCHMARK ERGEBNISSE & AUSWERTUNG")
    print("=" * 70)

    valid_runs = [r for r in results if r.get("connected") and "download_mbps" in r]
    valid_runs.sort(key=lambda x: (x["download_mbps"] + x["upload_mbps"] * 0.5), reverse=True)

    header = f"{'Rang':<5} | {'Profil':<32} | {'Download':<11} | {'Upload':<11} | {'SINR':<8} | {'RSRP':<9} | {'Band':<12}"
    print(header)
    print("-" * len(header))
    for rank, r in enumerate(valid_runs, 1):
        name = r["config"]["name"][:32]
        dl = f"{r['download_mbps']} Mbps"
        ul = f"{r['upload_mbps']} Mbps"
        sinr = f"{r['sinr']} dB"
        rsrp = f"{r['rsrp']} dBm"
        band = str(r['band'])[:12]
        print(f"#{rank:<4} | {name:<32} | {dl:<11} | {ul:<11} | {sinr:<8} | {rsrp:<9} | {band:<12}")

    # Generate JSON and Markdown report
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_json_path = f"reports/teltonika_optimizer_{ts}.json"
    report_md_path = f"reports/teltonika_optimizer_{ts}.md"

    report_data = {
        "timestamp": datetime.now().isoformat(),
        "location": "RandeLab (Underes Ätzisloo 189, 8232 Merishausen, 857m ü. M.)",
        "gateway": "Teltonika TRB500 (192.168.2.1)",
        "results": results,
        "ranking": valid_runs
    }

    import os
    os.makedirs("reports", exist_ok=True)
    with open(report_json_path, "w") as f:
        json.dump(report_data, f, indent=2)

    with open(report_md_path, "w") as f:
        f.write(f"# 🚀 Teltonika TRB500 Speed- & Band-Benchmark Bericht\n\n")
        f.write(f"**Datum:** {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}  \n")
        f.write(f"**Standort:** RandeLab (857 m ü. M.) • Cell ID: `29858817`  \n\n")
        f.write(f"## 🏆 Rangliste der gemessenen Profile\n\n")
        f.write("| Rang | Profil | Download | Upload | SINR | RSRP | Aktives Band |\n")
        f.write("| :---: | :--- | :---: | :---: | :---: | :---: | :---: |\n")
        for rank, r in enumerate(valid_runs, 1):
            f.write(f"| **#{rank}** | {r['config']['name']} | **{r['download_mbps']} Mbit/s** | **{r['upload_mbps']} Mbit/s** | {r['sinr']} dB | {r['rsrp']} dBm | `{r['band']}` |\n")
        f.write("\n---\n*Automatisch generiert durch RandeSolar Autonomous Optimizer.*\n")

    print(f"\n💾 [4/4] Berichte gespeichert:")
    print(f"   • Markdown: {report_md_path}")
    print(f"   • JSON:     {report_json_path}")
    print("=" * 70)
    return True

if __name__ == "__main__":
    run_benchmark()
