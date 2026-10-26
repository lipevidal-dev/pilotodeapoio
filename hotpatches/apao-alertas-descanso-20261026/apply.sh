#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/pilotodeapoiov2
BRANCH=cursor/alertas-descanso-apao-326e
RAW="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/${BRANCH}"
PATCH_DIR="$ROOT/hotpatches/apao-alertas-descanso-20261026"
UTILITY_REL=frontend-admin/src/app/utils/apao-rest-alerts.util.ts

mkdir -p "$PATCH_DIR" "$ROOT/frontend-admin/src/app/utils"

curl -fsSL "$RAW/hotpatches/apao-alertas-descanso-20261026/patch-frontend.py" \
  -o "$PATCH_DIR/patch-frontend.py"
curl -fsSL "$RAW/$UTILITY_REL" -o "$PATCH_DIR/apao-rest-alerts.util.ts"

if [ -f "$ROOT/$UTILITY_REL" ]; then
  mkdir -p "$ROOT/hotpatch-backup/apao-alertas-descanso-20261026"
  cp -a "$ROOT/$UTILITY_REL" \
    "$ROOT/hotpatch-backup/apao-alertas-descanso-20261026/apao-rest-alerts.util.ts"
fi
cp -f "$PATCH_DIR/apao-rest-alerts.util.ts" "$ROOT/$UTILITY_REL"

python3 "$PATCH_DIR/patch-frontend.py" "$ROOT"

cd "$ROOT"
docker compose --env-file .env.prod -f docker-compose.prod.yml build admin
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d admin

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/ >/dev/null; then
    echo "Deploy APAO concluído; frontend saudável."
    exit 0
  fi
  sleep 2
done

echo "Frontend não respondeu em http://127.0.0.1:8080" >&2
exit 1
