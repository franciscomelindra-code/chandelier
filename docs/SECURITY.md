# Chandelier — Sécurité et Privacy by Design

## 1. Modèle de menace (résumé)

Actifs protégés : registre de gouvernance IA (informations internes, potentiellement confidentielles), pièces justificatives, journal d'audit, comptes. Menaces principales : accès non authentifié depuis un réseau distant, élévation de privilèges horizontale (SIA d'une autre unité) ou verticale, injection (SQL, XSS), CSRF, fuite de secrets (Git, image Docker, navigateur), téléversement malveillant, falsification de l'historique, exfiltration via l'assistant IA.

## 2. Mesures

| Domaine | Mesure | Implémentation |
|---|---|---|
| Authentification | Aucun accès anonyme aux données ; toute route `/api/v1/*` exige une session sauf `auth/login`, `health`, `ready` | Hook `onRequest` global, liste blanche explicite |
| | Mots de passe argon2id (OWASP : m=19 MiB, t=2, p=1), longueur ≥ 12, jamais journalisés | `apps/api/src/auth/password.ts` |
| | Verrouillage temporaire après 5 échecs (15 min), message d'erreur générique | `auth/local-provider.ts` |
| | Pas de compte par défaut ; premier admin via CLI `npm run admin:create` ou `BOOTSTRAP_ADMIN_*` (ignoré si un admin existe) | `cli/` |
| | SSO-ready : `AuthProvider` local / OIDC (Entra ID, PKCE), MFA délégué à l'IdP | `auth/` |
| Sessions | Jeton aléatoire 256 bits, stocké **haché** ; cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production, préfixe `__Host-` en HTTPS | `auth/session.ts` |
| | Expiration d'inactivité (30 min, `SESSION_IDLE_MINUTES`) et absolue (10 h, `SESSION_ABSOLUTE_HOURS`) ; révocation à la déconnexion et à la désactivation du compte | |
| CSRF | Jeton par session renvoyé par `/auth/me`, exigé en en-tête `X-CSRF-Token` sur toute méthode non sûre (comparaison à temps constant) + `SameSite=Strict` | `plugins/csrf.ts` |
| Autorisation | RBAC côté serveur : permission + périmètre d'unité + contrôle objet (propriétaire, section affectée) sur chaque route ; le front n'affiche que ce que l'API autorise mais **ne décide jamais** | `rbac/` |
| Validation | Zod sur corps, paramètres, requêtes ; rejet des champs inconnus (`strict`) ; tailles maximales | schémas par module |
| SQLi | Prisma (requêtes paramétrées) ; SQL brut uniquement via `Prisma.sql` paramétré | — |
| XSS | React échappe par défaut ; aucun `dangerouslySetInnerHTML` hors notices rendues via un assainisseur (DOMPurify) ; CSP stricte | Caddyfile |
| En-têtes | `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS en HTTPS | Caddy + `@fastify/helmet` sur l'API |
| SSRF | L'API n'effectue aucune requête vers une URL fournie par l'utilisateur. L'assistant (S10) n'appelle que l'hôte du fournisseur configuré (liste blanche) ; les URL saisies (documentation modèle) ne sont jamais récupérées côté serveur | — |
| Upload (S7) | Taille max (`UPLOAD_MAX_MB`, 25 Mo), liste blanche MIME + vérification des octets magiques, nom de stockage aléatoire (UUID), hors racine web, SHA-256, statut antivirus (ClamAV facultatif ; sinon « non analysé » affiché) ; téléchargement en `Content-Disposition: attachment` | — |
| Journal | `audit_event` immuable (trigger PostgreSQL) ; connexions, échecs, changements de rôle, modifications, surcharges, exports | `audit/` |
| Secrets | Variables d'environnement uniquement ; `.env` ignoré par Git ; aucune valeur réelle dans `.env.example` ; `config.ts` refuse de démarrer en production avec un `SESSION_SECRET` faible | — |
| LLM | Clé uniquement côté API ; `LLM_PROVIDER=disabled` par défaut ; minimisation (champs explicitement sélectionnés) ; journalisation de chaque appel ; aucune sortie validée automatiquement | S10 |
| Télémétrie | Aucune : pas de CDN, polices auto-hébergées, `CHECKPOINT_DISABLE=1` (Prisma), pas d'analytics | — |
| Réseau | Seul `web` publie un port, lié à `127.0.0.1` par défaut ; `api` et `postgres` uniquement sur le réseau Docker interne | `docker-compose.yml` |
| Conteneurs | Images multi-stage, utilisateur non-root, système de fichiers en lecture seule pour `api` (sauf volume documents et `/tmp`), `no-new-privileges` | Dockerfiles |
| Données | Minimisation : coordonnées professionnelles seulement pour les parties prenantes ; les données personnelles des SIA sont décrites par **catégories**, jamais stockées | modèle |
| Conservation | Durées paramétrables (`AppSetting`) : sessions expirées purgées ; journal conservé (durée à fixer par le DPO) | — |

## 3. Rôles et permissions

Permissions qualifiées : `:own` = uniquement les SIA dont l'utilisateur est propriétaire ; `:assigned` = uniquement les sections qui lui sont affectées. Toutes les permissions s'appliquent dans le **périmètre** de l'affectation (globale ou unité + descendants).

| Permission | SUPER_ADMIN | DPO | LEGAL | AI_GOV | RSSI | IT | SYS_OWNER | CONTRIB | REVIEWER | AUDITOR | READER |
|---|---|---|---|---|---|---|---|---|---|---|---|
| aiSystem:read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| aiSystem:create | ✓ | ✓ | ✓ | ✓ | | | ✓ | | | | |
| aiSystem:update | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own | assigned | | | |
| aiSystem:archive | ✓ | ✓ | ✓ | ✓ | | | own | | | | |
| aiSystem:export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| catalog:manage (modèles, fournisseurs, actifs, datasets) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | |
| assessment:run | ✓ | ✓ | ✓ | ✓ | | | own | | | | |
| assessment:override | ✓ | ✓ | ✓ | | | | | | | | |
| assessment:validate | ✓ | ✓ | ✓ | ✓ | | | | | | | |
| obligation:update | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own | | | | |
| risk:manage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own | | | | |
| action:manage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own | | | | |
| document:upload | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own | assigned | | | |
| fria:manage / dpia:manage | ✓ | ✓ | ✓ | | | | | | | | |
| notice:manage | ✓ | ✓ | ✓ | ✓ | | | own | | | | |
| notice:validate | ✓ | ✓ | ✓ | | | | | | | | |
| approval:decide | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ | | |
| review:manage | ✓ | ✓ | ✓ | ✓ | | | | | | | |
| comment:write | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| import:run | ✓ | ✓ | ✓ | ✓ | | | | | | | |
| report:read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| audit:read | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | ✓ | |
| assistant:use | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| referential:manage | ✓ | | ✓ | | | | | | | | |
| user:read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| user:manage, orgUnit:manage, role:manage, settings:manage | ✓ | | | | | | | | | | |

La matrice exécutable est `packages/shared/src/permissions.ts` ; ce tableau en est la documentation et un test vérifie leur cohérence sur les points critiques.

Règles complémentaires (S6), vérifiées côté serveur et couvertes par des tests d’intégration :

- **Acceptation d’un risque** du niveau le plus élevé de la méthodologie : `risk:manage` **et** `assessment:validate` (DPO, LEGAL, AI_GOVERNANCE, SUPER_ADMIN) ; justification de 20 caractères minimum, auteur et date conservés.
- **Responsable d’une action** : peut en modifier le statut (et le motif de clôture) sans `action:manage` ; toute autre modification lui est refusée (403).
- **Liens** risque ↔ mesure et action ↔ risque / obligation / mesure : uniquement au sein du même SIA (400), ce qui empêche de lier un objet hors périmètre.
- **Méthodologie de cotation** : création et activation réservées à `settings:manage` ; une version utilisée n’est plus modifiable.

Règles complémentaires (S7) :

- **Dépôt de fichiers** : un fichier par requête, taille bornée (`UPLOAD_MAX_MB`, 25 Mo par défaut ; Caddy limite le corps à 30 Mo), liste blanche d’extensions **et** vérification de la signature (PDF, PNG, JPEG, conteneurs Office/OpenDocument, texte UTF-8 sans octet nul). HTML, SVG, JavaScript et exécutables sont refusés (415). Nom de fichier nettoyé ; clé de stockage aléatoire (aucun nom fourni par l’utilisateur dans un chemin) ; fichiers en `0600`. Empreinte SHA-256 conservée par version. Antivirus **non actif** : statut « non analysé » affiché ; un statut `INFECTED` bloque le téléchargement.
- **Téléchargement** : toujours en pièce jointe (`Content-Disposition: attachment`), type MIME issu de la liste blanche (jamais du client), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, journalisé.
- **Validation** : permission `approval:decide` **et** rôle habilité pour le domaine (voir H-17) ; le demandeur ne peut pas décider ; une demande devient caduque si la fiche change.
- **Commentaires** : nouvelle permission `comment:write` (tous les rôles sauf READER et AUDITOR) ; une mention n’est acceptée que si la personne mentionnée peut lire le SIA (pas de fuite par notification).
- **Notices (S9)** : rendu à l’écran par un analyseur Markdown restreint sans HTML (aucun `dangerouslySetInnerHTML`) ; export HTML entièrement échappé avec CSP `default-src 'none'; sandbox` ; liens DPIA externes limités à http(s), ouverts côté navigateur en `noopener noreferrer`, jamais appelés par le serveur (pas de SSRF).
- **FRIA et notices** : validation par une autre personne que le dernier rédacteur.
- **Restauration de version** : `aiSystem:update` sans qualificatif de section (propriétaire ou gouvernance) ; un contributeur ne peut pas restaurer.

## 4. Points de vigilance connus

- Le mode `AUTH_MODE=oidc` n'est pas encore implémenté (S10/phase 3) : la valeur est refusée au démarrage avec un message explicite.
- L'antivirus n'est pas actif par défaut.
- Le chiffrement au repos dépend de l'hôte (FileVault sur macOS recommandé, volumes Docker sur disque chiffré).
- Les sauvegardes `backups/*.dump` contiennent l'intégralité du registre : à stocker chiffrées (voir `BACKUP_RESTORE.md`).
