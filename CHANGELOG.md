# Journal des modifications

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnement sémantique.

## [0.2.0] — 2026-11-10 — Slice S2 : registre des SIA

### Ajouté
- Migration `s2_registry` : recherche plein texte française (colonne `tsvector` maintenue par trigger, index GIN), statut mémorisé avant archivage.
- API registre : liste filtrée par périmètre (recherche, filtres combinés, sous-unités, tri, pagination serveur), fiche, création (référence automatique), modification partielle avec verrou optimiste et contrôle par section (`own` / `assigned`), archivage et restauration motivés, historique par SIA, instantanés de version, export CSV (en-têtes §5.12) / JSON journalisé, actions de masse transactionnelles « tout ou rien », tags, vues sauvegardées personnelles et partagées.
- Complétude calculée côté serveur avec critères explicites.
- Interface : registre (tableau / cartes, filtres dans l’URL, colonnes, vues, sélection et actions de masse, exports), création, fiche (en-tête fixe, sections éditables selon les droits, complétude, historique, archivage/restauration, impression).
- Jeu DEMO : `SIA-DEMO-001` et `SIA-DEMO-002` (fictifs, création journalisée).
- 25 tests supplémentaires (64 au total).

## [0.1.0] — 2026-11-10 — Slice S1 : socle

### Ajouté
- Analyse du cahier des charges : matrice d'exigences, hypothèses (`docs/REQUIREMENTS.md`), architecture, modèle de données, référentiel AI Act (projet v1.0.0), sécurité, plan d'implémentation.
- Schéma Prisma complet (toutes tranches) et migration initiale ; triggers d'immutabilité sur `audit_event`, `assessment_override`, `entity_version`.
- API Fastify : configuration validée, sessions serveur, CSRF, authentification locale argon2id avec verrouillage et limitation de débit, RBAC à périmètre et qualificatifs, utilisateurs, unités organisationnelles, rôles, journal d'audit (consultation, export CSV), `/health`, `/ready`, OpenAPI.
- Interface React : connexion, changement de mot de passe imposé, navigation principale (10 entrées, modules à venir signalés « Fonctionnalité non implémentée »), administration (utilisateurs, unités, matrice des rôles, journal).
- Données de référence (rôles, catégories RGPD, méthodologie de risque 4×4) et jeu `[DEMO]` facultatif (unités fictives).
- Docker multi-stage (api, web/Caddy), Compose (réseau interne, secrets générés, volumes persistants, labels OrbStack, profil Cloudflare), scripts backup/restore/migrate/update, CI GitHub Actions.
- 39 tests automatisés (unitaires + intégration PostgreSQL).
