# Journal des modifications

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnement sémantique.

## [0.7.0] — 2026-11-10 — Slice S7 : documents, preuves, validations, revues, collaboration

### Ajouté
- Migration `s7_documents_workflow` : document rattaché à un SIA ou à un modèle, dates de validation et de dernière revue du SIA, clé d’idempotence des notifications.
- Documents versionnés : dépôt contrôlé (liste blanche + signature, taille bornée, nom nettoyé, clé aléatoire, SHA-256), nouvelles versions, téléchargement en pièce jointe journalisé, archivage motivé ; stockage local (volume `chandelier_documents`, `STORAGE_DIR`).
- Preuves rattachées aux obligations et aux risques (documents du même SIA).
- Validation par domaine (Métier, DPO, RSSI, Juridique, DSI) d’une version de la fiche : habilitation par rôle, demandeur ≠ décideur, rejet motivé, demande caduque si la fiche change, version validée figée ; état « modifié depuis la validation ».
- Revue exceptionnelle automatique sur modification substantielle d’un SIA validé (finalité, cas d’usage, autonomie, population, modèle, jeu de données, fournisseur, personnes concernées).
- Revues périodiques et exceptionnelles, clôture motivée, prochaine revue recalculée selon une périodicité paramétrable par catégorie AI Act ; action de masse « Lancer une revue ».
- Commentaires internes par étape avec mentions contrôlées ; nouvelle permission `comment:write`.
- Notifications in-app (mentions, validations, revues, attributions d’actions et de sections) et rappels d’échéance 90/60/30/7 jours et dépassement, idempotents, toutes les 6 heures.
- Comparaison de versions et restauration des champs d’une version antérieure.
- Interface : étape 11 « Documentation », onglets « Validation et revues » et « Commentaires », versions dans l’historique, preuves sur risques et obligations, documents des modèles, pages « Documentation » et « Notifications », Administration › Périodicité des revues.
- 6 tests unitaires et 9 tests d’intégration (158 tests au total).

### Explicitement non livré
- Analyse antivirus (statut « non analysé ») ; stockage S3 / Azure Blob ; notifications par e-mail ou Teams.

## [0.6.0] — 2026-11-10 — Slice S6 : risques, mesures, plans d’action

### Ajouté
- Migration `s6_risks` : mesures rattachées à un SIA (avec échéance), acceptation motivée des risques (motif, auteur, date), références `ACT-####`, verrou optimiste sur risques et actions, action obligatoirement rattachée à un SIA.
- Méthodologie de cotation versionnée, paramétrable par le super administrateur (échelles, seuils, couleurs) avec aperçu ; activation motivée ; les risques cotés avec une version remplacée sont signalés et se recotent explicitement.
- Registre des risques par SIA (13 catégories) : scénario, cause, événement, conséquences, cotation inhérente et résiduelle calculée côté serveur, traitement, plan, propriétaire, échéance, statut avec transitions automatiques, historique.
- Règles : résiduel ≤ inhérent sur chaque axe, acceptation motivée et réservée aux rôles de validation pour le niveau le plus élevé, clôture refusée si une action liée est ouverte ; six points d’attention calculés.
- Mesures (types, statuts ; « existante » = en place ou vérifiée), rattachables à plusieurs risques du même SIA.
- Plans d’action : liens risque / obligation / mesure du même SIA, priorité, responsable, échéance, actions échues, « mes actions », annulation motivée, le responsable peut changer le statut.
- Interface : pages « Risques » (filtres dans l’URL, carte de chaleur cliquable, répartition par niveau) et « Actions », fiche risque, onglets « Risques » et « Actions » de la fiche SIA, bouton « Créer une action » sur les obligations, Administration › Méthodologie de risque.
- Documentation `docs/RISK_METHOD.md`.
- 9 tests unitaires de cotation, 9 tests d’intégration, 1 test d’interface (143 tests au total).

