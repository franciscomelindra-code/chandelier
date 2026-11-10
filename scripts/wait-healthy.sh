#!/usr/bin/env bash
# Attend que postgres, api et web soient "healthy". Usage : ./scripts/wait-healthy.sh [délai_en_secondes]
set -euo pipefail
cd "$(dirname "$0")/.."
TIMEOUT="${1:-180}"
END=$(( $(date +%s) + TIMEOUT ))
while [ "$(date +%s)" -lt "$END" ]; do
  ok=0
  for s in postgres api web; do
    id="$(docker compose ps -q "$s" || true)"
    [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = "healthy" ] && ok=$((ok + 1))
  done
  if [ "$ok" -eq 3 ]; then
    docker compose ps
    echo "Tous les services sont healthy. Application : http://localhost:${WEB_PORT:-8080}"
    exit 0
  fi
  sleep 3
done
docker compose ps
echo "Délai dépassé : un service n'est pas healthy (docker compose logs --tail=100)." >&2
exit 1
