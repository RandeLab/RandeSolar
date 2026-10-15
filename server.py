#!/usr/bin/env python3
"""
RandeSolar - Victron MPPT 75|15 Bluetooth Logger & Web Dashboard
Reads encrypted BLE Instant Readout advertisements, logs to SQLite,
and serves a real-time web dashboard with SSE and historical charts.
"""

import asyncio
import csv
import io
import json
import logging
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from enum import Enum
import inspect
from pathlib import Path

from aiohttp import web
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from victron_ble.scanner import BaseScanner
from victron_ble.devices import detect_device_type
from victron_ble.devices.base import DeviceData

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("RandeSolar")

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
DB_PATH = BASE_DIR / "solar_history.db"
WEB_DIR = BASE_DIR / "web"

# Load Config
def load_config():
    if not CONFIG_PATH.exists():
        logger.error(f"Config file not found at {CONFIG_PATH}")
        sys.exit(1)
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)

CONFIG = load_config()
TARGET_ADDRESS = CONFIG.get("device_address", "").lower()
ENCRYPTION_KEY = CONFIG.get("encryption_key", "")
WEB_PORT = CONFIG.get("web_port", 8080)
WEB_HOST = CONFIG.get("web_host", "0.0.0.0")
LOG_INTERVAL = CONFIG.get("log_interval_seconds", 2)

# Database Management
def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                battery_voltage REAL,
                battery_charging_current REAL,
                solar_power REAL,
                yield_today REAL,
                external_device_load REAL,
                charge_state TEXT,
                charger_error TEXT,
                rssi INTEGER
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(timestamp)")
        conn.commit()

def save_reading(data: dict):
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO readings (
                    timestamp, battery_voltage, battery_charging_current,
                    solar_power, yield_today, external_device_load,
                    charge_state, charger_error, rssi
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                data["timestamp"],
                data.get("battery_voltage"),
                data.get("battery_charging_current"),
                data.get("solar_power"),
                data.get("yield_today"),
                data.get("external_device_load"),
                data.get("charge_state"),
                data.get("charger_error"),
                data.get("rssi")
            ))
            conn.commit()
    except Exception as e:
        logger.error(f"Error saving to database: {e}")

def get_history(limit: int = 150):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            SELECT timestamp, battery_voltage, battery_charging_current,
                   solar_power, yield_today, external_device_load,
                   charge_state, charger_error, rssi
            FROM readings
            ORDER BY id DESC
            LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        # Return chronological order (oldest to newest)
        return [dict(r) for r in reversed(rows)]

# State & BLE Scanner
class SolarState:
    def __init__(self):
        self.latest_reading = None
        self.last_seen = None
        self.last_saved_to_db = 0
        self.sse_subscribers = set()

    def update(self, reading: dict):
        self.latest_reading = reading
        self.last_seen = time.time()
        
        # Save to DB if log interval elapsed
        now = time.time()
        if now - self.last_saved_to_db >= LOG_INTERVAL:
            save_reading(reading)
            self.last_saved_to_db = now

        # Notify SSE subscribers
        asyncio.create_task(self.broadcast(reading))

    async def broadcast(self, data: dict):
        if not self.sse_subscribers:
            return
        payload = f"data: {json.dumps(data)}\n\n"
        dead_subs = set()
        for response in list(self.sse_subscribers):
            try:
                await response.write(payload.encode("utf-8"))
            except Exception:
                dead_subs.add(response)
        self.sse_subscribers -= dead_subs

state = SolarState()

class SolarBLEScanner(BaseScanner):
    def __init__(self, target_address: str, key: str):
        super().__init__()
        self.target_address = target_address.lower()
        self.key = key
        self.device_parser = None

    def callback(self, device: BLEDevice, data: bytes, advertisement: AdvertisementData):
        if device.address.lower() != self.target_address:
            return

        try:
            if not self.device_parser:
                device_klass = detect_device_type(data)
                if not device_klass:
                    logger.warning(f"Could not identify Victron device type from packet: {data.hex()}")
                    return
                self.device_parser = device_klass(self.key)

            parsed = self.device_parser.parse(data)
            
            # Extract fields
            reading = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "address": device.address,
                "name": device.name or "Victron MPPT",
                "rssi": advertisement.rssi,
                "model_name": getattr(parsed, "model_name", "BlueSolar MPPT 75/15"),
            }

            for name, method in inspect.getmembers(parsed, predicate=inspect.ismethod):
                if name.startswith("get_"):
                    val = method()
                    if isinstance(val, Enum):
                        val = val.name.lower()
                    reading[name[4:]] = val

            state.update(reading)
        except Exception as e:
            logger.error(f"Error parsing advertisement: {e}")

# Web Endpoints
async def handle_index(request):
    index_file = WEB_DIR / "index.html"
    return web.FileResponse(index_file)

async def handle_live(request):
    now = time.time()
    online = state.last_seen is not None and (now - state.last_seen) < 15
    return web.json_response({
        "online": online,
        "seconds_since_last_seen": round(now - state.last_seen, 1) if state.last_seen else None,
        "data": state.latest_reading
    })

async def handle_history(request):
    try:
        limit = int(request.query.get("limit", 150))
        limit = max(10, min(limit, 2000))
    except ValueError:
        limit = 150
    return web.json_response(get_history(limit))

async def handle_stream(request):
    response = web.StreamResponse(
        status=200,
        reason="OK",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )
    await response.prepare(request)
    
    # Send immediate latest state if available
    if state.latest_reading:
        initial = f"data: {json.dumps(state.latest_reading)}\n\n"
        await response.write(initial.encode("utf-8"))

    state.sse_subscribers.add(response)
    try:
        while True:
            await asyncio.sleep(15)
            # Send keep-alive ping
            await response.write(b": ping\n\n")
    except asyncio.CancelledError:
        pass
    finally:
        state.sse_subscribers.discard(response)
    return response

async def handle_export_csv(request):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM readings ORDER BY id ASC")
        rows = cursor.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "timestamp", "battery_voltage", "battery_charging_current",
        "solar_power", "yield_today_wh", "external_device_load",
        "charge_state", "charger_error", "rssi"
    ])
    for r in rows:
        writer.writerow([
            r["id"], r["timestamp"], r["battery_voltage"], r["battery_charging_current"],
            r["solar_power"], r["yield_today"], r["external_device_load"],
            r["charge_state"], r["charger_error"], r["rssi"]
        ])

    csv_data = output.getvalue()
    filename = f"victron_solar_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return web.Response(
        body=csv_data,
        content_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

# Background Tasks & App Runner
async def start_background_tasks(app):
    scanner = SolarBLEScanner(TARGET_ADDRESS, ENCRYPTION_KEY)
    logger.info(f"Starting BLE Scanner for device {TARGET_ADDRESS}...")
    await scanner.start()
    app["scanner"] = scanner

async def cleanup_background_tasks(app):
    scanner = app.get("scanner")
    if scanner:
        logger.info("Stopping BLE Scanner...")
        await scanner.stop()

def create_app():
    init_db()
    app = web.Application()
    app.router.add_get("/", handle_index)
    app.router.add_get("/api/live", handle_live)
    app.router.add_get("/api/history", handle_history)
    app.router.add_get("/api/stream", handle_stream)
    app.router.add_get("/api/export", handle_export_csv)
    app.router.add_static("/static/", path=WEB_DIR, name="static")

    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)
    return app

if __name__ == "__main__":
    app = create_app()
    logger.info(f"Dashboard available at http://localhost:{WEB_PORT}")
    web.run_app(app, host=WEB_HOST, port=WEB_PORT)
