#!/bin/sh
# Point d'entrée de l'API : construit l'URL BDD à partir du secret, applique les migrations, démarre.
# Une migration en échec arrête le conteneur (aucun démarrage sur un schéma incohérent) ;
# PostgreSQL exécute chaque migration dans une transaction : les données ne sont pas altérées.
set -eu

SECRETS_DIR="${SECRETS_DIR:-/run/chandelier-secrets}"
export SECRETS_DIR

if [ -z "${DATABASE_URL:-}" ]; then
  if [ -n "${POSTGRES_PASSWORD:-}" ]; then
    PGPASS="$POSTGRES_PASSWORD"
  elif [ -r "$SECRETS_DIR/postgres_password" ]; then
    PGPASS="$(cat "$SECRETS_DIR/postgres_password")"
  else
    echo "Mot de passe PostgreSQL introuvable (POSTGRES_PASSWORD ou $SECRETS_DIR/postgres_password)" >&2
    exit 1
  fi
  # Mot de passe hexadécimal généré : pas d'encodage URL nécessaire.
  DATABASE_URL="postgresql://${POSTGRES_USER}:${PGPASS}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"
  export DATABASE_URL
fi

echo "Application des migrations…"
node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

exec node dist/server.js
