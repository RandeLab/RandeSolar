#!/usr/bin/env bash
# Stop RandeSolar Studio
echo "Stopping RandeSolar..."
pkill -f "python.*server.py" && echo "✅ Stopped." || echo "Not currently running."
