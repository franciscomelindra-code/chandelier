# Accès distant

Par défaut : `REMOTE_ACCESS_MODE=disabled` et `WEB_BIND_ADDRESS=127.0.0.1`. L'application n'est joignable que depuis le Mac qui l'héberge. **Aucun mode n'est activé implicitement.**

Invariants, quel que soit le mode :

- PostgreSQL n'est jamais publié (réseau `backend` interne).
- L'API n'est jamais publiée directement ; elle n'est joignable qu'au travers de `web`. Les routes d'administration exigent une session et le rôle SUPER_ADMIN.
- Aucun accès anonyme aux données : toute route `/api/v1/*` (hors connexion et supervision) exige une session.
- Aucun port de la box Internet n'est ouvert.
- Aucun mot de passe par défaut.

`REMOTE_ACCESS_MODE` documente le mode retenu (journalisé au démarrage) ; c'est la configuration réseau ci-dessous qui ouvre réellement l'accès.

## Mode 1 — Réseau local (LAN) uniquement

```dotenv
REMOTE_ACCESS_MODE=lan
WEB_BIND_ADDRESS=0.0.0.0
APP_URL=http://<ip-du-mac>:8080
```

`docker compose up -d`. Accès depuis un appareil du même réseau : `http://<ip-du-mac>:8080`.

Implications : trafic **non chiffré** sur le réseau local (identifiants et cookie de session lisibles par un tiers sur un Wi-Fi partagé). À réserver à un réseau domestique de confiance, et de préférence remplacé par le mode 2. Activer le pare-feu macOS en mode furtif.

## Mode 2 — Tailscale (recommandé)

Accès chiffré de bout en bout (WireGuard), limité aux appareils authentifiés de votre tailnet, sans rien exposer sur Internet.

1. Installer Tailscale sur le Mac et sur chaque appareil client ; se connecter au même tailnet ; activer MFA sur le compte d'identité utilisé.
2. Laisser `WEB_BIND_ADDRESS=127.0.0.1`.
3. Publier l'application dans le tailnet avec HTTPS (certificat Tailscale) :
   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:8080
   ```
4. Dans `.env` :
   ```dotenv
   REMOTE_ACCESS_MODE=tailscale
   APP_URL=https://<nom-du-mac>.<tailnet>.ts.net
   ```
   puis `docker compose up -d`.
5. Restreindre par ACL Tailscale les appareils/utilisateurs autorisés à joindre le Mac sur le port 443.

Ne **pas** utiliser `tailscale funnel` (publication sur Internet). Désactivation : `tailscale serve --https=443 off`.

## Mode 3 — Cloudflare Tunnel + Cloudflare Access (publication contrôlée)

Tunnel sortant depuis le Mac : aucun port entrant. Cloudflare Access impose une authentification (SSO / OTP / MFA) **avant** que la requête n'atteigne Chandelier, en plus de la connexion Chandelier.

1. Dans Cloudflare Zero Trust : créer un tunnel, route publique `chandelier.<votre-domaine>` → service `http://web:8080`.
2. Créer une application **Access** sur ce nom d'hôte avec une politique restrictive (liste nominative ou groupe, MFA). Ne jamais publier le nom d'hôte sans politique Access.
3. `.env` (le jeton ne doit jamais être committé) :
   ```dotenv
   REMOTE_ACCESS_MODE=cloudflare
   APP_URL=https://chandelier.<votre-domaine>
   CLOUDFLARE_TUNNEL_TOKEN=<jeton du tunnel>
   ```
4. Démarrer avec le profil : `docker compose --profile cloudflare up -d`.

Implications : le trafic est déchiffré par Cloudflare (tiers, hors UE possible selon la configuration) — à valider avec le RSSI et le DPO pour des informations internes de gouvernance. Le mode 2 est préférable.

Désactivation : `docker compose --profile cloudflare stop cloudflared`, puis supprimer la route dans Cloudflare.

## Ce qui n'est pas fait (et ne doit pas l'être)

- Pas de redirection de port sur la box.
- Pas d'accès SSH permanent de GitHub Actions vers le Mac.
- Pas d'exposition de `/api/docs` hors session.
