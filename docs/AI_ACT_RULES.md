# Chandelier — Référentiel et moteur AI Act

> **Statut : projet de référentiel v1.0.0 — validation juridique requise.**
> Ce référentiel est une aide à la qualification. Il ne remplace pas l'analyse de la Direction juridique. Toute conclusion « potentiellement interdit », « haut risque » ou « à déterminer » doit être revue par un juriste. Les articles cités renvoient au règlement (UE) 2024/1689 tel que publié au JOUE le 12 juillet 2024 (https://eur-lex.europa.eu/eli/reg/2024/1689/oj). Les éventuelles modifications ultérieures (notamment la proposition dite « Digital Omnibus » de novembre 2025 sur le calendrier haut risque) **ne sont pas intégrées** et doivent être vérifiées avant publication d'une nouvelle version.

## 1. Principes

1. **Règles = données.** Questions, règles et modèles d'obligations sont dans `referentials/ai-act/eu-ai-act-2024-1689.v1.0.0.json`, importé en table `regulatory_framework` avec son SHA-256. Une version importée n'est jamais modifiée : toute correction crée une nouvelle version.
2. **Moteur pur.** `evaluate(framework, answers, context)` (dans `packages/shared/src/ai-act`) est déterministe, sans I/O, testé unitairement règle par règle.
3. **Dimensions séparées.** Le résultat ne mélange jamais :
   - `scope` — est-ce un SIA, dans le champ du règlement ?
   - `roles` — rôle(s) de GLS (fournisseur, déployeur, …), requalification art. 25 ;
   - `prohibited` — hypothèses art. 5 ;
   - `highRisk` — art. 6(1) / annexe I, art. 6(2) / annexe III, dérogation art. 6(3) ;
   - `transparency` — obligations art. 50, indépendantes du haut risque ;
   - `gpai` — usage ou fourniture de modèles d'IA à usage général ;
   - `fria` — nécessité d'une analyse d'impact art. 27 ;
   - `obligations` — liste générée ;
   - `displayCategory` — **résumé d'affichage** uniquement ;
   - le **statut de conformité** n'est pas produit par le moteur : il dérive de l'avancement des obligations.
4. **Prudence.** Une réponse « Je ne sais pas » ou absente sur une question déterminante produit `UNDETERMINED` et alimente la liste des informations manquantes — jamais une conclusion favorable par défaut.
5. **Traçabilité.** Chaque conclusion porte : résultat, justification (texte de la règle), `ruleId`, fondement (`legalBasis`), réponses ayant conduit au résultat, version du référentiel, date, auteur (utilisateur ayant lancé le calcul).
6. **Surcharge.** Un utilisateur disposant de `assessment:override` (DPO, LEGAL) peut surcharger une dimension ; justification obligatoire (≥ 20 caractères), conservation de l'ancienne valeur, historique complet. Le résultat calculé reste visible à côté du résultat effectif.

## 2. Format d'une règle

```json
{
  "ruleId": "AIA-PROH-5-1-F",
  "legalBasis": "Règlement (UE) 2024/1689, art. 5(1)(f)",
  "version": "1.0.0",
  "effectiveFrom": "2025-02-02",
  "effectiveTo": null,
  "condition": { "eq": ["P_EMOTION_WORK_EDU", "YES"] },
  "output": { "dimension": "prohibited", "value": "POTENTIAL", "obligations": ["AIA-OBL-PROH-STOP"] },
  "severity": "CRITICAL",
  "explanation": "Reconnaissance des émotions sur le lieu de travail ou dans un établissement d'enseignement, hors raisons médicales ou de sécurité.",
  "sourceUrl": "https://eur-lex.europa.eu/eli/reg/2024/1689/oj"
}
```

Mini-langage de conditions (évalué sans `eval`) : `all`, `any`, `not`, `eq [q, v]`, `in [q, [v…]]`, `includes [q, v]` (questions à choix multiples), `answered q`, `unknown q` (réponse `UNKNOWN` ou absente), `true`.

Les règles sont évaluées dans l'ordre des dimensions ; une même réponse peut déclencher plusieurs règles. Les règles dont `effectiveFrom` est postérieure à la date d'évaluation sont restituées comme « obligation à venir » avec leur date.

