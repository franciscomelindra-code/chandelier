# Chandelier — Matrice des exigences

Source : `Cahier_des_charges_Gouvernance_SIA_GLS.md` v1.0 (9 nov. 2026), complétée par les exigences GitHub / Docker / OrbStack / accès distant transmises le 9 nov. 2026.

Légende statut : **À faire** · **En cours** · **Fait** (= implémenté **et** testé) · **Hors MVP**.
Slice = tranche verticale du plan (`IMPLEMENTATION_PLAN.md`). Le statut est tenu à jour à chaque slice ; seul ce fichier fait foi pour savoir ce qui fonctionne réellement.

## 1. Exigences fonctionnelles

| ID | Réf. CDC | Exigence | Slice | Critère d'acceptation | Statut |
|---|---|---|---|---|---|
| F-001 | §2.1, §5.2 | Registre central des SIA persisté en BDD | S2 | Un SIA créé via l'UI est relu après redémarrage des conteneurs | Fait (S2) — persistance après redémarrage Docker à valider |
| F-002 | §5.2 | Champs minimum du registre (UUID, référence, nom, description, finalité, unité, propriétaire, resp. métier, statut 9 valeurs, dates, fournisseurs, rôles AI Act, niveau de risque, justification, valeur, tags, prochaine revue, complétude, conformité) | S2/S3 | Chaque champ est saisissable, persisté, visible dans la fiche | Fait (S5) — tous les champs du registre sont alimentés (risque et conformité par la qualification) |
| F-003 | §5.2 | Vue table + vue cartes, tri, filtres combinés, recherche plein texte, pagination serveur | S2 | Filtres reflétés dans l'URL ; pagination côté API (`page`, `pageSize`, `total`) | Fait (S2) |
| F-004 | §5.2, §5.14 | Colonnes personnalisables, vues sauvegardées personnelles et partagées | S2 | Une vue sauvegardée restaure filtres + colonnes | Fait (S2) |
| F-005 | §5.2 | Actions de masse : assigner propriétaire, unité, tags, statut, lancer revue, exporter, archiver | S2/S7 | Opération transactionnelle, journalisée par objet, refusée si droit manquant sur un seul objet | Fait (S7) — « lancer une revue » ajouté |
| F-006 | §5.3 | Création : fiche vierge | S2 | — | Fait (S2) |
| F-007 | §5.3 | Création : à partir d'un modèle interne (gabarit) | S3 | Gabarit administrable ; la copie ne reprend ni historique ni validations | Fait (S3) |
| F-008 | §5.3, §10 | Création : assistant IA, préremplissage sourcé, statut « À vérifier » | S10 | Aucune valeur IA n'est écrite dans les champs validés sans action humaine | Partiel (S10) — extraction de champs depuis un texte fourni, appliquée par l'utilisateur ; préremplissage dès la création et extraction depuis PDF non implémentés |
| F-009 | §5.3 | Wizard 12 sections (Général → Récapitulatif) avec sauvegarde progressive | S3 | Chaque section s'enregistre indépendamment ; quitter puis revenir conserve la saisie | Fait (S3–S5) — étape 11 renvoie à S7 |
| F-010 | §5.3 ét.2 | Responsabilités : propriétaire, sponsor, resp. métier, DSI, RSSI, DPO/juridique, fournisseur, intégrateur, rôles AI Act, RACI facultatif | S3 | — | Fait (S3) |
| F-011 | §5.3 ét.3, §5.7 | Liaison N-N SIA ↔ modèles avec « description de l'utilisation » propre à la relation | S4 | Un modèle lié à 2 SIA affiche 2 descriptions distinctes | Fait (S4) |
| F-012 | §5.3 ét.4 | Parties prenantes internes/externes | S3 | — | Fait (S3) |
| F-013 | §5.3 ét.5 | Actifs (applications, API, serveurs, SaaS, bases, appareils, infra) réutilisables | S3 | Un actif existant peut être relié sans ressaisie | Fait (S3) |
| F-014 | §5.3 ét.6 | Liaison traitements RGPD ; synchronisation sélective sans écrasement silencieux | S3/S9 | Toute synchro affiche un diff et requiert confirmation champ par champ | Partiel (S3) — liaison faite ; synchronisation sélective en S9 |
| F-015 | §5.3 ét.7 | Données : sources, datasets, origine, données perso, cat. particulières, pénales, synthétiques, usage (entraînement/fine-tuning/RAG/inférence), qualité, représentativité, licence, conservation, localisation, transferts, destinataires | S3 | — | Fait (S3) |
| F-016 | §5.3 ét.8 | Personnes concernées : catégories, mineurs, salariés, candidats, clients, destinataires, vulnérables, volume, conséquences | S3 | — | Fait (S3) |
| F-017 | §5.3 ét.10 | Valeur ajoutée Faible/Moyen/Élevé + bénéfices, KPI, gains | S3 | — | Fait (S3) — matrice de portefeuille en S8 |
| F-018 | §5.3 ét.11 | Documentation rattachée à la fiche | S7 | — | À faire |
| F-019 | §5.3 ét.12 | Récapitulatif consolidé imprimable | S3/S7 | Impression navigateur propre (CSS print) | Fait (S3) — récapitulatif imprimable ; obligations/documents/validations après S5/S7 |
| F-020 | §5.4 | Questionnaire décisionnel AI Act versionné | S5 | Le référentiel est une donnée (JSON importé en BDD), pas du code d'écran | Fait (S5) |
| F-021 | §5.4.1 | Définition de SIA (art. 3(1)) et exclusions (art. 2) | S5 | — | Fait (S5) |
| F-022 | §5.4.2 | Pratiques interdites (art. 5) | S5 | Toute réponse « Oui » produit « Potentiellement interdit — validation juridique requise » | Fait (S5) |
| F-023 | §5.4.3 | Haut risque (art. 6(1), 6(2), annexe III, dérogation 6(3), profilage) | S5 | — | Fait (S5) |
| F-024 | §5.4.4 | Transparence (art. 50) | S5 | Dimension distincte du niveau de risque | Fait (S5) |
| F-025 | §5.4.5 | Rôle de l'organisation (fournisseur, déployeur, importateur, distributeur, mandataire, fabricant de produit ; requalification art. 25) | S5 | — | Fait (S5) |
| F-026 | §5.4.6, §3.3 | Résultat explicable : résultat, justification, règles déclenchées, fondement, réponses, informations manquantes, version, date, auteur | S5 | Chaque conclusion affiche ces 9 éléments | Fait (S5) |
| F-027 | §5.4.9 | Surcharge juriste avec justification obligatoire + historique | S5 | Surcharge sans justification refusée par l'API (400) ; surcharge visible dans l'historique | Fait (S5) |
| F-028 | §5.4 | Catégories d'affichage Minimal / Transparence / Haut risque / Interdit / À déterminer (+ Hors champ) distinctes du raisonnement | S5 | — | Fait (S5) |
| F-029 | §5.5 | Checklist d'obligations générée depuis la classification (article, description, applicable Oui/Non/À confirmer, responsable, statut, preuve, date cible, date de validation, commentaire) | S5 | Régénération idempotente, sans perte des statuts déjà saisis | Fait (S5) |
| F-030 | §5.6 | FRIA liée au SIA, sections art. 27, conclusion, validation, versions | S9 | Soumission refusée si une section n'est ni renseignée ni couverte par la DPIA ; validateur ≠ dernier rédacteur | Fait (S9) — avec notification à l'autorité (art. 27(3)) |
| F-031 | §5.6 | Réutilisation d'une DPIA/AIPD sans double saisie, périmètre couvert | S9 | Une section ne peut être déclarée couverte que si la DPIA traite le thème | Fait (S9) |
| F-032 | §5.7 | Référentiel modèles (nom, fournisseur, famille, version, type, capacités, limites, accès, hébergement, zones, URL, date de connaissance, statut, GPAI, licence, pièces) | S4 | — | Partiel (S7) — pièces du modèle livrées ; préremplissage IA en S10 |
| F-033 | §5.8 | Notice de transparence générée depuis les données structurées, blocs conditionnels, édition, versions, validation | S9 | Génération déterministe ; mentions « [À compléter] » bloquantes ; validateur ≠ dernier rédacteur | Fait (S9) |
| F-034 | §5.8 | Export notice MD, HTML, PDF, DOCX + ajout automatique aux pièces | S9/S10 | HTML entièrement échappé | Partiel (S9) — MD, HTML et ajout aux pièces faits ; PDF et DOCX non implémentés |
| F-035 | §5.9 | Registre des risques par SIA (13 catégories), scénario, cause, événement, conséquence, vraisemblance, gravité, scores inhérent/résiduel, mesures, propriétaire, traitement, échéance, preuve | S6 | Score et niveau calculés côté serveur ; résiduel ≤ inhérent ; acceptation motivée | Partiel (S6) — tout sauf la preuve (pièces justificatives en S7) |
| F-036 | §5.9 | Méthodologie de cotation paramétrable par l'administrateur | S6 | Changement de méthodologie versionné ; anciens scores conservés avec leur version | Fait (S6) |
| F-037 | §5.10 | Affectation de sections à un contributeur | S7 | Le contributeur ne peut modifier que les sections affectées (contrôle API) | Fait (S7) — affectation, contrôle serveur et notification |
| F-038 | §5.10 | Commentaires internes, mentions, notifications in-app | S7 | Une mention n'est acceptée que si la personne a accès au SIA | Fait (S7) |
| F-039 | §5.10 | Validation par domaine (métier, DPO, RSSI, juridique, DSI), verrouillage de version validée | S7 | Une version validée n'est plus modifiable ; toute modification crée une nouvelle version | Fait (S7) — la version validée est figée (instantané) ; toute modification crée une version non validée signalée ; demandeur ≠ décideur |
| F-040 | §5.10, §13 | Revalidation / revue déclenchée par modification substantielle (finalité, modèle, version, dataset, fournisseur, autonomie, population) | S7 | Modifier le modèle d'un SIA validé crée une revue exceptionnelle | Fait (S7) |
| F-041 | §5.10 | Workflow configurable | Hors MVP (S7 partiel) | Hypothèse H-07 | Partiel (S7) — domaines choisis à chaque demande ; pas de moteur de workflow |
| F-042 | §5.11 | Journal d'audit immuable (qui, quoi, ancienne/nouvelle valeur, quand, origine, justification) | S1→S7 | UPDATE/DELETE sur `audit_event` rejetés par trigger PostgreSQL | Fait (S1) |
| F-043 | §5.11 | Comparaison et restauration de versions, export du journal | S7 | — | Fait (S7) — comparaison de versions, restauration des champs (pas des liens), export du journal |
| F-044 | §5.12 | Import CSV (XLSX, JSON) avec mapping, aperçu, validation, rapport d'erreurs, transaction | S10 (CSV en S2 si possible) | Un fichier avec 1 ligne invalide n'importe rien et retourne le rapport | Partiel (S10) — CSV et JSON faits ; XLSX non implémenté |
| F-045 | §5.12 | Champs de compatibilité Label, Ref, Description, State, RiskLevel… TransparencyNoticeHtml | S10 | RiskLevel jamais repris comme qualification ; notice HTML importée en texte brut, en brouillon | Fait (S10) — DateCreation, DateUpdate, TransparencyNoticeDone ignorés (gérés par Chandelier) |
| F-046 | §5.12 | Export registre CSV/XLSX/JSON ; fiche PDF/DOCX/MD/HTML ; notice ; FRIA ; rapport d'audit ; ZIP des preuves | S2 (CSV/JSON), S10 | — | Partiel (S10) — registre CSV/XLSX/JSON, fiche MD/HTML, notice MD/HTML, FRIA et journal dans le dossier d'audit, ZIP des preuves (droit audit:read) ; PDF/DOCX non implémentés |
| F-047 | §5.13 | Trust Center opt-in par fiche, champs publiables, validation juridique | Hors MVP (phase 3) | — | Hors MVP |
| F-048 | §5.1 | Dashboard : total, statuts, risques, unités, interdits, haut risque, FRIA, notices manquantes, évaluations en retard, actions, valeur, matrice risque×valeur, complétude, évolution | S8 | Chaque valeur est calculée par requête ; aucun chiffre en dur | Fait (S8) — 12 indicateurs, matrice risque × valeur, répartitions, évolution sur 12 mois, alertes |
| F-049 | §5.1 | Chaque widget cliquable ouvre la liste filtrée | S8 | Les liens reportent les filtres du tableau de bord | Fait (S8) |
| F-050 | §5.1 | Filtres dashboard (unité, direction, équipe, propriétaire, fournisseur, modèle, risque, rôle, statut, tags, période) | S8 | — | Fait (S8) — unité (sous-unités incluses : direction, équipe), période = date de création de la fiche (H-18) |
| F-051 | §12 | Rapports standards (11 rapports) CSV/XLSX + PDF/DOCX | S10 | Générés à la demande sur le périmètre, journalisés, CSV protégé contre l'injection de formules | Partiel (S10) — 10 rapports XLSX/CSV/JSON + dossier d'audit ZIP ; PDF/DOCX non implémentés |
| F-052 | §13 | Rappels 90/60/30/7 j, revue annuelle paramétrable par niveau de risque | S7/S8 | Rappels idempotents | Fait (S7) — notifications in-app ; pas d'e-mail (H-08) |
| F-053 | §14 | API REST `/api/v1`, OpenAPI | S1→ | `/api/docs` sert la spec générée depuis les schémas réels | Fait (S1) |
| F-054 | §14 | Webhooks facultatifs | Hors MVP | — | Hors MVP |
| F-055 | §14 | Préparation Microsoft Graph / SharePoint / Teams / Power Automate | Hors MVP | Interfaces d'intégration documentées | Hors MVP |
| F-056 | §10 | Abstraction fournisseur LLM, désactivable, journalisée, minimisation, sources + incertitudes | S10 | `LLM_PROVIDER=disabled` par défaut ; aucun appel sortant dans ce mode | Fait (S10) — fournisseur Anthropic (SDK officiel), testé avec un fournisseur simulé ; jamais appelé réellement ici |
| F-057 | §3.4 | Statut « À vérifier » pour toute proposition IA jusqu'à validation humaine | S10 | Table `assistant_suggestion`, jamais d'écriture directe | Fait (S10) |
| F-058 | §18 | Jeu de démonstration manifestement fictif, marqué DEMO, séparé | S1→ | `isDemo=true`, références `SIA-DEMO-*`, seed désactivable | Fait (S1) |
| F-059 | §2 (obj. 11), §11 | Plans d'action : actions rattachées à un SIA et éventuellement à un risque, une obligation, une mesure ; responsable, priorité, échéance, statut ; actions échues ; « mes actions » | S6 | Annulation motivée ; le responsable peut changer le statut sans droit de gestion ; clôture d'un risque refusée tant qu'une action liée est ouverte | Fait (S6) |

