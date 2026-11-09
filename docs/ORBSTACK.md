# OrbStack (macOS)

Chandelier n'utilise aucune fonction propriétaire d'OrbStack : `docker compose` standard suffit. Les éléments ci-dessous sont des conforts facultatifs.

## Démarrer

```bash
cp .env.example .env
docker compose up -d --build
./scripts/wait-healthy.sh
```

## Adresses

| Accès | URL | Remarque |
|---|---|---|
| localhost | `http://localhost:8080` | Port publié sur 127.0.0.1 uniquement |
| Domaine OrbStack | `https://chandelier.local` | Label `dev.orbstack.domains` du service `web` (modifiable via `ORBSTACK_DOMAIN`) |
| Domaine automatique OrbStack | `https://web.chandelier.orb.local` | Nommage `<service>.<projet>.orb.local` |

OrbStack fournit le HTTPS local pour ses domaines avec une autorité de certification locale qu'il installe dans le trousseau macOS. Le label `dev.orbstack.http-port: "8080"` indique à OrbStack le port HTTP du conteneur. Ces comportements dépendent de la version d'OrbStack : vérifiez dans la documentation OrbStack (« Container domains », « HTTPS ») si le domaine personnalisé ne répond pas.

Si vous utilisez l'adresse HTTPS, mettez `APP_URL=https://chandelier.local` dans `.env` puis `docker compose up -d` : le cookie de session devient `Secure`.

## Réseau et volumes

- Réseaux `chandelier_frontend` (web, api) et `chandelier_backend` (api, postgres ; `internal: true`).
- Les domaines OrbStack ne rendent **pas** PostgreSQL accessible depuis le Mac : il n'a pas de port publié. Pour un outil SQL local, utiliser la surcharge de développement (`docker-compose.dev.yml`), qui publie 5432 sur 127.0.0.1 uniquement.
- Volumes : `chandelier_pgdata`, `chandelier_secrets`, `chandelier_documents` (visibles dans l'onglet Volumes d'OrbStack).

## Recommandations Mac

- FileVault activé (chiffrement au repos des volumes Docker).
- Sauvegardes `backups/` hors du dépôt synchronisé et chiffrées.
