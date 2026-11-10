# Chandelier — Méthode de cotation des risques SIA

Registre des risques du cahier des charges §5.9, livré en S6. Code : `packages/shared/src/risk.ts` (règles partagées serveur / interface), `apps/api/src/modules/risks.ts`, `apps/api/src/modules/actions.ts`.

## 1. Méthodologie paramétrable

Une méthodologie est une configuration JSON versionnée (`risk_methodology`) :

- **échelle de vraisemblance** et **échelle de gravité** : 2 à 10 niveaux, valeurs 1, 2, 3… sans trou, libellé et description facultative ;
- **seuils** : 2 à 6, strictement croissants, le premier commence à 1, aucun au-delà du score maximal ; chaque seuil porte un code, un libellé et une couleur (vert, jaune, orange, rouge).

**Score = vraisemblance × gravité.** Le niveau est celui du dernier seuil dont le minimum est atteint.

Méthode par défaut (données de référence, non DEMO) — 4×4, score 1 à 16 :

| Niveau | Score |
|---|---|
| Faible | 1 à 3 |
| Modéré | 4 à 7 (valeurs atteignables : 4, 6) |
| Significatif | 8 à 11 (valeurs atteignables : 8, 9) |
| Critique | 12 à 16 |

Cette grille est une **hypothèse de départ** (H-05) à faire valider par la gouvernance IA ; elle se remplace sans développement.

### Changement de méthodologie

1. Un super administrateur crée une nouvelle version (inactive), avec aperçu des niveaux par cellule.
2. Il l’active avec un motif (journalisé). Une seule version est active.
3. Les risques existants **gardent leur cotation et leur version** ; ils sont signalés « à recoter ». Leur cotation n’est plus modifiable tant qu’ils n’ont pas été recotés (« Recoter », motif obligatoire, journalisé).
4. Une version déjà activée ou utilisée n’est plus modifiable.

La carte de chaleur et la répartition par niveau du portefeuille ne représentent que les risques cotés avec la version active (les autres sont dénombrés à part).

## 2. Règles de cotation (bloquantes)

- Vraisemblance et gravité doivent appartenir à l’échelle de la version du risque.
- Inhérent et résiduel se saisissent par paire (les deux axes ou aucun).
- Un résiduel suppose un inhérent ; il ne peut dépasser l’inhérent **sur aucun des deux axes**.
- Le résiduel est une **cotation experte** : il n’est jamais déduit automatiquement des mesures (H-14).

## 3. Points d’attention (non bloquants, recalculés à chaque lecture)

| Code | Condition |
|---|---|
| `NOT_SCORED` | Inhérent non coté |
| `RESIDUAL_WITHOUT_MEASURE` | Résiduel < inhérent sans aucune mesure « en place » ou « vérifiée » rattachée |
| `NO_OWNER` | Aucun propriétaire |
| `TREATMENT_MISSING` | Coté sans décision de traitement |
| `OVERDUE` | Échéance de traitement dépassée (hors risque accepté) |
| `REPLACED_METHODOLOGY` | Coté avec une version qui n’est plus active |

Aucun point d’attention pour un risque clos.

## 4. Traitement et statut

Traitements : réduire, accepter, transférer, éviter. Statuts : identifié, évalué, en traitement, accepté, clos.

Transitions automatiques quand le statut n’est pas fourni : identifié → évalué à la première cotation ; évalué → en traitement dès qu’un traitement autre qu’« accepter » est choisi ; → accepté à l’enregistrement d’une acceptation.

- **Acceptation** : justification de 20 caractères minimum ; auteur et date conservés. Pour le niveau le plus élevé, réservée aux rôles de validation (H-13). Toute modification de cotation d’un risque accepté impose de renouveler la justification ; abandonner le traitement « accepter » efface l’acceptation.
- **Clôture** : refusée tant qu’une action liée est ouverte.
- Pas de suppression : un risque erroné se clôt (traçabilité).

## 5. Mesures et actions

- Une mesure appartient à un SIA et peut couvrir plusieurs de ses risques. Elle est **existante** si son statut est « en place » ou « en place et vérifiée ».
- Une action est rattachée à un SIA et, facultativement, à un risque, une obligation, une mesure de ce SIA. Elle est **échue** si elle est ouverte (à faire, en cours) et que son échéance est passée. L’annulation exige un motif. Son responsable peut en changer le statut.

## 6. Non livré en S6

- Preuves rattachées à un risque ou à une mesure : S7 (documents).
- Matrice risque × valeur et indicateurs du tableau de bord : S8.
- Suggestions de risques et de mesures par l’assistant IA : S10.