## 2. Exigences d'habilitation

| ID | Réf. | Exigence | Slice | Critère | Statut |
|---|---|---|---|---|---|
| A-001 | §4, ajout 6 | Rôles : SUPER_ADMIN, DPO, LEGAL, AI_GOVERNANCE, RSSI, IT, SYSTEM_OWNER, CONTRIBUTOR, REVIEWER, AUDITOR, READER | S1 | Rôles seedés, matrice dans `SECURITY.md` | Fait (S1) |
| A-002 | §4 | RBAC extensible (rôles en BDD, permissions nommées) | S1 | — | Fait (S1) |
| A-003 | §4 | Droits par unité organisationnelle (avec descendants), entité, direction, fiche | S1/S2 | Un SYSTEM_OWNER d'une unité ne voit pas les SIA d'une unité sœur hors périmètre | Fait (S2) |
| A-004 | §9 | Contrôle d'accès objet côté serveur | S1→ | Tests d'intégration 403 par rôle | Fait (S1) |
| A-005 | §4 | Lecteur/Auditeur : lecture + export, aucune écriture | S1→ | Tests 403 sur toutes les routes d'écriture | Fait (S1) |

## 3. Exigences non fonctionnelles

| ID | Réf. | Exigence | Slice | Statut |
|---|---|---|---|---|
| N-001 | §8 | React + TS, Node TS, PostgreSQL, Prisma, Tailwind, REST + OpenAPI | S1 | Fait (S1) |
| N-002 | §6 | `id`, `createdAt`, `createdById`, `updatedAt`, `updatedById` sur chaque entité ; objets sensibles versionnés | S1 | Fait (S1) |
| N-003 | §15 | TypeScript strict, lint/format, migrations, `.env.example`, index BDD, transactions | S1 | Fait (S1) |
| N-004 | §15 | Couverture des règles critiques (moteur AI Act, RBAC, scoring) | S1, S5, S6 | Fait (S6) — moteur AI Act : chaque règle testée ; RBAC ; complétude ; cotation des risques (seuils, cohérence, avertissements) |
| N-005 | §7 | WCAG 2.1 AA, responsive desktop/tablette | S1→ | Partiel (S1) |
| N-006 | §9 | Sécurité (voir `SECURITY.md`) : OIDC-ready, MFA via IdP, CSRF/XSS/SQLi/SSRF, CSP, validation serveur, upload contrôlé, sessions, secrets, pas de télémétrie | S1→ | Fait (S10) — OIDC Entra ID testé avec un fournisseur simulé, pas avec un tenant Entra réel ; antivirus non actif |
| N-007 | §8, ajout 3 | Docker multi-stage, non-root, healthchecks, arm64 + amd64 | S1 | Écrit, non exécuté localement (pas de Docker) — vérifié par CI |
| N-008 | ajout 2 | Démarrage `cp .env.example .env && docker compose up -d --build` | S1 | Écrit, non exécuté localement (pas de Docker) — vérifié par CI |
| N-009 | ajout 7 | Volume persistant, backup/restore/migrate scripts, rollback documenté | S1 | Écrit, non exécuté localement (pas de Docker) — vérifié par CI |
| N-010 | ajout 10 | CI GitHub : install, lint, typecheck, tests, build, Prisma, Docker | S1 | Écrit, non exécuté localement (pas de Docker) — vérifié par CI |
| N-011 | ajout 5 | Accès distant désactivé par défaut ; modes LAN / Tailscale / Cloudflare documentés | S1 | Écrit, non exécuté localement (pas de Docker) — vérifié par CI |
| N-012 | ajout 4 | Compatibilité OrbStack (labels facultatifs) sans dépendance propriétaire | S1 | Écrit, non exécuté localement (pas de Docker) — vérifié par CI |
| N-013 | §15 | Aucune erreur console, gestion explicite des erreurs | S1→ | Fait (S1) |
| N-014 | ajout 16 | Aucune donnée réelle GLS France dans le dépôt | S1→ | Fait (S1) |

