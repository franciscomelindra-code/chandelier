# API

- Base : `/api/v1`. Spécification OpenAPI 3.1 générée depuis les schémas Zod : `/api/docs` (interface) et `/api/docs/json` — accessibles après connexion.
- Authentification : cookie de session (`POST /api/v1/auth/login`). Les clients non navigateur conservent le cookie renvoyé.
- CSRF : en-tête `X-CSRF-Token` (valeur de `GET /api/v1/auth/me` ou `/auth/session`) obligatoire sur POST, PUT, PATCH, DELETE.
- Erreurs : `{ "error": { "code", "message", "details?" } }` — `400 VALIDATION`, `401 UNAUTHORIZED`, `403 FORBIDDEN | CSRF | PASSWORD_CHANGE_REQUIRED`, `404 NOT_FOUND`, `409 CONFLICT`, `429` (limitation), `500 INTERNAL` (avec `requestId`).
- Pagination : `page`, `pageSize` (≤ 200) → `{ items, total, page, pageSize }`.

## Routes livrées (S1)

| Méthode | Route | Permission |
|---|---|---|
| GET | `/health`, `/ready` (aussi sous `/api/v1`) | public |
| POST | `/api/v1/auth/login` | public, 10/min/IP |
| POST | `/api/v1/auth/logout` | session |
| GET | `/api/v1/auth/me` | session |
| GET | `/api/v1/auth/session` | public (état de session) |
| POST | `/api/v1/auth/change-password` | session |
| GET | `/api/v1/users`, `/api/v1/users/:id` | `user:read` (rôles visibles avec `user:manage`) |
| POST | `/api/v1/users` | `user:manage` |
| PATCH | `/api/v1/users/:id` | `user:manage` |
| POST | `/api/v1/users/:id/reset-password` | `user:manage` |
| GET | `/api/v1/org-units` | session |
| POST, PATCH | `/api/v1/org-units[/:id]` | `orgUnit:manage` |
| GET | `/api/v1/roles` | `user:read` |
| GET | `/api/v1/audit-events`, `/api/v1/audit-events/export.csv` | `audit:read` |

Webhooks et intégrations Microsoft 365 : non implémentés (phase 3).
