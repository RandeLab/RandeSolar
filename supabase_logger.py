import json
import time
import datetime
import urllib.request
import paho.mqtt.client as mqtt

SUPABASE_URL = "https://pakfuetvwpffwfrrxshz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBha2Z1ZXR2d3BmZndmcnJ4c2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODkwNjIsImV4cCI6MjEwNzY2NTA2Mn0.J4HDEP28BF0fRkmfYqeeaM1urn29lYNUz9k4kQjXWhU"
MQTT_BROKER = "broker.hivemq.com"
MQTT_TOPIC = "randelab/solar/telemetry"

TELEGRAM_BOT_TOKEN = "8600149990:AAGGHL_USsmi_PfzPFBDIvoFgQx-rmvXIkc"
TELEGRAM_CHAT_ID = "818690605"

last_log_time = 0
LOG_INTERVAL_SEC = 15  # Log to database every 15 seconds to create a clean, dense history
last_report_day = None

def send_telegram(text):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown"
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            print("[Telegram ✈️] Daily report delivered to Marc (@dusjagr)!")
    except Exception as e:
        print(f"[Telegram ⚠️] Report send failed: {e}")

def generate_daily_report():
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    today_start = now_utc.strftime("%Y-%m-%dT00:00:00Z")

    # Fetch today's telemetry
    url = f"{SUPABASE_URL}/rest/v1/solar_telemetry?select=solar_power,battery_voltage,yield_today_wh,created_at&created_at=gte.{today_start}&order=created_at.desc&limit=1000"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            rows = json.loads(resp.read().decode())
            if not rows:
                print("[Report] No rows recorded for today yet.")
                return

            max_power = max(r.get("solar_power", 0) for r in rows)
            max_yield_wh = max(r.get("yield_today_wh", 0) for r in rows)
            voltages = [r.get("battery_voltage", 0) for r in rows if r.get("battery_voltage", 0) > 5.0]
            min_v = min(voltages) if voltages else 0.0
            max_v = max(voltages) if voltages else 0.0

            yield_kwh = max_yield_wh / 1000.0

            report = (
                "📊 *RandeSolar Tagesbericht* ☀️\n"
                "━━━━━━━━━━━━━━━━━━━━\n"
                f"⚡ *Tagesertrag:* {yield_kwh:.2f} kWh ({max_yield_wh} Wh)\n"
                f"🏆 *Spitzenleistung:* {max_power} W\n"
                f"🔋 *Batterie Min / Max:* {min_v:.2f} V / {max_v:.2f} V\n"
                f"📈 *Datenpunkte:* {len(rows)} Messungen in Cloud\n"
                "━━━━━━━━━━━━━━━━━━━━\n"
                "🌐 _Dashboard:_ https://randelab.github.io/RandeSolar/"
            )
            send_telegram(report)
    except Exception as e:
        print(f"[Report ⚠️] Error generating report: {e}")

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
    global last_log_time, last_report_day
    now = time.time()
    
    # Check if 20:00 daily evening report should be sent
    local_time = datetime.datetime.now()
    current_day = local_time.date()
    if local_time.hour == 20 and last_report_day != current_day:
        last_report_day = current_day
        print("[Scheduler ⏰] Triggering 20:00 evening Telegram report...")
        generate_daily_report()

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
    print("🚀 RandeSolar -> Supabase Cloud Logger + Telegram Bot")
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
