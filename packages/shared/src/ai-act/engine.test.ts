import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evalCondition, evaluate, validateFramework } from './engine.js';
import { frameworkSchema, type Answers } from './types.js';

const fw = frameworkSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../referentials/ai-act/eu-ai-act-2024-1689.v1.0.0.json'),
      'utf8',
    ),
  ),
);
const DATE = '2026-11-10';

/** Système d'IA dans le champ, utilisé par l'organisation (déployeur), sans aucun cas particulier. */
const BASE: Answers = {
  C_PERSONAL_DATA: 'NO',
  C_WORKPLACE: 'NO',
  D_MACHINE: 'YES',
  D_INFERENCE: 'YES',
  D_AUTONOMY: 'YES',
  D_INFLUENCE: 'YES',
  X_MILITARY: 'NO',
  X_RESEARCH: 'NO',
  X_PRE_MARKET: 'NO',
  R_DEVELOPS: 'NO',
  R_USES: 'YES',
  R_IMPORTS: 'NO',
  R_DISTRIBUTES: 'NO',
  R_REBRAND: 'NO',
  R_SUBST_MOD: 'NO',
  R_PURPOSE_CHANGE: 'NO',
  P_MANIPULATION: 'NO',
  P_VULNERABILITY: 'NO',
  P_SOCIAL_SCORING: 'NO',
  P_CRIME_PREDICTION: 'NO',
  P_FACE_SCRAPING: 'NO',
  P_EMOTION_WORK_EDU: 'NO',
  P_BIOMETRIC_CATEG: 'NO',
  P_RT_RBI_LE: 'NO',
  H_ANNEX_I: 'NO',
  H_ANNEX_III: ['NONE'],
  T_INTERACTS: 'NO',
  T_SYNTHETIC: 'NO',
  T_EMOTION_BIOMETRIC: 'NO',
  T_DEEPFAKE: 'NO',
  T_PUBLIC_TEXT: 'NO',
  G_USES_GPAI: 'NO',
  G_PROVIDES_GPAI: 'NO',
};
const run = (over: Answers = {}, date = DATE) => evaluate(fw, { ...BASE, ...over }, { date });
const keys = (r: ReturnType<typeof run>) => r.obligations.map((o) => o.key);

const EMPLOYMENT: Answers = {
  H_ANNEX_III: ['EMPLOYMENT'],
  H_EMPLOYMENT_USE: 'YES',
  H_PROFILING: 'NO',
  H_DEROGATION: 'NO',
};

describe('référentiel v1.0.0', () => {
  it('respecte le schéma et la cohérence interne (questions, définitions, obligations, valeurs)', () => {
    expect(validateFramework(fw)).toEqual([]);
    expect(fw.rules.every((r) => r.sourceUrl.startsWith('https://eur-lex.europa.eu/'))).toBe(true);
  });

  it('chaque règle est déclenchée par au moins un scénario de test', () => {
    const scenarios: Answers[] = [
      {},
      BASE,
      { ...BASE, D_INFERENCE: 'NO' },
      { ...BASE, X_RESEARCH: 'YES' },
      {
        ...BASE,
        C_PERSONAL_DATA: 'YES',
        R_DEVELOPS: 'YES',
        R_IMPORTS: 'YES',
        R_DISTRIBUTES: 'YES',
        R_SUBST_MOD: 'YES',
      },
      ...[
        'P_MANIPULATION',
        'P_VULNERABILITY',
        'P_SOCIAL_SCORING',
        'P_CRIME_PREDICTION',
        'P_FACE_SCRAPING',
        'P_EMOTION_WORK_EDU',
        'P_BIOMETRIC_CATEG',
        'P_RT_RBI_LE',
      ].map((p) => ({ ...BASE, [p]: 'YES' })),
      { ...BASE, H_ANNEX_I: 'YES' },
      ...['BIOMETRICS', 'CRITICAL_INFRA', 'EDUCATION', 'LAW_ENFORCEMENT'].map((d) => ({
        ...BASE,
        H_ANNEX_III: [d],
        H_PROFILING: 'NO',
        H_DEROGATION: 'NO',
      })),
      {
        ...BASE,
        ...EMPLOYMENT,
        H_DECISIONS_PERSONS: 'YES',
        C_WORKPLACE: 'YES',
        C_PERSONAL_DATA: 'YES',
        F_PUBLIC_SERVICE: 'YES',
      },
      { ...BASE, ...EMPLOYMENT, F_PUBLIC_SERVICE: 'UNKNOWN' },
      {
        ...BASE,
        H_ANNEX_III: ['ESSENTIAL_SERVICES'],
        H_ESSENTIAL_USE: ['CREDITWORTHINESS'],
        H_PROFILING: 'NO',
        H_DEROGATION: 'NO',
      },
      { ...BASE, ...EMPLOYMENT, H_DEROGATION: 'YES' },
      {
        ...BASE,
        T_INTERACTS: 'YES',
        T_SYNTHETIC: 'YES',
        T_EMOTION_BIOMETRIC: 'YES',
        T_DEEPFAKE: 'YES',
        T_PUBLIC_TEXT: 'YES',
        G_USES_GPAI: 'YES',
        G_PROVIDES_GPAI: 'YES',
      },
    ];
    const hit = new Set(scenarios.flatMap((a) => evaluate(fw, a, { date: DATE }).triggeredRules.map((t) => t.ruleId)));
    const notHit = fw.rules.map((r) => r.ruleId).filter((id) => !hit.has(id));
    expect(notHit).toEqual([]);
  });
});

