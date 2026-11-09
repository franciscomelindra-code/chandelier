## Objet

<!-- Quoi et pourquoi. Lien vers l'exigence (docs/REQUIREMENTS.md, ex. F-012). -->

## Vérifications

- [ ] `npm run lint`, `npm run typecheck`, `npm test` passent localement
- [ ] Migration Prisma ajoutée si le schéma change (jamais de modification d'une migration publiée)
- [ ] Permissions contrôlées côté serveur + tests 401/403 pour toute nouvelle route
- [ ] Écritures journalisées dans `audit_event` (même transaction)
- [ ] Aucune donnée réelle GLS, aucun secret, aucune donnée personnelle dans le diff
- [ ] Aucune fonctionnalité simulée : ce qui n'est pas fini affiche « Fonctionnalité non implémentée »
- [ ] `docs/REQUIREMENTS.md` et `CHANGELOG.md` mis à jour
- [ ] Règle AI Act modifiée : nouvelle version du référentiel + validation juridique tracée