## 3. Questionnaire (v1.0.0)

Réponses : `YES` / `NO` / `UNKNOWN` sauf mention.

### A. Définition et champ (art. 3(1), art. 2)
| ID | Question | Fondement |
|---|---|---|
| D_MACHINE | Le dispositif est-il un système fondé sur une machine ? | art. 3(1) |
| D_INFERENCE | Infère-t-il, à partir des entrées reçues, la manière de générer des sorties (prédictions, contenus, recommandations, décisions) ? (≠ règles fixées exclusivement par des humains) | art. 3(1), considérant 12 |
| D_AUTONOMY | Fonctionne-t-il avec un certain niveau d'autonomie ? | art. 3(1) |
| D_INFLUENCE | Ses sorties peuvent-elles influencer des environnements physiques ou virtuels ? | art. 3(1) |
| X_MILITARY | Usage exclusivement militaire, de défense ou de sécurité nationale ? | art. 2(3) |
| X_RESEARCH | Développé et mis en service uniquement à des fins de recherche et développement scientifiques ? | art. 2(6) |
| X_PRE_MARKET | Activité de recherche/essai/développement avant mise sur le marché ou mise en service (hors essais en conditions réelles) ? | art. 2(8) |

### B. Rôle de l'organisation (art. 3, art. 25)
| ID | Question | Fondement |
|---|---|---|
| R_DEVELOPS | GLS développe-t-elle (ou fait-elle développer) le système et le met-elle sur le marché ou en service sous son propre nom ou sa marque ? | art. 3(3) |
| R_USES | GLS utilise-t-elle le système sous sa propre autorité dans un cadre professionnel ? | art. 3(4) |
| R_IMPORTS | GLS met-elle sur le marché de l'Union un système portant le nom d'une personne établie hors UE ? | art. 3(6) |
| R_DISTRIBUTES | GLS met-elle le système à disposition d'autres sur le marché sans être fournisseur ni importateur ? | art. 3(7) |
| R_REBRAND | GLS appose-t-elle son nom/marque sur un système haut risque déjà sur le marché ? | art. 25(1)(a) |
| R_SUBST_MOD | GLS apporte-t-elle une modification substantielle à un système haut risque ? | art. 25(1)(b) |
| R_PURPOSE_CHANGE | GLS modifie-t-elle la destination d'un système (y compris GPAI) de sorte qu'il devienne haut risque ? | art. 25(1)(c) |

### C. Pratiques interdites (art. 5(1)) — applicables depuis le 2 février 2025
| ID | Hypothèse | Fondement |
|---|---|---|
| P_MANIPULATION | Techniques subliminales, manipulatrices ou trompeuses altérant substantiellement le comportement et causant (ou susceptibles de causer) un préjudice important | art. 5(1)(a) |
| P_VULNERABILITY | Exploitation de vulnérabilités liées à l'âge, au handicap ou à la situation sociale ou économique | art. 5(1)(b) |
| P_SOCIAL_SCORING | Notation sociale conduisant à un traitement préjudiciable ou défavorable | art. 5(1)(c) |
| P_CRIME_PREDICTION | Évaluation du risque qu'une personne commette une infraction, fondée uniquement sur le profilage ou les traits de personnalité | art. 5(1)(d) |
| P_FACE_SCRAPING | Constitution/extension de bases de reconnaissance faciale par moissonnage non ciblé d'images | art. 5(1)(e) |
| P_EMOTION_WORK_EDU | Reconnaissance des émotions sur le lieu de travail ou dans l'enseignement (hors raisons médicales ou de sécurité) | art. 5(1)(f) |
| P_BIOMETRIC_CATEG | Catégorisation biométrique déduisant origine raciale, opinions politiques, appartenance syndicale, convictions religieuses ou philosophiques, vie ou orientation sexuelle | art. 5(1)(g) |
| P_RT_RBI_LE | Identification biométrique à distance en temps réel dans des espaces accessibles au public à des fins répressives | art. 5(1)(h) |

