#!/bin/sh
cd "$(dirname "$0")"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