describe('champ d’application et prudence', () => {
  it('système minimal déployé : catégorie minimale, maîtrise de l’IA seule obligation', () => {
    const r = run();
    expect(r.displayCategory).toBe('MINIMAL');
    expect(r.dimensions.scope.value).toBe('IN_SCOPE');
    expect(r.dimensions.roles.values).toEqual(['DEPLOYER']);
    expect(r.dimensions.prohibited.value).toBe('NOT_IDENTIFIED');
    expect(r.dimensions.highRisk.value).toBe('NOT_IDENTIFIED');
    expect(r.dimensions.transparency.value).toBe('NONE');
    expect(r.dimensions.fria.value).toBe('NOT_REQUIRED');
    expect(keys(r)).toEqual(['AIA-OBL-LITERACY']);
    expect(r.missing).toEqual([]);
  });

  it('hors champ si un élément de définition manque ; les autres dimensions sont sans objet', () => {
    const r = run({ D_INFERENCE: 'NO', P_SOCIAL_SCORING: 'YES' });
    expect(r.displayCategory).toBe('OUT_OF_SCOPE');
    expect(r.dimensions.prohibited.value).toBe('NOT_APPLICABLE');
    expect(keys(r)).toEqual([]);
    expect(r.dimensions.scope.rules[0]!.ruleId).toBe('SC-NOT-AI');
  });

  it('hors champ en cas d’exclusion de l’art. 2', () => {
    expect(run({ X_MILITARY: 'YES' }).dimensions.scope.rules.map((t) => t.ruleId)).toEqual(['SC-EXCLUDED']);
  });

  it('sans réponse : « À déterminer », jamais de conclusion favorable, informations manquantes listées', () => {
    const r = evaluate(fw, {}, { date: DATE });
    expect(r.displayCategory).toBe('UNDETERMINED');
    expect(r.dimensions.prohibited.value).toBe('UNDETERMINED');
    expect(r.dimensions.highRisk.value).toBe('UNDETERMINED');
    expect(r.missing.map((m) => m.questionId)).toEqual(
      expect.arrayContaining(['D_MACHINE', 'P_SOCIAL_SCORING', 'H_ANNEX_III']),
    );
    expect(r.missing.map((m) => m.questionId)).not.toContain('C_WORKPLACE');
  });

  it('une seule hypothèse d’interdiction inconnue rend le résultat indéterminé', () => {
    const r = run({ P_EMOTION_WORK_EDU: 'UNKNOWN' });
    expect(r.dimensions.prohibited.value).toBe('UNDETERMINED');
    expect(r.displayCategory).toBe('UNDETERMINED');
  });

  it('données personnelles : rattachement RGPD', () => {
    expect(keys(run({ C_PERSONAL_DATA: 'YES' }))).toContain('AIA-OBL-RGPD-LINK');
  });
});

describe('pratiques interdites', () => {
  it.each([
    'P_MANIPULATION',
    'P_VULNERABILITY',
    'P_SOCIAL_SCORING',
    'P_CRIME_PREDICTION',
    'P_FACE_SCRAPING',
    'P_EMOTION_WORK_EDU',
    'P_BIOMETRIC_CATEG',
    'P_RT_RBI_LE',
  ])('%s = Oui → potentiellement interdit, analyse juridique immédiate', (q) => {
    const r = run({ [q]: 'YES' });
    expect(r.displayCategory).toBe('PROHIBITED');
    expect(r.dimensions.prohibited.value).toBe('POTENTIAL');
    expect(keys(r)).toContain('AIA-OBL-PROH-STOP');
    expect(r.dimensions.prohibited.rules[0]!.answers).toEqual({ [q]: 'YES' });
    expect(r.dimensions.prohibited.rules[0]!.legalBasis).toMatch(/^Art\. 5\(1\)\([a-h]\)$/);
  });
});