### D. Haut risque
| ID | Question | Fondement |
|---|---|---|
| H_ANNEX_I | Le système est-il un produit, ou un composant de sécurité d'un produit, couvert par la législation d'harmonisation de l'annexe I et soumis à évaluation de conformité par un tiers ? | art. 6(1) — applicable au 2 août 2027 |
| H_ANNEX_III | Domaines de l'annexe III (choix multiples) : `BIOMETRICS`, `CRITICAL_INFRA`, `EDUCATION`, `EMPLOYMENT`, `ESSENTIAL_SERVICES`, `LAW_ENFORCEMENT`, `MIGRATION`, `JUSTICE_DEMOCRACY`, `NONE` | art. 6(2), annexe III |
| H_EMPLOYMENT_USE | (si EMPLOYMENT) Recrutement/sélection, décisions sur les conditions de travail, promotion, rupture, attribution des tâches sur la base du comportement ou de traits personnels, suivi et évaluation des performances ? | annexe III, pt 4 |
| H_ESSENTIAL_USE | (si ESSENTIAL_SERVICES) Choix : `PUBLIC_BENEFITS`, `CREDITWORTHINESS`, `LIFE_HEALTH_INSURANCE`, `EMERGENCY_TRIAGE` | annexe III, pt 5 |
| H_PROFILING | Le système effectue-t-il un profilage de personnes physiques ? | art. 6(3) dernier alinéa |
| H_DEROGATION | Le système relève-t-il d'un des cas de l'art. 6(3) : tâche procédurale étroite / amélioration d'une activité humaine achevée / détection de schémas sans remplacer l'évaluation humaine / tâche préparatoire — **et** ne présente pas de risque important ? | art. 6(3) |

Règles : `H_ANNEX_I=YES` → haut risque (6(1)). Domaine annexe III ≠ NONE → haut risque **sauf** `H_DEROGATION=YES` **et** `H_PROFILING=NO` → « non haut risque par dérogation — documenter l'évaluation (art. 6(4)) et enregistrer (art. 49(2)) ». `H_PROFILING=YES` neutralise toujours la dérogation.

### E. Transparence (art. 50) — applicable au 2 août 2026
| ID | Question | Fondement |
|---|---|---|
| T_INTERACTS | Le système est-il destiné à interagir directement avec des personnes physiques ? | art. 50(1) (fournisseur) |
| T_SYNTHETIC | Génère-t-il du contenu synthétique audio, image, vidéo ou texte ? | art. 50(2) (fournisseur) |
| T_EMOTION_BIOMETRIC | Reconnaissance des émotions ou catégorisation biométrique (hors cas interdits) ? | art. 50(3) (déployeur) |
| T_DEEPFAKE | Génère-t-il ou manipule-t-il des hypertrucages (deepfakes) ? | art. 50(4) al. 1 (déployeur) |
| T_PUBLIC_TEXT | Publie-t-il du texte généré pour informer le public sur des questions d'intérêt public, sans contrôle éditorial humain ? | art. 50(4) al. 2 (déployeur) |

### F. GPAI et FRIA
| ID | Question | Fondement |
|---|---|---|
| G_USES_GPAI | Le système repose-t-il sur un modèle d'IA à usage général ? (pré-rempli depuis les modèles liés `isGpai`) | art. 3(63) |
| G_PROVIDES_GPAI | GLS fournit-elle elle-même un modèle d'IA à usage général ? | art. 53 |
| F_PUBLIC_SERVICE | GLS agit-elle, pour ce système, comme organisme de droit public ou entité privée fournissant des services publics ? **Validation juridique requise.** | art. 27(1) |

## 4. Dérivation des conclusions

