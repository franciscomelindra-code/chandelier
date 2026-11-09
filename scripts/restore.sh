#!/usr/bin/env bash
# Restauration de Chandelier à partir d'une sauvegarde produite par scripts/backup.sh.
# Usage : ./scripts/restore.sh backups/chandelier-db-AAAAMMJJ-HHMMSS.dump [backups/chandelier-documents-….tar.gz]
# Sécurité : une sauvegarde de l'état COURANT est faite avant toute restauration.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_FILE="${1:-}"
DOC_FILE="${2:-}"
if [ -z "$DB_FILE" ] || [ ! -f "$DB_FILE" ]; then
  echo "Usage : $0 <fichier .dump> [archive documents .tar.gz]" >&2
  exit 1
fi

POSTGRES_DB=chandelier
POSTGRES_USER=chandelier
if [ -f .env ]; then set -a; . ./.env; set +a; fi
POSTGRES_DB="${POSTGRES_DB:-chandelier}"
POSTGRES_USER="${POSTGRES_USER:-chandelier}"

SUM_FILE="$(dirname "$DB_FILE")/chandelier-$(basename "$DB_FILE" | sed -E 's/^chandelier-db-(.*)\.dump$/\1/').sha256"
if [ -f "$SUM_FILE" ]; then
  echo "→ Vérification de l'empreinte SHA-256"
  ( cd "$(dirname "$DB_FILE")" && sha256sum --check --ignore-missing "$(basename "$SUM_FILE")" )
fi

echo "ATTENTION : la base « $POSTGRES_DB » va être REMPLACÉE par $DB_FILE."
read -r -p "Tapez RESTAURER pour confirmer : " answer
[ "$answer" = "RESTAURER" ] || { echo "Annulé."; exit 1; }

docker compose up -d postgres
echo "→ Sauvegarde de sécurité de l'état actuel"
./scripts/backup.sh ./backups/pre-restore

echo "→ Arrêt de l'API et du web"
docker compose stop web api

echo "→ Recréation de la base"
docker compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error <"$DB_FILE"

if [ -n "$DOC_FILE" ]; then
  echo "→ Restauration des documents"
  docker run --rm -i -v chandelier_documents:/data alpine:3 sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf -' <"$DOC_FILE"
fi

echo "→ Redémarrage (les migrations manquantes éventuelles sont appliquées au démarrage de l'API)"
docker compose up -d
echo "Restauration terminée. Vérifiez : docker compose ps"
