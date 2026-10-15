#!/bin/sh
set -e
HP=/opt/pilotodeapoiov2/hotpatches/ferias-calendario-20261015
BACKUP=/opt/pilotodeapoiov2/hotpatch-backup/ferias-calendario-20261015
WORK=/tmp/ferias-cal-patch
mkdir -p "$BACKUP" "$WORK"

docker cp piloto_apoio_backend:/app/dist/interfaces/http/routes/index.js "$WORK/routes.index.js"
docker cp piloto_apoio_backend:/app/dist/application/use-cases/vacation.use-case.js "$WORK/vacation.use-case.js"
docker cp piloto_apoio_backend:/app/dist/infrastructure/repositories/vacation.repository.js "$WORK/vacation.repository.js"
docker cp piloto_apoio_admin:/usr/share/nginx/html/index.html "$WORK/index.html"

cp -a "$WORK/." "$BACKUP/"

python3 "$HP/patch-backend.py" "$WORK"
python3 "$HP/patch-index.py" "$WORK/index.html"

docker cp "$HP/vacation-calendar.js" piloto_apoio_backend:/app/dist/domain/rules/vacation-calendar.js
docker cp "$HP/portal-vacation-calendar.controller.js" piloto_apoio_backend:/app/dist/interfaces/http/controllers/portal-vacation-calendar.controller.js
docker cp "$WORK/vacation.repository.js" piloto_apoio_backend:/app/dist/infrastructure/repositories/vacation.repository.js
docker cp "$WORK/vacation.use-case.js" piloto_apoio_backend:/app/dist/application/use-cases/vacation.use-case.js
docker cp "$WORK/routes.index.js" piloto_apoio_backend:/app/dist/interfaces/http/routes/index.js
docker cp "$HP/ferias-calendario.js" piloto_apoio_admin:/usr/share/nginx/html/ferias-calendario.js
docker cp "$WORK/index.html" piloto_apoio_admin:/usr/share/nginx/html/index.html

# Keep a copy on the host volume too.
mkdir -p /opt/pilotodeapoiov2/hotpatches/ferias-calendario-20261015
cp -f "$HP/ferias-calendario.js" /opt/pilotodeapoiov2/hotpatches/ferias-calendario-20261015/ 2>/dev/null || true

docker restart piloto_apoio_backend >/dev/null
echo "ferias-calendario applied; backend restarting"