| Dimension | Règle |
|---|---|
| `scope` | `OUT_OF_SCOPE` si une question D_* = NO ou une exclusion X_* = YES ; `UNDETERMINED` si une D_* est UNKNOWN ; sinon `IN_SCOPE`. |
| `roles` | PROVIDER si R_DEVELOPS ou une condition art. 25 = YES (requalification signalée) ; DEPLOYER si R_USES ; IMPORTER, DISTRIBUTOR selon R_IMPORTS / R_DISTRIBUTES. |
| `prohibited` | `POTENTIAL` si une P_* = YES ; `UNDETERMINED` si une P_* UNKNOWN ; sinon `NOT_IDENTIFIED`. |
| `highRisk` | `HIGH_RISK` (avec fondement 6(1) ou point annexe III) ; `NOT_HIGH_RISK_DEROGATION` ; `UNDETERMINED` ; `NOT_IDENTIFIED`. |
| `transparency` | liste des obligations art. 50 déclenchées, filtrées par rôle (50(1)-(2) fournisseur ; 50(3)-(4) déployeur). |
| `fria` | `REQUIRED` si DEPLOYER **et** HIGH_RISK annexe III (hors pt 2) **et** (F_PUBLIC_SERVICE=YES **ou** usage 5(b)/5(c)) ; `TO_CONFIRM` si F_PUBLIC_SERVICE UNKNOWN ; sinon `NOT_REQUIRED`. |
| `displayCategory` | `OUT_OF_SCOPE` › `PROHIBITED` (potentiel) › `UNDETERMINED` (si une dimension déterminante est indéterminée) › `HIGH` › `LIMITED` (au moins une obligation art. 50) › `MINIMAL`. |

## 5. Modèles d'obligations (extraits v1.0.0)

| Clé | Fondement | Condition | Catégorie |
|---|---|---|---|
| AIA-OBL-LITERACY | art. 4 | tout SIA dans le champ (fournisseur ou déployeur) — depuis 02/02/2025 | AI_LITERACY |
| AIA-OBL-PROH-STOP | art. 5 | prohibited = POTENTIAL : analyse juridique immédiate, suspension envisagée | PROHIBITION |
| AIA-OBL-DEP-INSTR | art. 26(1) | déployeur + haut risque : usage conforme à la notice | DEPLOYER |
| AIA-OBL-DEP-OVERSIGHT | art. 26(2) | déployeur + haut risque : contrôle humain par personnes compétentes | HUMAN_OVERSIGHT |
| AIA-OBL-DEP-INPUT | art. 26(4) | déployeur + haut risque : pertinence et représentativité des données d'entrée maîtrisées | DATA_GOVERNANCE |
| AIA-OBL-DEP-MONITOR | art. 26(5) | déployeur + haut risque : surveillance, information du fournisseur, incidents graves | MONITORING_INCIDENTS |
| AIA-OBL-DEP-LOGS | art. 26(6) | déployeur + haut risque : conservation des journaux ≥ 6 mois | LOGGING |
| AIA-OBL-DEP-WORKERS | art. 26(7) | déployeur + haut risque sur le lieu de travail : information des représentants et des salariés | WORKER_INFORMATION |
| AIA-OBL-DEP-DPIA | art. 26(9) + RGPD art. 35 | déployeur + haut risque + données personnelles | DPIA |
| AIA-OBL-DEP-INFORM | art. 26(11) | déployeur + haut risque annexe III prenant/aidant des décisions concernant des personnes | TRANSPARENCY |
| AIA-OBL-FRIA | art. 27 | fria = REQUIRED | FRIA |
| AIA-OBL-PRV-RMS … PRV-ROBUST | art. 9 à 15 | fournisseur + haut risque (gestion des risques, données, documentation technique, journalisation, notice, contrôle humain, exactitude/robustesse/cybersécurité) | divers |
| AIA-OBL-PRV-QMS / CONFORMITY / REGISTRATION / PMM / INCIDENTS | art. 17, 43, 49, 72, 73 | fournisseur + haut risque | divers |
| AIA-OBL-DEROG-DOC | art. 6(4), 49(2) | dérogation 6(3) retenue | DOCUMENTATION |
| AIA-OBL-T-50-1 … T-50-4B | art. 50(1)-(4) | selon transparence et rôle | TRANSPARENCY |
| AIA-OBL-GPAI-PRV | art. 53 (55 si risque systémique) | G_PROVIDES_GPAI = YES | GPAI |
| AIA-OBL-RGPD-LINK | RGPD | données personnelles = OUI : lier le traitement au registre RGPD | DPIA |

Chaque obligation générée porte la clé, le fondement, la version du référentiel et les `ruleId` qui l'ont déclenchée. La régénération est idempotente : une obligation existante conserve son statut, son responsable et ses preuves ; une obligation qui n'est plus déclenchée passe en `applicability = TO_CONFIRM` avec un commentaire système, sans suppression.

