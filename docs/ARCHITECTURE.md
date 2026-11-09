# Chandelier — Architecture

## 1. Vue d'ensemble

```
Navigateur ──HTTPS──▶ web (Caddy : SPA statique + reverse proxy /api) ──HTTP réseau interne──▶ api (Fastify) ──▶ postgres
                                                                                               │
                                                                                               └──▶ volume documents
```

| Service | Image | Exposé sur l'hôte | Rôle |
|---|---|---|---|
| `web` | `caddy:2-alpine` + build Vite | `${WEB_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-8080}` | Sert la SPA, en-têtes de sécurité (CSP…), proxy `/api/*` vers `api:3000` |
| `api` | `node:22-bookworm-slim` multi-stage | **non** | API REST `/api/v1`, OpenAPI, règles métier, RBAC, migrations au démarrage |
| `postgres` | `postgres:17-alpine` | **non** | Persistance (volume `chandelier_pgdata`) |
| `cloudflared` | `cloudflare/cloudflared` | non (profil `cloudflare`, facultatif) | Tunnel sortant, désactivé par défaut |

Toutes les images utilisées sont multi-architecture (amd64 + arm64 / Apple Silicon).

Le navigateur ne parle qu'à `web` ; seul `api` détient `DATABASE_URL`. PostgreSQL n'a aucun port publié.

## 2. Choix techniques

| Domaine | Choix | Justification |
|---|---|---|
| Monorepo | npm workspaces (`apps/api`, `apps/web`, `packages/shared`) | Aucun outil supplémentaire ; types et règles partagés |
| Front | React 19 + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS 4 | Préférence CDC §8 ; SPA simple à servir en statique |
| Back | Fastify 5 + TypeScript + Zod (`fastify-type-provider-zod`) | Plus léger que NestJS ; la validation Zod génère aussi l'OpenAPI → une seule source de vérité |
| ORM | Prisma 6 | Préférence CDC ; migrations SQL versionnées et relisibles |
| BDD | PostgreSQL 17 | CDC §8 ; triggers pour l'immutabilité du journal, `tsvector` pour la recherche |
| Auth | Sessions serveur (cookie `HttpOnly`) + abstraction `AuthProvider` (`local` / `oidc`) | Révocation immédiate, pas de jeton dans le navigateur ; Entra ID branché sans toucher au métier |
| Hash | argon2id (`@node-rs/argon2`, binaires précompilés multi-arch) | Recommandation OWASP |
| Tests | Vitest (unitaires + intégration API sur vraie PostgreSQL), Playwright (E2E, slice ultérieure) | — |
| Build API | tsup (bundle ESM, inclut `@chandelier/shared`) | Image finale sans sources TS ni devDependencies |
| Reverse proxy | Caddy | Config courte, en-têtes de sécurité, HTTPS automatique si un domaine est fourni |

## 3. Découpage du code

```
apps/api/src/
  app.ts                 construction Fastify (plugins, routes) — testable sans réseau
  server.ts              point d'entrée (écoute, arrêt propre)
  config.ts              lecture/validation des variables d'environnement (Zod) — échec au démarrage si invalide
  plugins/               db, security-headers, session, csrf, error-handler, openapi
  auth/                  AuthProvider (local, oidc), sessions, mots de passe
  rbac/                  résolution des permissions et du périmètre, garde-fous objet
  audit/                 écriture du journal (diff ancien/nouveau)
  modules/<domaine>/     routes + service + schémas par domaine (users, org-units, ai-systems…)
  cli/                   commandes d'administration (création du premier admin, seed démo)
apps/web/src/
  app/                   routeur, layout, garde d'authentification
  components/            composants UI (Button, Badge, DataTable, Field…)
  features/<domaine>/    écrans par domaine
  lib/                   client API (CSRF, erreurs), formatage
packages/shared/src/
  enums.ts, permissions.ts, schemas/, ai-act/ (moteur pur), risk/ (scoring)
prisma/
  schema.prisma, migrations/, seed.ts
referentials/ai-act/     référentiel réglementaire versionné (JSON) chargé en BDD
```

Règle : la logique métier vit dans les *services* API et dans `packages/shared` (fonctions pures testables). Les routes ne font que valider, autoriser, appeler, sérialiser.

## 4. Flux d'une requête d'écriture

1. Caddy → `api` ; `requestId` attribué.
2. Session : cookie → hash SHA-256 → ligne `session` (expiration glissante + absolue).
3. CSRF : en-tête `X-CSRF-Token` comparé au jeton de session (méthodes non sûres).
4. Validation Zod du corps / paramètres (rejet 400 détaillé).
5. Autorisation : permission + périmètre (unité) + contrôle objet.
6. Service : transaction Prisma ; écriture métier + `audit_event` (+ `entity_version` si objet versionné) dans **la même transaction**.
7. Réponse sérialisée par schéma (pas de fuite de champ interne comme `passwordHash`).

## 5. Moteur réglementaire

Séparé du code applicatif : le référentiel (questions, règles, modèles d'obligations) est un fichier JSON versionné (`referentials/ai-act/*.json`), importé en table `regulatory_framework`. Le moteur (`packages/shared/src/ai-act`) est une fonction pure `evaluate(framework, answers) → result` ; les conditions sont un mini-langage JSON déclaratif (pas d'`eval`). Détails : `AI_ACT_RULES.md`.

## 6. Assistant IA (S10)

Interface `LlmProvider` (`complete(prompt, schema)`), implémentations `disabled` (défaut) et `anthropic` (clé côté serveur uniquement). Les sorties sont stockées en `assistant_suggestion` statut `TO_VERIFY` ; seule une action humaine les applique, via le même service que la saisie manuelle (donc mêmes droits, même audit, origine `ASSISTANT`).

## 7. Authentification Entra ID (phase 3)

`AUTH_MODE=oidc` : flux Authorization Code + PKCE (bibliothèque `openid-client`), correspondance utilisateur par `oid` (`user.externalId`), rôles via groupes Entra mappés en configuration. Le reste de l'application ne dépend que de `request.user`. MFA délégué à Entra (accès conditionnel).

## 8. Environnements

| Environnement | BDD | Lancement |
|---|---|---|
| Mac OrbStack / Docker | conteneur `postgres` | `docker compose up -d --build` |
| Dev sans Docker (poste Windows) | PostgreSQL embarqué (`npm run db:embedded`) | `npm run dev` |
| CI GitHub Actions | service `postgres:17` | workflow `ci.yml` |
