#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/pilotodeapoiov2
PATCH_DIR="$ROOT/hotpatches/voos-planejamento-20261014"
BACKUP_DIR="$ROOT/hotpatch-backup/voos-planejamento-20261014"
ADMIN_CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
BACKEND_CID="${BACKEND_CONTAINER:-piloto_apoio_backend}"
DB_CID="${DB_CONTAINER:-piloto_apoio_db}"
VERSION="${VERSION:-5}"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

mkdir -p "$PATCH_DIR" "$BACKUP_DIR"

if docker ps --format '{{.Names}}' | grep -qx "$DB_CID"; then
  docker exec "$DB_CID" psql -U piloto -d piloto_apoio_v2 <<'SQL' >/dev/null
CREATE TABLE IF NOT EXISTS "flight_planning_periods" (
    "id" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flight_planning_periods_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "flight_planning_packages" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flight_planning_packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "flight_planning_packages_period_id_year_month_key"
ON "flight_planning_packages"("period_id", "year", "month");
CREATE TABLE IF NOT EXISTS "flight_planning_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_id" TEXT,
    "package_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flight_planning_requests_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "flight_planning_request_lines" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "flight_planning_request_lines_pkey" PRIMARY KEY ("id")
);
SQL
fi

docker cp "$ADMIN_CID:/usr/share/nginx/html/index.html" "$WORKDIR/index.html"
cp -a "$WORKDIR/index.html" "$BACKUP_DIR/index.html"

python3 "$PATCH_DIR/patch-index.py" "$WORKDIR/index.html" "$VERSION"
docker cp "$PATCH_DIR/voos-planejamento.js" "$ADMIN_CID:/usr/share/nginx/html/voos-planejamento.js"
docker cp "$WORKDIR/index.html" "$ADMIN_CID:/usr/share/nginx/html/index.html"

docker exec "$ADMIN_CID" grep -q "voos-planejamento.js?v=${VERSION}" /usr/share/nginx/html/index.html
curl -fsS "http://127.0.0.1:8080/voos-planejamento.js?v=${VERSION}" >/dev/null

if docker ps --format '{{.Names}}' | grep -qx "$BACKEND_CID"; then
  docker exec "$BACKEND_CID" mkdir -p \
    /app/dist/domain/flight-planning \
    /app/dist/application/use-cases \
    /app/dist/interfaces/http/middleware \
    /app/dist/interfaces/http/controllers

  for f in flight-planning-email.js flight-planning-period.js flight-planning-roster.js; do
    docker cp "$PATCH_DIR/dist/$f" "$BACKEND_CID:/app/dist/domain/flight-planning/$f"
  done
  docker cp "$PATCH_DIR/dist/flight-planning.use-case.js" \
    "$BACKEND_CID:/app/dist/application/use-cases/flight-planning.use-case.js"
  docker cp "$PATCH_DIR/dist/require-auth.js" \
    "$BACKEND_CID:/app/dist/interfaces/http/middleware/require-auth.js"
  docker cp "$PATCH_DIR/dist/require-admin.js" \
    "$BACKEND_CID:/app/dist/interfaces/http/middleware/require-admin.js"
  docker cp "$PATCH_DIR/dist/flight-planning.controller.js" \
    "$BACKEND_CID:/app/dist/interfaces/http/controllers/flight-planning.controller.js"

  docker cp "$BACKEND_CID:/app/dist/interfaces/http/routes/index.js" "$WORKDIR/routes.index.js"
  cp -a "$WORKDIR/routes.index.js" "$BACKUP_DIR/routes.index.js"
  python3 "$PATCH_DIR/patch-backend.py" "$WORKDIR/routes.index.js"
  docker cp "$WORKDIR/routes.index.js" "$BACKEND_CID:/app/dist/interfaces/http/routes/index.js"

  docker exec "$BACKEND_CID" node --check /app/dist/application/use-cases/flight-planning.use-case.js
  docker exec "$BACKEND_CID" node --check /app/dist/interfaces/http/controllers/flight-planning.controller.js
  docker exec "$BACKEND_CID" node --check /app/dist/interfaces/http/routes/index.js

  echo "Reiniciando backend (migrate+seed)..."
  docker restart "$BACKEND_CID" >/dev/null
  for i in $(seq 1 90); do
    if curl -fsS -m 3 http://127.0.0.1:3333/health >/dev/null; then
      echo "Backend saudável (tentativa $i)."
      break
    fi
    sleep 2
  done
fi

echo "Voos Planejamento publicado com sucesso."
