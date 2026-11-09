# Chandelier — Plan d'implémentation

Chaque slice se termine par : migration, `npm run typecheck`, `npm run lint`, `npm test` (unitaires + intégration sur PostgreSQL réelle), build, contrôle des permissions (tests 401/403), mise à jour de `REQUIREMENTS.md` et `CHANGELOG.md`. Une slice n'est « Fait » que si ces étapes passent.

| Slice | Contenu | Exigences | Critère de sortie |
|---|---|---|---|
| **S1 Socle** | Monorepo, schéma complet + migration initiale, trigger d'immutabilité du journal, config validée, health/ready, OpenAPI, sessions + CSRF, auth locale, RBAC + périmètre, utilisateurs, unités organisationnelles, journal d'audit, layout et navigation (10 entrées), Docker, CI, scripts backup/restore/migrate, docs DevOps | A-001→A-005, F-042, F-053, F-058, N-001→N-014 | Connexion, CRUD utilisateurs/unités par SUPER_ADMIN, 403 pour les autres, audit consultable ; les entrées de menu non livrées affichent « Fonctionnalité non implémentée » |
| **S2 Registre** | CRUD SIA, archivage motivé, recherche plein texte (tsvector), filtres combinés en URL, tri, pagination serveur, vue table/cartes, colonnes, vues sauvegardées, export CSV/JSON, actions de masse (propriétaire, unité, tags, statut, archivage) | F-001→F-006, F-046 (partiel) | Parcours E2E créer → rechercher → archiver |
| **S3 Fiche 12 étapes** | Wizard, sauvegarde par section, verrou optimiste, complétude calculée serveur, responsabilités, parties prenantes, actifs, traitements, données, personnes, valeur, récapitulatif imprimable, gabarits | F-007, F-009→F-019 | Complétude recalculée et testée |
| **S4 Modèles & fournisseurs** | Référentiels modèles et fournisseurs, liaison N-N avec description d'usage | F-011, F-032 | Un modèle relié à 2 SIA |
| **S5 Moteur AI Act** | Référentiel JSON v1.0.0, import + checksum, moteur pur, questionnaire, résultat explicable, surcharges, génération idempotente des obligations | F-020→F-029 | 100 % des règles testées |
| **S6 Risques** | Méthodologie paramétrable, risques, mesures, scores inhérent/résiduel, plans d'action | F-035, F-036 | Changement de méthodologie sans perte |
| **S7 Documents & workflow** | Upload sécurisé, versions, preuves, historique/diff/restauration, validations par domaine, verrouillage, revues et déclencheurs, commentaires, notifications, affectation de sections | F-018, F-037→F-043, F-052 | Modification substantielle → revue |
| **S8 Dashboard** | KPI calculés, matrice risque×valeur, alertes, widgets cliquables, filtres | F-048→F-050 | Aucune valeur en dur (test) |
| **S9 FRIA, DPIA, notices** | FRIA art. 27, réutilisation DPIA, notices générées depuis les données, versions, validation, exports MD/HTML | F-030, F-031, F-033, F-034 | — |
| **S10 Assistant, import/export, rapports** | Abstraction LLM (disabled/anthropic), suggestions « À vérifier », import CSV/XLSX/JSON transactionnel, exports PDF/DOCX/XLSX, 11 rapports, OIDC Entra | F-008, F-044→F-046, F-051, F-056, F-057 | — |
| Phase 3 | Trust Center, webhooks, Microsoft 365, i18n, tests de charge | F-047, F-054, F-055 | — |

## Ordre de travail S1

1. `package.json` racine (workspaces), TS strict, ESLint, Prettier, Vitest.
2. `packages/shared` : enums, permissions, schémas Zod communs.
3. Prisma : schéma, migration initiale + SQL du trigger d'audit, seed (rôles, référentiels de catégories) et seed DEMO séparé.
4. API : config, plugins, auth, RBAC, audit, modules `auth`, `users`, `org-units`, `roles`, `audit`, `health`.
5. Web : thème GLS (tokens), layout, login, garde, navigation, écrans Administration (utilisateurs, unités, journal), pages « non implémentée ».
6. Tests unitaires (RBAC, mots de passe, config) et intégration (auth, CSRF, CRUD, 401/403, immutabilité du journal).
7. Docker, Caddy, compose, scripts, CI, docs DevOps.