## 6. Calendrier d'application (texte publié)

| Date | Dispositions |
|---|---|
| 1er août 2024 | Entrée en vigueur |
| 2 février 2025 | Chapitres I et II (définitions, maîtrise de l'IA art. 4, pratiques interdites art. 5) |
| 2 août 2025 | GPAI (chap. V), gouvernance, sanctions |
| 2 août 2026 | Application générale (dont annexe III et art. 50) |
| 2 août 2027 | Art. 6(1) (produits annexe I) |

## 7. Implémentation (S5)

| Élément | Emplacement |
|---|---|
| Référentiel v1.0.0 (39 questions, 49 règles, 35 modèles d'obligations, 12 définitions réutilisables) | `referentials/ai-act/eu-ai-act-2024-1689.v1.0.0.json` |
| Schéma du référentiel et contrôles de cohérence (questions, définitions, valeurs, obligations référencées) | `packages/shared/src/ai-act/types.ts`, `validateFramework()` |
| Moteur pur `evaluate()`, catégorie d'affichage, surcharges `applyOverrides()` | `packages/shared/src/ai-act/engine.ts` (même code côté serveur et pour l'aperçu en direct de l'interface) |
| Import au démarrage, empreinte SHA-256, immuabilité des versions | `apps/api/src/referentials/loader.ts` |
| Évaluations, surcharges, validation, obligations | `apps/api/src/modules/assessments.ts` |

Règles de fonctionnement retenues :

- **Brouillon unique** par SIA ; une réévaluation reprend les réponses de la qualification courante. L'enregistrement remplace (statut « remplacée ») la qualification précédente, sans la supprimer.
- **Questions masquées** : leurs réponses éventuelles sont écartées du calcul et signalées dans le journal (`ignoredAnswers`).
- **Préremplissage** depuis la fiche (données personnelles, rôle déclaré, modèles GPAI) : uniquement sous forme de **proposition** à appliquer explicitement.
- **Précédence** dans chaque dimension (ex. haut risque : `HIGH_RISK` › `UNDETERMINED` › `NOT_HIGH_RISK_DEROGATION` › `NOT_IDENTIFIED`) ; rôles et GPAI sont cumulatifs.
- **Hors champ** : les autres dimensions passent à « sans objet » et aucune obligation n'est générée.
- **Obligations filtrées par rôle** (`roles` du modèle) ; si aucun rôle n'est établi, elles sont créées « à confirmer ». Date d'application = la plus tardive entre la règle et le modèle ; « à venir » si postérieure à la date d'évaluation.
- **Génération idempotente** : statut, responsable et preuves conservés ; une obligation qui n'est plus déclenchée passe « à confirmer » avec un commentaire système (jamais supprimée). L'applicabilité saisie par un utilisateur est conservée.
- **Surcharges** (`assessment:override`, DPO / juridique) : dimensions `displayCategory`, `scope`, `prohibited`, `highRisk`, `transparency`, `fria` ; justification ≥ 20 caractères ; table immuable (trigger) ; le résultat calculé reste affiché à côté du résultat effectif ; une surcharge invalide la validation. Les obligations ne sont pas recalculées par une surcharge : l'applicabilité se corrige obligation par obligation, avec commentaire obligatoire pour « non applicable ».
- **Validation** (`assessment:validate`) selon le **principe des quatre yeux** : le validateur doit être différent de l'auteur du calcul.
- **Conformité globale du SIA** dérivée des obligations applicables : non évaluée (aucune obligation), non conforme (au moins une), conforme (toutes), sinon partielle.

## 8. Tests

`packages/shared/src/ai-act/engine.test.ts` : schéma et cohérence du référentiel ; **chaque règle est déclenchée par au moins un scénario** (test de couverture) ; cas positifs et négatifs par dimension ; cas limites (dérogation + profilage, réponses inconnues, questions masquées, requalification art. 25, rôle indéterminé, coexistence transparence / haut risque, FRIA en infrastructure critique, dates d'application). `apps/api/test/assessments.test.ts` : import immuable, brouillon, calcul, obligations idempotentes, surcharges, quatre yeux, droits.
