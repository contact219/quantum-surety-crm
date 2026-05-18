#!/bin/bash
set -e

echo "[1/4] Pulling latest from GitHub..."
cd /usr/quantum-surety-crm
git pull origin main

echo "[2/4] Removing old images to force clean rebuild..."
docker rmi quantum-surety-crm-crm-frontend quantum-surety-crm-crm-backend 2>/dev/null || true

echo "[3/4] Rebuilding Docker images (no cache)..."
docker compose build --no-cache

echo "[4/4] Restarting containers..."
docker compose up -d --force-recreate crm-backend crm-frontend

echo ""
echo "Deploy complete!"
docker ps | grep qs-crm