describe('haut risque', () => {
  it('annexe III point 4 (emploi) pour un déployeur : obligations du déployeur seulement, applicables', () => {
    const r = run(EMPLOYMENT);
    expect(r.displayCategory).toBe('HIGH');
    expect(r.dimensions.highRisk.rules.map((t) => t.ruleId)).toContain('HR-ANNEX-III-4');
    expect(keys(r)).toEqual(expect.arrayContaining(['AIA-OBL-DEP-INSTR', 'AIA-OBL-DEP-OVERSIGHT', 'AIA-OBL-DEP-LOGS']));
    expect(keys(r)).not.toContain('AIA-OBL-PRV-RMS');
    expect(r.obligations.every((o) => o.applicability === 'YES')).toBe(true);
  });

  it('signale les obligations « à venir » selon la date d’évaluation', () => {
    const before = run(EMPLOYMENT, '2026-01-15');
    expect(before.obligations.find((o) => o.key === 'AIA-OBL-DEP-INSTR')!.upcoming).toBe(true);
    expect(before.obligations.find((o) => o.key === 'AIA-OBL-LITERACY')!.upcoming).toBe(false);
    expect(run(EMPLOYMENT).obligations.find((o) => o.key === 'AIA-OBL-DEP-INSTR')!.upcoming).toBe(false);
  });

  it('domaine emploi sans usage visé → pas de haut risque ; usage inconnu → indéterminé', () => {
    expect(run({ ...EMPLOYMENT, H_EMPLOYMENT_USE: 'NO' }).dimensions.highRisk.value).toBe('NOT_IDENTIFIED');
    expect(run({ ...EMPLOYMENT, H_EMPLOYMENT_USE: 'UNKNOWN' }).dimensions.highRisk.value).toBe('UNDETERMINED');
  });

  it('dérogation art. 6(3) sans profilage → non haut risque, documentation pour le fournisseur', () => {
    const deployer = run({ ...EMPLOYMENT, H_DEROGATION: 'YES' });
    expect(deployer.dimensions.highRisk.value).toBe('NOT_HIGH_RISK_DEROGATION');
    expect(keys(deployer)).not.toContain('AIA-OBL-DEROG-DOC');
    const provider = run({ ...EMPLOYMENT, H_DEROGATION: 'YES', R_DEVELOPS: 'YES' });
    expect(keys(provider)).toContain('AIA-OBL-DEROG-DOC');
  });

  it('le profilage neutralise toujours la dérogation', () => {
    const r = run({ ...EMPLOYMENT, H_DEROGATION: 'YES', H_PROFILING: 'YES' });
    expect(r.dimensions.highRisk.value).toBe('HIGH_RISK');
  });

  it('annexe I : haut risque applicable au 2 août 2027', () => {
    const r = run({ H_ANNEX_I: 'YES', R_DEVELOPS: 'YES' });
    expect(r.dimensions.highRisk.rules.map((t) => t.ruleId)).toEqual(['HR-ANNEX-I']);
    expect(r.obligations.find((o) => o.key === 'AIA-OBL-PRV-RMS')!.effectiveFrom).toBe('2027-08-02');
  });

  it('lieu de travail, données personnelles et décisions sur les personnes ajoutent leurs obligations', () => {
    const r = run({ ...EMPLOYMENT, C_WORKPLACE: 'YES', C_PERSONAL_DATA: 'YES', H_DECISIONS_PERSONS: 'YES' });
    expect(keys(r)).toEqual(
      expect.arrayContaining([
        'AIA-OBL-DEP-WORKERS',
        'AIA-OBL-DEP-DPIA',
        'AIA-OBL-DEP-INFORM',
        'AIA-OBL-DEP-EXPLAIN',
        'AIA-OBL-RGPD-LINK',
      ]),
    );
  });

  it('ignore les réponses aux questions masquées', () => {
    const r = run({ H_ANNEX_III: ['NONE'], H_EMPLOYMENT_USE: 'YES' });
    expect(r.dimensions.highRisk.value).toBe('NOT_IDENTIFIED');
  });

  it('requalification en fournisseur (art. 25) cumulée au rôle de déployeur', () => {
    const r = run({ ...EMPLOYMENT, R_SUBST_MOD: 'YES' });
    expect(r.dimensions.roles.values).toEqual(['PROVIDER', 'DEPLOYER']);
    expect(keys(r)).toContain('AIA-OBL-PRV-RMS');
  });

  it('rôle indéterminé : obligations « à confirmer » plutôt qu’écartées', () => {
    const r = run({ ...EMPLOYMENT, R_USES: 'UNKNOWN', R_DEVELOPS: 'UNKNOWN' });
    expect(r.dimensions.roles.values).toEqual([]);
    expect(r.obligations.find((o) => o.key === 'AIA-OBL-PRV-RMS')!.applicability).toBe('TO_CONFIRM');
  });
});

