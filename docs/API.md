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

## Routes livrées (S2 — registre)

| Méthode | Route | Permission / contrôle |
|---|---|---|
| GET | `/api/v1/ai-systems` | `aiSystem:read`, limité au périmètre. Paramètres : `q` (plein texte français + préfixes + référence), `status`, `risk`, `value`, `role`, `compliance` (listes séparées par des virgules), `orgUnitId` (sous-unités incluses), `ownerId`, `tagId`, `personalData`, `reviewBefore`, `archived` (`exclude`/`include`/`only`), `demo`, `sort`, `dir`, `page`, `pageSize` |
| GET | `/api/v1/ai-systems/export?format=csv\|json` | `aiSystem:export`, mêmes filtres ; CSV avec en-têtes de compatibilité §5.12 ; export journalisé |
| GET | `/api/v1/ai-systems/:id` | lecture dans le périmètre, sinon **404** (pas de fuite d’existence) |
| GET | `/api/v1/ai-systems/:id/history` | lecture du SIA |
| POST | `/api/v1/ai-systems` | `aiSystem:create` sur l’unité cible ; référence `SIA-0001…` automatique |
| PATCH | `/api/v1/ai-systems/:id` | `version` obligatoire (409 `VERSION_CONFLICT`) ; contrôle `aiSystem:update` **par section** (`own`, `assigned`) ; SIA archivé → 409 |
| POST | `/api/v1/ai-systems/:id/archive`, `/restore` | `aiSystem:archive`, justification ≥ 10 caractères |
| POST | `/api/v1/ai-systems/bulk` | `assignOwner`, `setOrgUnit`, `setStatus`, `addTags`, `removeTags`, `archive` — **tout ou rien** (403 avec la liste des références refusées) |
| GET, POST | `/api/v1/tags` | session ; création si `aiSystem:create` ou `aiSystem:update` |
| GET, POST, DELETE | `/api/v1/saved-views` | vues personnelles ; partagées visibles de tous (le contenu reste filtré par périmètre) ; suppression par le propriétaire seulement |

## Routes livrées (S3 — fiche en 12 étapes et référentiels)

Chaque route de section vérifie la visibilité du SIA, l’absence d’archivage et le droit `aiSystem:update` **sur la section concernée**, puis incrémente la version, recalcule la complétude, crée un instantané et journalise. Elle renvoie la fiche à jour.

| Méthode | Route | Section |
|---|---|---|
| POST / PATCH / DELETE | `/api/v1/ai-systems/:id/stakeholders[/:linkId]` | `responsibility` (sponsor, DSI, RSSI, DPO/juridique, fournisseur, intégrateur, resp. métier) ou `stakeholders` (autres) |
| POST / DELETE | `/api/v1/ai-systems/:id/assets[/:assetId]` | `assets` |
| POST / DELETE | `/api/v1/ai-systems/:id/processing[/:processingActivityId]` | `processing` |
| POST / DELETE | `/api/v1/ai-systems/:id/datasets[/:datasetId]` | `data` (usages obligatoires) |
| PUT | `/api/v1/ai-systems/:id/data-categories` | `data` |
| PUT | `/api/v1/ai-systems/:id/data-subjects` | `subjects` |
| GET / POST / DELETE | `/api/v1/ai-systems/:id/assignments[/:assignmentId]` | lecture : lecteurs du SIA ; écriture : droit sur `responsibility` hors simple affectation |
| PATCH | `/api/v1/ai-systems/:id` | accepte aussi `valueDetails` (fusion partielle) et `raciEnabled` |
| POST | `/api/v1/ai-systems` | accepte `templateId` (création depuis un gabarit) |

Référentiels (lecture : session ; écriture : `catalog:manage` ; suppression refusée si rattaché à un SIA — 409) :
`/api/v1/stakeholders`, `/api/v1/assets`, `/api/v1/datasets`, `/api/v1/processing-activities` (GET, POST, PATCH `/:id`, DELETE `/:id`) ; `/api/v1/data-categories`, `/api/v1/data-subject-categories` (GET) ; `/api/v1/system-templates` (GET, POST depuis un SIA, POST `/:id/deactivate`).

## Routes livrées (S4 — modèles d’IA et fournisseurs)

| Méthode | Route | Contrôle |
|---|---|---|
| GET, POST, PATCH, DELETE | `/api/v1/vendors[/:id]` | lecture : session ; écriture : `catalog:manage` ; suppression refusée si lié à un SIA, un modèle ou un actif |
| GET, POST, PATCH, DELETE | `/api/v1/ai-models[/:id]` | idem ; unicité nom + version + fournisseur (409) ; URL de documentation `http(s)` uniquement, jamais récupérée par le serveur |
| GET | `/api/v1/ai-models/:id` | fiche + SIA utilisateurs **limités au périmètre** (`hiddenSystems` = nombre hors périmètre), avec la description d’usage de chaque lien |
| POST / PATCH / DELETE | `/api/v1/ai-systems/:id/models[/:linkId]` | section `models` ; `usageDescription` ≥ 10 caractères ; un seul modèle principal |
| POST / DELETE | `/api/v1/ai-systems/:id/vendors[/:vendorId/:relation]` | section `responsibility` |
| GET | `/api/v1/ai-systems?vendorId=…&modelId=…` | `vendorId` couvre le fournisseur déclaré **et** l’éditeur d’un modèle utilisé |