## 4. Ambiguïtés et hypothèses

Aucune ambiguïté n'a été jugée bloquante. Hypothèses retenues (révisables) :

| ID | Sujet | Hypothèse |
|---|---|---|
| H-01 | Rôles | La liste de l'exigence GitHub (11 rôles) remplace celle du §4 (8 profils). Correspondance : Super Admin→SUPER_ADMIN ; DPO/Juridique IA→DPO + LEGAL ; RSSI/DSI→RSSI + IT ; Référent IA→AI_GOVERNANCE ; Propriétaire→SYSTEM_OWNER ; Contributeur→CONTRIBUTOR ; Validateur→REVIEWER ; Lecteur/Auditeur→READER + AUDITOR (l'auditeur lit aussi le journal d'audit). |
| H-02 | Périmètre | Une affectation de rôle est globale ou limitée à une unité (descendants inclus par défaut). Les rôles « transverses » (DPO, LEGAL, AI_GOVERNANCE, RSSI, AUDITOR) sont normalement globaux. |
| H-03 | Catégorie d'affichage | Une 6e catégorie « Hors champ » est ajoutée quand le dispositif n'est pas un SIA ou relève d'une exclusion art. 2 : la classer « Minimal » serait juridiquement faux. |
| H-04 | Dates d'application AI Act | Le référentiel reprend les dates du règlement tel que publié au JO (1er août 2024). La proposition « Digital Omnibus » (nov. 2025) visant à reporter certaines échéances haut risque n'est **pas** intégrée : statut législatif à vérifier par la Direction juridique. Signalé dans l'UI. |
| H-05 | Score de risque | Méthodologie par défaut 4×4 (vraisemblance × gravité, score 1–16), seuils Faible ≤3, Modéré 4–6, Significatif 8–9, Critique ≥12. Paramétrable (F-036). |
| H-06 | Stockage documents | Stockage local sur volume Docker (abstraction `StorageProvider` prête pour S3/Azure Blob). Antivirus : interface prévue, ClamAV en option (service compose facultatif), sinon statut « non analysé » affiché. |
| H-07 | Workflow configurable | MVP : circuit de validation par domaines configurable (domaines requis par niveau de risque), pas de moteur BPMN. |
| H-08 | Notifications | In-app uniquement dans le MVP. E-mail / Teams via interface `Notifier` (hors MVP). |
| H-09 | Langue | Interface en français ; libellés centralisés pour une i18n ultérieure (phase 3). |
| H-10 | Auth dev | Authentification locale (e-mail + mot de passe argon2id) ; aucun compte par défaut : le premier SUPER_ADMIN est créé par commande CLI ou via variables `BOOTSTRAP_ADMIN_*` à usage unique. |
| H-11 | Police | La police GLS propriétaire n'est pas disponible ; substitution Hanken Grotesk **auto-hébergée** (paquet npm `@fontsource-variable`) pour éviter tout appel à Google Fonts (pas de télémétrie externe). |
| H-13 | Acceptation d'un risque | Justification obligatoire (20 caractères min.). L'acceptation d'un risque du niveau le plus élevé de la méthodologie est réservée aux détenteurs de `assessment:validate` (DPO, LEGAL, AI_GOVERNANCE, SUPER_ADMIN). Toute modification de cotation d'un risque accepté impose de renouveler la justification. |
| H-14 | Risque résiduel | Le résiduel est une cotation experte saisie, jamais calculée automatiquement à partir des mesures (une réduction automatique serait arbitraire). Il ne peut dépasser l'inhérent sur aucun axe ; une réduction sans mesure « en place » est signalée, non bloquée. |
| H-15 | Mesures | Une mesure appartient à un SIA et peut couvrir plusieurs de ses risques ; son caractère « existant » découle de son statut (en place / vérifiée). Pas de bibliothèque de mesures transverse (évite qu'une modification dans un périmètre affecte un autre). |
| H-16 | Documents | Un document appartient à un SIA ou à un modèle (contrôle de périmètre). Formats admis par liste blanche avec vérification de signature ; HTML, SVG, scripts et exécutables refusés ; téléchargement toujours en pièce jointe. Antivirus non actif : statut « non analysé » affiché. |
| H-17 | Validation par domaine | Habilitations : Métier = REVIEWER ou AI_GOVERNANCE ; DPO, RSSI, LEGAL, IT = rôle correspondant ; le super administrateur n'est habilité pour aucun domaine (séparation des tâches) ; un approbateur nommément désigné doit détenir `approval:decide` sur le SIA. La version est validée quand la dernière décision de chaque domaine demandé est « approuvé ». |
| H-18 | Tableau de bord | « Période » = date de création de la fiche ; « évaluations en retard » = revues planifiées échues + date de prochaine revue dépassée ; « risques critiques » = niveau le plus élevé de la méthodologie du risque (résiduel, à défaut inhérent) ; FRIA / notice « manquante » = dimension FRIA « requise » / transparence « applicable » dans la qualification effective sans FRIA / notice validée. Calcul à la volée (plafond 10 000 SIA). |
| H-19 | FRIA, DPIA, notices | FRIA rédigée et validée par DPO / LEGAL (`fria:manage`) ; une DPIA est toujours rattachée à un SIA ; la notice est générée sans IA à partir des données de la fiche, avec mentions par défaut paramétrables (organisation « GLS France » par défaut, contact vide → « à compléter ») ; blocs proposés d'après les réponses de la qualification, à confirmer. |
| H-20 | Entra ID | Comptes pré-provisionnés uniquement (aucune création automatique) : un compte « Microsoft Entra ID » créé par l'administrateur est lié à l'identifiant `oid` à la première connexion par son adresse ; les rôles restent gérés dans Chandelier (pas de mapping de groupes). Connexion locale désactivée en mode OIDC sauf `AUTH_LOCAL_FALLBACK=true`. |
| H-21 | Assistant IA | Fournisseur Anthropic désactivé par défaut ; activation soumise à validation DPO / RSSI. Données transmises minimisées (aucun nom de personne), journal d'usage sans contenu, propositions « À vérifier » ; valeurs de champs appliquées par l'utilisateur via la mise à jour normale de la fiche. |
| H-12 | Base locale Windows | En développement sur poste sans Docker, PostgreSQL réel embarqué via `embedded-postgres` (binaires officiels distribués par npm). Jamais utilisé en production. |
