#!/bin/bash
set -e

ROLE=${1:-api}

# Start Python utils service in background
cd /app/python_utils && python main.py &

# Start the appropriate service based on role
cd /app/backend

if [ "$ROLE" = "worker" ]; then
  echo "Starting worker..."
  npm run worker
else
  echo "Starting API..."
  npm run start
fi