### Modifié
- ESLint : `eqeqeq` admet `== null` (test simultané de null et undefined).

### Explicitement non livré
- Preuves rattachées aux risques et mesures (S7) ; matrice risque × valeur du tableau de bord (S8).

## [0.5.0] — 2026-11-10 — Slice S5 : moteur de qualification AI Act

### Ajouté
- Référentiel réglementaire v1.0.0 en données (projet à valider par la Direction juridique) : 39 questions, 49 règles avec article, date d’application et explication, 35 modèles d’obligations.
- Moteur pur et déterministe partagé serveur / interface : dimensions séparées (champ, rôles, interdictions, haut risque, transparence, GPAI, FRIA), catégorie d’affichage dérivée, informations manquantes, obligations filtrées par rôle et datées.
- Import au démarrage avec empreinte SHA-256 ; une version importée est immuable.
- Qualification : brouillon avec enregistrement progressif et aperçu en direct, propositions issues de la fiche à confirmer, calcul enregistré (version, date, auteur, règles, réponses), réévaluation, surcharge juriste motivée et immuable, validation selon le principe des quatre yeux.
- Obligations par SIA, générées de façon idempotente ; suivi (applicabilité, statut, responsable, échéance, commentaire) ; conformité globale dérivée.
- Pages « Évaluations » (portefeuille) et « Référentiels › Référentiel AI Act » (consultation des questions, règles et obligations).
- 33 tests du moteur (couverture de toutes les règles) et 11 tests d’intégration (124 tests au total).

## [0.4.0] — 2026-11-10 — Slice S4 : modèles d’IA et fournisseurs

### Ajouté
- Référentiel des fournisseurs (pays, DPA, activation) et des modèles d’IA (type, accès, hébergement, zones, dates, statut, GPAI et risque systémique, licence, capacités, limites, documentation).
- Liaison N-N SIA ↔ modèle portant la description de l’utilisation propre à chaque lien, la version utilisée, le mode d’hébergement, la date d’intégration et un modèle principal unique.
- Fiche modèle listant les SIA utilisateurs du périmètre de l’utilisateur (les autres sont seulement dénombrés).
- Étape 3 de la fiche opérationnelle ; fournisseurs / intégrateurs / hébergeurs à l’étape 2 ; signalement GPAI.
- Registre : filtres par fournisseur (déclaré ou via un modèle) et par modèle, colonne « Modèles ».
- Jeu DEMO : fournisseur et modèle génériques fictifs liés à `SIA-DEMO-001`.
- 8 tests d’intégration supplémentaires (80 au total).

## [0.3.0] — 2026-11-10 — Slice S3 : fiche en 12 étapes

### Ajouté
- Fiche SIA en 12 étapes avec navigation latérale, état de complétude par étape et sauvegarde indépendante de chaque étape (verrou optimiste conservé).
- Responsabilités (fonctions clés, RACI facultatif), parties prenantes, actifs, traitements RGPD, jeux de données (usages entraînement / fine-tuning / RAG / inférence…), catégories de données (art. 9 / 10 signalés), personnes concernées (volume, conséquences), valeur ajoutée détaillée et position valeur × risque.
- Affectation de sections à des contributeurs (contrôle serveur).
- Référentiels partagés : parties prenantes, actifs, traitements RGPD, jeux de données, catégories RGPD, gabarits ; suppression refusée si rattaché.
- Création à partir d’un gabarit interne (champs descriptifs uniquement).
- Complétude étendue aux sections relationnelles, recalculée au démarrage quand les critères évoluent.
- Récapitulatif imprimable (synthèse, alertes, responsables, périmètre, échéances).
- Instantanés de version incluant les liens.
- 8 tests d’intégration supplémentaires (72 au total).

### Explicitement non livré
- Étapes 3 (modèles, S4), 9 (classification, S5), 11 (documentation, S7) : écrans « Fonctionnalité non implémentée ».
- Synchronisation sélective avec un registre RGPD externe (S9).

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
