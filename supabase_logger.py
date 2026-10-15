"""
RandeSolar - HiveMQ to Supabase Cloud Logger
Listens to HiveMQ topic 'randelab/solar/telemetry' and logs records to Supabase Postgres.
"""

import json
import time
import urllib.request
import paho.mqtt.client as mqtt

SUPABASE_URL = "https://pakfuetvwpffwfrrxshz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU"
MQTT_BROKER = "broker.hivemq.com"
MQTT_TOPIC = "randelab/solar/telemetry"

last_log_time = 0
LOG_INTERVAL_SEC = 15  # Log to database every 15 seconds to create a clean, dense history

def insert_to_supabase(record):
    url = f"{SUPABASE_URL}/rest/v1/solar_telemetry"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    
    # Clean payload for Supabase schema
    data = {
        "solar_power": int(record.get("solar_power", 0)),
        "battery_voltage": float(record.get("battery_voltage", 0.0)),
        "battery_current": float(record.get("battery_current", 0.0)),
        "yield_today_wh": int(record.get("yield_today_wh", 0)),
        "external_load": float(record.get("external_load", 0.0)),
        "charge_state": int(record.get("charge_state", 0)),
        "state_str": str(record.get("state_str", "OFF")),
        "charger_error": int(record.get("charger_error", 0)),
        "ble_rssi": int(record.get("ble_rssi", 0)),
        "wifi_rssi": int(record.get("wifi_rssi", 0))
    }
    
    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            if response.status in (200, 201):
                print(f"[Supabase 💾] Logged row: {data['battery_voltage']}V | {data['solar_power']}W | {data['battery_current']}A")
    except Exception as e:
        print(f"[Supabase ⚠️] Insert failed: {e}")

def on_connect(client, userdata, flags, rc, properties=None):
    print(f"[MQTT] Connected to {MQTT_BROKER} with result code {rc}")
    client.subscribe(MQTT_TOPIC)
    print(f"[MQTT] Subscribed to {MQTT_TOPIC}")

def on_message(client, userdata, msg):
    global last_log_time
    now = time.time()
    if now - last_log_time < LOG_INTERVAL_SEC:
        return  # Throttle database writes

    try:
        payload = json.loads(msg.payload.decode("utf-8"))
        insert_to_supabase(payload)
        last_log_time = now
    except Exception as e:
        print(f"[MQTT] Message parse error: {e}")

def main():
    print("=" * 60)
    print("🚀 RandeSolar -> Supabase Cloud Logger")
    print(f"Supabase Project: {SUPABASE_URL}")
    print(f"MQTT Broker:      {MQTT_BROKER} ({MQTT_TOPIC})")
    print("=" * 60)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2 if hasattr(mqtt, 'CallbackAPIVersion') else None)
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(MQTT_BROKER, 1883, 60)
    client.loop_forever()

if __name__ == "__main__":
    main()
