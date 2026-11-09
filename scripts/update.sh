#!/usr/bin/env bash
# Mise à jour sûre depuis GitHub : pull → sauvegarde → build → redémarrage (migrations) → contrôle de santé.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Récupération du code"
git pull --ff-only

echo "→ Sauvegarde préalable"
./scripts/backup.sh ./backups/pre-update

echo "→ Construction des images"
docker compose build

echo "→ Redémarrage (l'API applique les migrations ; en cas d'échec elle ne démarre pas)"
docker compose up -d

echo "→ Attente de l'état healthy"
if ./scripts/wait-healthy.sh 240; then
  echo "Mise à jour terminée."
else
  echo "Journaux : docker compose logs api --tail=100" >&2
  echo "Retour arrière : git checkout <version précédente> && ./scripts/restore.sh backups/pre-update/<fichier>.dump" >&2
  exit 1
fi
