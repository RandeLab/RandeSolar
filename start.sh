#!/usr/bin/env bash
# RandeSolar Studio Launcher
cd "$(dirname "$0")" || exit 1

# Check if already running
if pgrep -f "python.*server.py" > /dev/null; then
    echo "⚡ RandeSolar is already running!"
    echo "👉 Open http://localhost:8080 in your browser."
    exit 0
fi

echo "🚀 Starting RandeSolar Studio..."
./.venv/bin/python3 server.py
