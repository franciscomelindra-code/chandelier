#!/bin/sh
# Génère, au premier démarrage uniquement, les secrets manquants dans le volume chandelier_secrets.
# Aucun mot de passe par défaut : valeurs aléatoires (256 bits). Les fichiers existants ne sont jamais écrasés.
set -eu
DIR=/run/chandelier-secrets
mkdir -p "$DIR"

gen() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if [ ! -s "$DIR/postgres_password" ]; then
  if [ -n "${POSTGRES_PASSWORD:-}" ]; then printf '%s' "$POSTGRES_PASSWORD" > "$DIR/postgres_password"; else gen > "$DIR/postgres_password"; fi
  echo "secret postgres_password créé"
fi
if [ ! -s "$DIR/session_secret" ]; then
  if [ -n "${SESSION_SECRET:-}" ]; then printf '%s' "$SESSION_SECRET" > "$DIR/session_secret"; else gen > "$DIR/session_secret"; fi
  echo "secret session_secret créé"
fi

# postgres (uid 70) et api (uid 1000) lisent ces fichiers ; le volume n'est monté que dans ces conteneurs.
chmod 0444 "$DIR/postgres_password" "$DIR/session_secret"
# L'API (uid 1000) écrit le mot de passe administrateur initial dans ce répertoire.
chown 1000:1000 "$DIR"
chmod 0750 "$DIR"
# postgres doit pouvoir traverser le répertoire.
chmod o+x "$DIR"
echo "secrets prêts"
