#!/usr/bin/env bash
# ==============================================================================
# RandeSolar Station: Hardware LED (WS2812 GPIO 48) CLI Test Script
# Usage: ./test_led.sh [color] [duration_sec] [method]
# Examples:
#   ./test_led.sh disco 10 mqtt
#   ./test_led.sh pink 8 rest
#   ./test_led.sh green
# ==============================================================================

COLOR="${1:-disco}"
DURATION="${2:-10}"
METHOD="${3:-all}"
BROKER="broker.hivemq.com"
PORT="1883"
TOPIC_CMD="randelab/solar/cmd"
TOPIC_ACK="randelab/solar/ack"
ESP_IP="192.168.1.100"

echo "🌴 [RandeSolar] Testing LED: Color='${COLOR}', Duration=${DURATION}s, Method='${METHOD}'"

# 1. Test via Local REST API
if [[ "$METHOD" == "rest" || "$METHOD" == "all" ]]; then
  echo "📡 [REST] Querying http://${ESP_IP}/api/led?color=${COLOR}&duration=${DURATION}..."
  RESPONSE=$(curl -s --connect-timeout 2 "http://${ESP_IP}/api/led?color=${COLOR}&duration=${DURATION}")
  if [[ -n "$RESPONSE" ]]; then
    echo "✅ [REST ACK] ${RESPONSE}"
  else
    echo "⚠️ [REST] No response from ${ESP_IP} (Device may be unreachable or offline)."
  fi
fi

# 2. Test via HiveMQ MQTT
if [[ "$METHOD" == "mqtt" || "$METHOD" == "all" ]]; then
  echo "📤 [MQTT] Publishing to ${TOPIC_CMD} on ${BROKER}:${PORT}..."
  PAYLOAD="{\"action\":\"led\",\"color\":\"${COLOR}\",\"duration_sec\":${DURATION},\"t\":$(date +%s%3N)}"
  
  if command -v mosquitto_pub &>/dev/null; then
    mosquitto_pub -h "$BROKER" -p "$PORT" -t "$TOPIC_CMD" -m "$PAYLOAD"
    echo "🚀 [MQTT] Sent: ${PAYLOAD}"
    
    if command -v mosquitto_sub &>/dev/null; then
      echo "⏳ [MQTT] Waiting for physical hardware ACK on ${TOPIC_ACK} (max 4s)..."
      mosquitto_sub -h "$BROKER" -p "$PORT" -t "$TOPIC_ACK" -C 1 -W 4
    fi
  else
    echo "⚠️ [MQTT] mosquitto_pub not installed. Install with: sudo apt-get install mosquitto-clients"
  fi
fi

echo "✨ [RandeSolar] Test execution completed."
