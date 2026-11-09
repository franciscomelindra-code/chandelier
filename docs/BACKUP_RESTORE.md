# Sauvegarde et restauration

## Sauvegarder

```bash
./scripts/backup.sh            # → ./backups/
./scripts/backup.sh /Volumes/Sauvegardes/chandelier
```

Produit :

- `chandelier-db-<date>.dump` — `pg_dump` format custom (compressé, restaurable sélectivement), vérifié par `pg_restore --list` ;
- `chandelier-documents-<date>.tar.gz` — volume des pièces justificatives ;
- `chandelier-<date>.sha256` — empreintes.

`backups/` est ignoré par Git. Les fichiers contiennent tout le registre : chiffrez-les (ex. `age`, image disque chiffrée) et conservez une copie hors du Mac. Le volume `chandelier_secrets` n'est pas inclus : sans lui, une restauration sur une nouvelle machine génère de nouveaux secrets (les sessions sont alors invalidées, sans autre conséquence).

Planification (exemple macOS, quotidienne à 19 h) : une tâche `launchd` ou `cron` appelant `scripts/backup.sh`, avec rotation des fichiers anciens.

## Restaurer

```bash
./scripts/restore.sh backups/chandelier-db-<date>.dump backups/chandelier-documents-<date>.tar.gz
```

Le script vérifie l'empreinte, demande de taper `RESTAURER`, **sauvegarde l'état courant** dans `backups/pre-restore/`, arrête `api` et `web`, recrée la base, restaure, puis redémarre (les migrations plus récentes que la sauvegarde sont appliquées au démarrage).

## Migrations

```bash
./scripts/migrate.sh status   # migrations appliquées / en attente
./scripts/migrate.sh          # sauvegarde puis migrate deploy
```

## Retour arrière d'une mise à jour

Prisma ne génère pas de migrations « down ». Le retour arrière se fait par restauration :

1. `git log` → identifier la version précédente ; `git checkout <commit>` ;
2. `./scripts/restore.sh backups/pre-update/chandelier-db-<date>.dump` ;
3. `docker compose up -d --build` puis `./scripts/wait-healthy.sh`.

Une migration en échec n'altère pas les données (transaction PostgreSQL) ; l'API refuse de démarrer tant que la migration n'est pas résolue. Diagnostic : `docker compose logs api --tail=200`, `./scripts/migrate.sh status`. Ne jamais modifier une migration déjà appliquée : corriger par une nouvelle migration.

## Test de restauration

À faire au moins une fois par trimestre, sur une machine ou un projet Compose distinct (`docker compose -p chandelier-test …`), et à consigner.
