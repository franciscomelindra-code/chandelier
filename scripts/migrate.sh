#!/usr/bin/env bash
# Applique les migrations en attente APRÈS une sauvegarde.
# (L'API applique aussi les migrations à son démarrage ; ce script permet de le faire explicitement.)
# Usage : ./scripts/migrate.sh [status]
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "status" ]; then
  docker compose run --rm --no-deps --entrypoint sh api -c \
    'export DATABASE_URL="postgresql://${POSTGRES_USER}:$(cat $SECRETS_DIR/postgres_password)@postgres:5432/${POSTGRES_DB}"; node_modules/.bin/prisma migrate status --schema prisma/schema.prisma'
  exit 0
fi

./scripts/backup.sh ./backups/pre-migration
docker compose run --rm --no-deps --entrypoint sh api -c \
  'export DATABASE_URL="postgresql://${POSTGRES_USER}:$(cat $SECRETS_DIR/postgres_password)@postgres:5432/${POSTGRES_DB}"; node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'
echo "Migrations appliquées. En cas de problème : ./scripts/restore.sh backups/pre-migration/<fichier>.dump"
