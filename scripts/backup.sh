#!/usr/bin/env bash
# Sauvegarde cohérente de Chandelier : base PostgreSQL (format custom) + volume documents.
# Usage : ./scripts/backup.sh [répertoire]   (défaut : ./backups, ignoré par Git)
# Les sauvegardes contiennent tout le registre : stockez-les chiffrées (voir docs/BACKUP_RESTORE.md).
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
chmod 700 "$DEST"
umask 077

# Valeurs par défaut identiques à docker-compose.yml ; surchargées par .env si présent.
POSTGRES_DB=chandelier
POSTGRES_USER=chandelier
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
POSTGRES_DB="${POSTGRES_DB:-chandelier}"
POSTGRES_USER="${POSTGRES_USER:-chandelier}"

if ! docker compose ps --status running --services | grep -qx postgres; then
  echo "Le service postgres n'est pas démarré (docker compose up -d postgres)." >&2
  exit 1
fi

DB_FILE="$DEST/chandelier-db-$STAMP.dump"
DOC_FILE="$DEST/chandelier-documents-$STAMP.tar.gz"

echo "→ Base de données → $DB_FILE"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner >"$DB_FILE"

echo "→ Documents → $DOC_FILE"
docker run --rm -v chandelier_documents:/data:ro alpine:3 tar -C /data -czf - . >"$DOC_FILE"

# Contrôle d'intégrité.
docker compose exec -T postgres pg_restore --list >/dev/null <"$DB_FILE"
( cd "$DEST" && sha256sum "$(basename "$DB_FILE")" "$(basename "$DOC_FILE")" >"chandelier-$STAMP.sha256" )

echo "Sauvegarde terminée :"
ls -l "$DB_FILE" "$DOC_FILE" "$DEST/chandelier-$STAMP.sha256"