## Routes livrées (S5 — qualification AI Act)

| Méthode | Route | Contrôle |
|---|---|---|
| GET | `/api/v1/regulatory-frameworks[/:id]` | `aiSystem:read` ; contenu complet d’une version |
| GET | `/api/v1/assessments?status=NONE\|DRAFT\|COMPLETED\|VALIDATED` | portefeuille du périmètre |
| GET | `/api/v1/ai-systems/:id/assessments[/:aid]` | détail : réponses, `computedResult`, `effectiveResult`, surcharges, `preview` (brouillon), `suggestions` |
| POST | `/api/v1/ai-systems/:id/assessments` | `assessment:run` (qualificatif `own`) ; un seul brouillon (409) |
| PATCH | `/api/v1/ai-systems/:id/assessments/:aid` | brouillon uniquement ; réponses validées contre le référentiel ; `null` efface |
| POST | `…/:aid/complete` | calcul, remplacement de la qualification précédente, mise à jour du SIA, obligations |
| POST | `…/:aid/overrides` | `assessment:override` ; `{ dimension, value, justification ≥ 20 }` |
| POST | `…/:aid/validate` | `assessment:validate` ; validateur ≠ auteur du calcul (403) |
| GET | `/api/v1/ai-systems/:id/obligations` | liste + `canUpdate` + `complianceStatus` |
| PATCH | `/api/v1/obligations/:id` | `obligation:update` (qualificatif `own`) ; commentaire requis si non applicable |

## Routes livrées (S6 — risques, mesures, plans d’action)

| Méthode | Route | Contrôle |
|---|---|---|
| GET | `/api/v1/risk-methodologies` | `aiSystem:read` ; versions, configuration, nombre de risques cotés |
| POST | `/api/v1/risk-methodologies` | `settings:manage` ; nouvelle version **inactive**, configuration validée (échelles 2–10 niveaux contiguës, seuils croissants) |
| PATCH | `/api/v1/risk-methodologies/:id` | `settings:manage` ; uniquement une version jamais activée et non utilisée (409 sinon) |
| POST | `/api/v1/risk-methodologies/:id/activate` | `settings:manage` ; motif ≥ 10 ; les risques existants gardent leur version |
| GET | `/api/v1/risks?q&category&status&level&warning&cell&includeClosed&demo&sort&dir&page&pageSize` | portefeuille du périmètre (SIA non archivés) + `heatmap`, `levelCounts`, méthodologie active ; filtrage par niveau après calcul (plafond 5 000, signalé par `truncated`) |
| GET / POST | `/api/v1/ai-systems/:id/risks` | lecture ; création `risk:manage` (qualificatif `own`), méthodologie active, référence `RSK-####` |
| GET | `/api/v1/risks/:id`, `/api/v1/risks/:id/history` | 404 hors périmètre ; historique = journal d’audit du risque |
| PATCH | `/api/v1/risks/:id` | `risk:manage` ; `version` (verrou optimiste, 409) ; règles : cotation dans l’échelle, résiduel ≤ inhérent, acceptation motivée (≥ 20) et réservée à `assessment:validate` pour le niveau le plus élevé, clôture refusée si action liée ouverte (409) |
| POST | `/api/v1/risks/:id/rescore` | passage à la méthodologie active ; motif ≥ 10 ; invalide une acceptation antérieure |
| GET / POST | `/api/v1/ai-systems/:id/measures` | mesures du SIA ; création avec rattachement optionnel `riskId` |
| PATCH | `/api/v1/measures/:id` | `risk:manage` |
| POST / DELETE | `/api/v1/risks/:id/measures[/:measureId]` | rattacher / détacher une mesure **du même SIA** |
| GET | `/api/v1/actions?q&aiSystemId&riskId&obligationId&status&priority&assigneeId&mine&overdue&demo&sort&dir&page&pageSize` | actions du périmètre + `overdueCount` ; droits par ligne |
| GET | `/api/v1/ai-systems/:id/actions`, `/api/v1/actions/:id` | lecture |
| POST | `/api/v1/actions` | `action:manage` (qualificatif `own`) ; `aiSystemId` obligatoire ; risque / obligation / mesure du même SIA (400 sinon) ; référence `ACT-####` |
| PATCH | `/api/v1/actions/:id` | `action:manage`, ou responsable de l’action limité à `status` / `closureComment` ; annulation motivée |

Webhooks et intégrations Microsoft 365 : non implémentés (phase 3).
