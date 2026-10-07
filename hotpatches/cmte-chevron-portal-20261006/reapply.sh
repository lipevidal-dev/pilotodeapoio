#!/bin/sh
set -e
HP=/opt/pilotodeapoiov2/hotpatches/cmte-chevron-portal-20261006
for f in index.html main-CMTERIGHT07.js chunk-LJCMTE07A.js chunk-UWCMTE07B.js chunk-KLMVE6CF.js; do
  docker cp "$HP/$f" "piloto_apoio_admin:/usr/share/nginx/html/$f"
done
echo cmte-chevron cache-bust reapplied: main-CMTERIGHT07.js