describe('transparence, GPAI et FRIA', () => {
  it('interaction directe : catégorie « transparence », obligation du fournisseur seulement', () => {
    const deployer = run({ T_INTERACTS: 'YES' });
    expect(deployer.displayCategory).toBe('LIMITED');
    expect(keys(deployer)).not.toContain('AIA-OBL-T-50-1');
    expect(keys(run({ T_INTERACTS: 'YES', R_DEVELOPS: 'YES' }))).toContain('AIA-OBL-T-50-1');
  });

  it('hypertrucage et texte d’intérêt public : obligations du déployeur', () => {
    expect(keys(run({ T_DEEPFAKE: 'YES', T_PUBLIC_TEXT: 'YES' }))).toEqual(
      expect.arrayContaining(['AIA-OBL-T-50-4A', 'AIA-OBL-T-50-4B']),
    );
  });

  it('la transparence est distincte du haut risque (les deux coexistent)', () => {
    const r = run({ ...EMPLOYMENT, T_INTERACTS: 'YES' });
    expect(r.displayCategory).toBe('HIGH');
    expect(r.dimensions.transparency.value).toBe('APPLICABLE');
  });

  it('GPAI utilisé ou fourni', () => {
    expect(run({ G_USES_GPAI: 'YES' }).dimensions.gpai.values).toEqual(['USES_GPAI']);
    expect(keys(run({ G_PROVIDES_GPAI: 'YES' }))).toContain('AIA-OBL-GPAI-PRV');
  });

  it('FRIA requise : service public + annexe III ; crédit ou assurance', () => {
    expect(run({ ...EMPLOYMENT, F_PUBLIC_SERVICE: 'YES' }).dimensions.fria.value).toBe('REQUIRED');
    const credit = run({
      H_ANNEX_III: ['ESSENTIAL_SERVICES'],
      H_ESSENTIAL_USE: ['CREDITWORTHINESS'],
      H_PROFILING: 'NO',
      H_DEROGATION: 'NO',
    });
    expect(credit.dimensions.fria.value).toBe('REQUIRED');
    expect(keys(credit)).toContain('AIA-OBL-FRIA');
  });

  it('FRIA à confirmer si la mission de service public est inconnue ; non requise hors annexe III ou en infra critique seule', () => {
    expect(run({ ...EMPLOYMENT, F_PUBLIC_SERVICE: 'UNKNOWN' }).dimensions.fria.value).toBe('TO_CONFIRM');
    expect(run({ ...EMPLOYMENT, F_PUBLIC_SERVICE: 'NO' }).dimensions.fria.value).toBe('NOT_REQUIRED');
    expect(
      run({ H_ANNEX_III: ['CRITICAL_INFRA'], H_PROFILING: 'NO', H_DEROGATION: 'NO', F_PUBLIC_SERVICE: 'YES' })
        .dimensions.fria.value,
    ).toBe('NOT_REQUIRED');
  });
});

describe('mini-langage de conditions', () => {
  it('évalue les opérateurs et refuse une définition inconnue', () => {
    const a = { A: 'YES', M: ['X', 'Y'] };
    expect(evalCondition({ all: [{ eq: ['A', 'YES'] }, { includes: ['M', 'Y'] }] }, a, {})).toBe(true);
    expect(evalCondition({ any: [{ eq: ['A', 'NO'] }, { includesAny: ['M', ['Z']] }] }, a, {})).toBe(false);
    expect(evalCondition({ not: { unknown: 'A' } }, a, {})).toBe(true);
    expect(evalCondition({ unknown: 'B' }, a, {})).toBe(true);
    expect(() => evalCondition({ ref: 'inexistante' }, a, {})).toThrow(/définition inconnue/);
  });
});
