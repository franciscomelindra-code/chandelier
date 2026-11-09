# Workflow GitHub

## Dépôt

- Dépôt **privé** ; branche `main` protégée (revue obligatoire, CI verte, pas de push forcé).
- Branches de travail : `feat/<slice>-<sujet>`, `fix/<sujet>` ; une PR par tranche ou sous-ensemble cohérent.
- Commits signés recommandés.

## Intégration continue

| Workflow | Déclencheur | Étapes |
|---|---|---|
| `ci.yml` | PR, push sur `main` | `npm ci` → Prisma validate/generate → lint → format → typecheck → tests (unitaires + intégration sur service PostgreSQL 17) → reset + contrôle de dérive des migrations → build → gitleaks |
| `docker-build.yml` | PR, push sur `main` | build des images `api` et `web` en amd64 + arm64 (sans publication) ; démarrage complet `cp .env.example .env && docker compose up -d --build`, contrôles `/healthz`, `/health`, `/ready`, 401 anonyme, persistance après `down`/`up` |

Aucun déploiement automatique ; aucun accès de GitHub Actions au Mac. Le mot de passe PostgreSQL de la CI est une valeur jetable propre au conteneur de service éphémère.

## Secrets

- Jamais dans le code ni dans Git : `.env`, `CLOUDFLARE_TUNNEL_TOKEN`, `ANTHROPIC_API_KEY`, `ENTRA_CLIENT_SECRET`.
- Si un secret devient nécessaire en CI : **GitHub Secrets** (environnement protégé), jamais dans les fichiers de workflow.
- Activer « Secret scanning » et « Push protection » sur le dépôt.

## Premier push

Le dépôt local est initialisé et committé. Pour le publier (après création du dépôt privé sur GitHub) :

```bash
git remote add origin git@github.com:<organisation>/chandelier.git
```

```bash
git push -u origin main
```

## Données

Aucune donnée réelle de GLS France dans le dépôt : uniquement des fixtures `[DEMO]`. Les données réelles sont saisies après déploiement, dans la base locale.
