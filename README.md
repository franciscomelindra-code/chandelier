# Chandelier

Application de gouvernance et de pilotage des systèmes d'intelligence artificielle (SIA) de GLS France : registre, référentiel des modèles, qualification AI Act (règlement (UE) 2024/1689), risques, FRIA, articulation RGPD, preuves et traçabilité.

> **État : tranches S1 (socle), S2 (registre des SIA), S3 (fiche en 12 étapes, référentiels), S4 (modèles d'IA, fournisseurs), S5 (moteur de qualification AI Act), S6 (risques, mesures, plans d'action) S7 (documents, validations, revues, collaboration) S8 (tableau de bord) et S9 (FRIA, DPIA, notices) livrées.** Authentification, utilisateurs, unités organisationnelles, RBAC avec périmètres, journal d'audit immuable, registre des SIA (recherche plein texte, filtres, vues, actions de masse, export, archivage motivé), API OpenAPI, Docker et CI. Les modules métier (registre, qualification, risques…) arrivent par tranches : voir [Fonctionnalités](#fonctionnalités) et [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Les écrans non livrés affichent « Fonctionnalité non implémentée ».

Le dépôt ne contient **aucune donnée réelle de GLS France** ni aucun secret. Le seul jeu de données facultatif est marqué `[DEMO]`.

## Démarrage (Docker / OrbStack)

Prérequis : Docker Engine + Compose v2 (Docker Desktop, OrbStack, Colima…). Images multi-architecture (Apple Silicon compris).

```bash
git clone <url-du-depot> chandelier
cd chandelier
cp .env.example .env
docker compose up -d --build
```

Puis :

```bash
./scripts/wait-healthy.sh
```

Application : **http://localhost:8080** (ou `https://chandelier.local` avec OrbStack, voir [docs/ORBSTACK.md](docs/ORBSTACK.md)).

### Première connexion

Aucun mot de passe par défaut : au premier démarrage, un compte `admin@chandelier.local` (modifiable via `BOOTSTRAP_ADMIN_EMAIL`) est créé avec un mot de passe **aléatoire**, à changer à la première connexion :

```bash
docker compose exec api cat /run/chandelier-secrets/initial_admin_password
```

Les secrets techniques (mot de passe PostgreSQL, secret de session) sont générés aléatoirement dans le volume `chandelier_secrets`.

## Commandes d'exploitation

| Besoin | Commande |
|---|---|
| État | `docker compose ps` |
| Journaux | `docker compose logs -f` (ou `docker compose logs -f api`) |
| Migrations (avec sauvegarde préalable) | `./scripts/migrate.sh` |
| État des migrations | `./scripts/migrate.sh status` |
| Créer un administrateur | `docker compose exec api node dist/cli/create-admin.js --email a@b.fr --name "Nom"` |
| Arrêt (données conservées) | `docker compose down` |
| Reconstruction | `docker compose up -d --build` |
| Sauvegarde | `./scripts/backup.sh` |
| Restauration | `./scripts/restore.sh backups/chandelier-db-<date>.dump [backups/chandelier-documents-<date>.tar.gz]` |
| Mise à jour depuis GitHub | `./scripts/update.sh` (= `git pull` + sauvegarde + build + redémarrage + contrôle de santé) |
| Jeu de démonstration fictif | `SEED_DEMO=true` dans `.env`, puis `docker compose up -d` |

`docker compose down` ne supprime **pas** les volumes. Seul `docker compose down -v` les supprime : ne l'utilisez jamais sans sauvegarde.

## Développement local sans Docker

Node.js ≥ 22.12.

```bash
npm ci
cp .env.example .env
```

Dans `.env` : `NODE_ENV=development`, `APP_URL=http://localhost:5173`, `DATABASE_URL`, `DATABASE_URL_TEST` (nom contenant « test »), `SESSION_SECRET` (`openssl rand -hex 32`). Sans PostgreSQL installé, définir `EMBEDDED_PG_PASSWORD` et lancer une base embarquée (binaires PostgreSQL officiels via npm, dev uniquement) :

```bash
npm run db:embedded
```

Puis, dans d'autres terminaux :

```bash
npx prisma migrate deploy
```

```bash
npm run admin:create -- --email admin@example.org --name "Admin local"
```

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Interface : http://localhost:5173 (proxy vers l'API sur le port 3000).

### Qualité

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

`npm test` exécute les tests unitaires (shared, web) et d'intégration (API sur une vraie PostgreSQL : la base `DATABASE_URL_TEST` est **réinitialisée**).

## Structure

```
apps/api        API Fastify + Prisma (REST /api/v1, OpenAPI sur /api/docs)
apps/web        Interface React + Vite + Tailwind (charte GLS France)
packages/shared Rôles/permissions, schémas Zod, libellés partagés
prisma          Schéma, migrations, seeds
docker          Caddyfile, entrypoint API, génération des secrets
scripts         backup / restore / migrate / update / wait-healthy
docs            Architecture, données, AI Act, sécurité, déploiement…
```

## Documentation

