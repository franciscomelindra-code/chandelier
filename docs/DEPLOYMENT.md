# Déploiement

## 1. Services, ports, réseaux, volumes

| Service | Image | Port hôte | Réseaux | Healthcheck |
|---|---|---|---|---|
| `secrets-init` | `postgres:17-alpine` | — | aucun (`network_mode: none`) | s'arrête après génération |
| `postgres` | `postgres:17-alpine` | **aucun** | `backend` (interne, sans Internet) | `pg_isready` |
| `api` | `chandelier-api:local` (build) | **aucun** | `backend`, `frontend` | `GET /ready` (BDD + migrations) |
| `web` | `chandelier-web:local` (build) | `${WEB_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-8080}` | `frontend` | `GET /healthz` |
| `cloudflared` | `cloudflare/cloudflared` | aucun | `frontend` | profil `cloudflare` uniquement |

| Volume | Contenu | Supprimé par `down` ? |
|---|---|---|
| `chandelier_pgdata` | Base PostgreSQL | Non (seulement `down -v`) |
| `chandelier_secrets` | Mot de passe PostgreSQL, secret de session, mot de passe admin initial | Non |
| `chandelier_documents` | Pièces justificatives (S7) | Non |

Ordre de démarrage garanti : `secrets-init` (terminé) → `postgres` (healthy) → `api` (migrations puis healthy) → `web`.

## 2. Accès local

- `http://localhost:8080` (ou `WEB_PORT`).
- OrbStack : `https://chandelier.local` — voir [ORBSTACK.md](ORBSTACK.md).
- `APP_URL` doit correspondre à l'URL réellement utilisée ; si elle commence par `https://`, le cookie de session est `Secure` et préfixé `__Host-`.

## 3. Première installation

```bash
cp .env.example .env
docker compose up -d --build
./scripts/wait-healthy.sh
docker compose exec api cat /run/chandelier-secrets/initial_admin_password
```

Connectez-vous avec `BOOTSTRAP_ADMIN_EMAIL` et ce mot de passe, puis changez-le (obligatoire). Le fichier peut ensuite être supprimé :

```bash
docker compose exec api rm /run/chandelier-secrets/initial_admin_password
```

## 4. Mise à jour sûre

`./scripts/update.sh` enchaîne : `git pull --ff-only` → sauvegarde (`backups/pre-update/`) → `docker compose build` → `docker compose up -d` → attente healthy.

Si une migration échoue, l'API **ne démarre pas** (le conteneur redémarre en boucle et `docker compose ps` ne la montre pas healthy). PostgreSQL exécute chaque migration Prisma dans une transaction : la base reste dans l'état antérieur à la migration fautive. Procédure de retour arrière : [BACKUP_RESTORE.md](BACKUP_RESTORE.md#retour-arrière-dune-mise-à-jour).

## 5. Variables

Toutes les variables sont documentées dans `.env.example`. Les secrets ne doivent jamais être committés ; `.gitignore` exclut `.env`, `*.pem`, `*.key`, `backups/`, etc.

## 6. Microsoft Entra ID (SSO, OIDC)

1. Dans Entra ID, inscrire une application web : URI de redirection `https://<votre-hôte>/api/v1/auth/oidc/callback` (ou `ENTRA_REDIRECT_URI`), créer un secret client, autorisations `openid profile email`.
2. Déposer le secret dans le volume des secrets (aucun secret dans Git) :

   ```bash
   docker compose run --rm --entrypoint sh api -c 'umask 077; cat > /run/chandelier-secrets/entra_client_secret'
   ```

   (coller le secret, puis Ctrl+D). À défaut, `ENTRA_CLIENT_SECRET` dans `.env` (jamais versionné). Ces commandes n'ont pas été exécutées (Docker indisponible sur le poste de développement) : vérifier les droits d'écriture sur le volume lors du premier essai.
3. Dans `.env` : `AUTH_MODE=oidc`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, et `APP_URL` en https. Redémarrer : `docker compose up -d`.
4. Créer les comptes dans Administration › Utilisateurs avec le mode « Microsoft Entra ID (SSO) » et l'adresse du compte Entra : **aucun compte n'est créé automatiquement**. Les rôles se gèrent dans Chandelier.
5. La connexion locale est alors désactivée ; `AUTH_LOCAL_FALLBACK=true` conserve un compte de secours local (à réserver au super administrateur, mot de passe robuste).

La MFA et l'accès conditionnel relèvent d'Entra ID. **Vérifié uniquement avec un fournisseur OIDC simulé dans les tests** (PKCE, state, nonce, signature, audience, comptes non provisionnés refusés) : à valider sur le tenant GLS France.

## 7. Assistant IA (désactivé par défaut)

L'activation transmet des données au fournisseur (API Anthropic) : **elle requiert une validation préalable DPO / RSSI** (contrat, localisation, conservation). Puis :

```bash
docker compose run --rm --entrypoint sh api -c 'umask 077; cat > /run/chandelier-secrets/anthropic_api_key'
```

et dans `.env` : `LLM_PROVIDER=anthropic` (modèle `ANTHROPIC_MODEL`, par défaut `claude-opus-5-5`). Les appels utilisent le SDK officiel avec repli serveur en cas de refus (`fallbacks: "default"`). **Jamais appelé réellement pendant le développement** (tests avec un fournisseur simulé).

## 8. Ce qui a été vérifié et ce qui ne l'a pas été

- Vérifié sur le poste de développement Windows (sans Docker) : build, lint, typecheck, tests unitaires et d'intégration sur PostgreSQL 17 réelle (178 à la tranche S10), parcours navigateur de chaque tranche.
- Simulé localement : installation des dépendances de production de l'image API.
- **Non exécuté à ce jour** : `docker compose build/up` (Docker indisponible sur le poste de développement). Le workflow `docker-build.yml` exécute ce scénario en CI (build amd64 + arm64, démarrage, santé, persistance après `down`/`up`). À valider sur le Mac OrbStack avant tout usage.