- [Exigences et état d'avancement](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md) · [Modèle de données](docs/DATA_MODEL.md) · [Référentiel AI Act](docs/AI_ACT_RULES.md) · [Cotation des risques](docs/RISK_METHOD.md)
- [Sécurité](docs/SECURITY.md) · [API](docs/API.md)
- [Déploiement](docs/DEPLOYMENT.md) · [OrbStack](docs/ORBSTACK.md) · [Accès distant](docs/REMOTE_ACCESS.md) · [Sauvegarde et restauration](docs/BACKUP_RESTORE.md) · [Workflow GitHub](docs/GITHUB_WORKFLOW.md)
- [Plan d'implémentation](docs/IMPLEMENTATION_PLAN.md) · [Journal des modifications](CHANGELOG.md)

## Fonctionnalités

### Implémentées et testées (S1)

- Authentification locale : argon2id, verrouillage après 5 échecs, limitation de débit, sessions serveur (cookie HttpOnly/SameSite=Strict, expiration d'inactivité et absolue), CSRF, changement de mot de passe imposé.
- Utilisateurs : création (mot de passe temporaire affiché une fois), modification, rôles multiples avec périmètre (global ou unité ± sous-unités), désactivation (révocation des sessions), réinitialisation, protection du dernier super administrateur.
- Unités organisationnelles : arborescence, déplacement avec recalcul du sous-arbre, détection de cycles, désactivation logique.
- RBAC serveur : 11 rôles, 29 permissions, qualificatifs « propres » / « affectées », contrôle de périmètre et d'objet.
- Journal d'audit immuable (triggers PostgreSQL : UPDATE/DELETE/TRUNCATE refusés), diff ancien/nouveau, filtres, export CSV protégé contre l'injection de formules.
- Schéma de données complet des 10 tranches (51 tables) et migration initiale.
- API REST versionnée, OpenAPI 3.1 générée depuis les schémas de validation, `/health`, `/ready`.
- Docker multi-stage non-root, Caddy (CSP stricte), réseau interne pour PostgreSQL, secrets générés, CI GitHub Actions.

### Implémentées et testées (S2)

- Registre : création de fiche vierge (référence automatique), consultation, modification partielle avec verrou optimiste, archivage et restauration motivés.
- Recherche plein texte en français (préfixes, référence), filtres combinés reflétés dans l'URL, sous-unités incluses, tri et pagination serveur, vue tableau ou cartes, colonnes au choix, vues sauvegardées personnelles ou partagées.
- Contrôle d'accès par périmètre (404 hors périmètre), par propriétaire (`SYSTEM_OWNER`) et par section affectée (`CONTRIBUTOR`).
- Actions de masse transactionnelles (propriétaire, unité, statut, tags, archivage) refusées en bloc si un seul SIA n'est pas autorisé.
- Export CSV (en-têtes de compatibilité du cahier des charges) et JSON, journalisés ; historique par SIA ; complétude calculée côté serveur.

### Implémentées et testées (S3)

- Fiche en 12 étapes, sauvegarde indépendante par étape, complétude par étape, récapitulatif imprimable.
- Responsabilités et parties prenantes (RACI facultatif), actifs, traitements RGPD, jeux de données et usages, catégories de données et de personnes, valeur ajoutée détaillée.
- Référentiels partagés (parties prenantes, actifs, traitements, datasets, catégories, gabarits) et création à partir d'un gabarit.
- Affectation de sections aux contributeurs avec contrôle serveur.

### Implémentées et testées (S4)

- Référentiel des modèles d'IA et des fournisseurs ; fiche modèle avec les SIA utilisateurs du périmètre.
- Lien SIA ↔ modèle avec description de l'utilisation propre à chaque lien, version, hébergement, modèle principal.
- Fournisseurs, intégrateurs et hébergeurs d'un SIA ; filtres du registre par fournisseur et par modèle.

### Implémentées et testées (S5)

- Référentiel AI Act versionné en données (projet v1.0.0, **validation juridique requise**) et moteur de qualification explicable, testé règle par règle.
- Questionnaire décisionnel avec enregistrement progressif et aperçu en direct ; résultat par dimension (champ, rôles, interdictions, haut risque, transparence, GPAI, FRIA) avec règles, articles et réponses déterminantes.
- Surcharge juriste motivée et immuable ; validation selon le principe des quatre yeux ; obligations générées et suivies ; conformité globale.

### Implémentées et testées (S6)

- Registre des risques par SIA : cotation inhérente et résiduelle selon une méthodologie versionnée et paramétrable (voir [docs/RISK_METHOD.md](docs/RISK_METHOD.md)), traitement, acceptation motivée, points d'attention, historique.
- Mesures rattachées aux risques ; plans d'action liés aux risques, obligations et mesures ; actions échues et « mes actions ».
- Pages « Risques » (carte de chaleur cliquable) et « Actions », onglets de la fiche SIA, administration de la méthodologie.

### Implémentées et testées (S7)

- Documents et preuves versionnés (dépôt contrôlé, empreinte SHA-256, téléchargement en pièce jointe), rattachés aux obligations et aux risques.
- Validation par domaine d'une version de la fiche (quatre yeux), revue exceptionnelle automatique sur modification substantielle, revues périodiques paramétrables, comparaison et restauration de versions.
- Commentaires avec mentions, notifications in-app et rappels d'échéance 90/60/30/7 jours.

### Implémentées et testées (S8)

- Tableau de bord calculé à la demande : indicateurs, alertes, matrice risque × valeur, répartitions et évolution, tous cliquables vers la liste filtrée.

### Implémentées et testées (S9)

- FRIA versionnée selon l'art. 27, réutilisant les thèmes d'une DPIA, validée à quatre yeux.
- Notices de transparence générées depuis la fiche (sans IA), validées, ajoutées aux pièces, exportables en Markdown et HTML.

### Restant à développer

Voir [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) (statut par exigence) : assistant IA, import/export, rapports, Entra ID (S10), Trust Center et intégrations Microsoft 365 (phase 3).

## Licence

Usage interne. Voir [LICENSE](LICENSE). Les logos GLS sont la propriété de leur titulaire et ne sont utilisés que pour l'identification interne de l'application.
