import { describe, expect, it } from 'vitest';
import {
  isOverdue,
  levelOf,
  methodologyConfigSchema,
  riskWarnings,
  scoreOf,
  scoringErrors,
  type MethodologyConfig,
} from './risk.js';

const cfg: MethodologyConfig = {
  likelihood: [1, 2, 3, 4].map((value) => ({ value, label: `V${value}` })),
  severity: [1, 2, 3, 4].map((value) => ({ value, label: `G${value}` })),
  thresholds: [
    { min: 1, level: 'LOW', label: 'Faible', tone: 'green' },
    { min: 4, level: 'MODERATE', label: 'Modéré', tone: 'yellow' },
    { min: 8, level: 'SIGNIFICANT', label: 'Significatif', tone: 'orange' },
    { min: 12, level: 'CRITICAL', label: 'Critique', tone: 'red' },
  ],
};

const base = { inherentLikelihood: null, inherentSeverity: null, residualLikelihood: null, residualSeverity: null };

describe('méthodologie de cotation', () => {
  it('accepte la méthode par défaut 4×4', () => {
    expect(methodologyConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('refuse des seuils non croissants, un premier seuil ≠ 1, un seuil au-delà du maximum', () => {
    const bad = (thresholds: MethodologyConfig['thresholds']) =>
      methodologyConfigSchema.safeParse({ ...cfg, thresholds }).success;
    expect(bad([cfg.thresholds[0]!, { ...cfg.thresholds[1]!, min: 1 }])).toBe(false);
    expect(bad([{ ...cfg.thresholds[0]!, min: 2 }, cfg.thresholds[1]!])).toBe(false);
    expect(bad([cfg.thresholds[0]!, { ...cfg.thresholds[1]!, min: 17 }])).toBe(false);
  });

  it('refuse une échelle avec des trous ou des codes de niveau en double', () => {
    expect(
      methodologyConfigSchema.safeParse({
        ...cfg,
        likelihood: [
          { value: 1, label: 'a' },
          { value: 3, label: 'b' },
        ],
      }).success,
    ).toBe(false);
    expect(
      methodologyConfigSchema.safeParse({
        ...cfg,
        thresholds: [cfg.thresholds[0]!, { ...cfg.thresholds[1]!, level: 'LOW' }],
      }).success,
    ).toBe(false);
  });

  it('calcule score et niveau aux bornes des seuils', () => {
    expect(scoreOf(cfg, 1, 1)).toBe(1);
    expect(levelOf(cfg, 3)?.level).toBe('LOW');
    expect(levelOf(cfg, 4)?.level).toBe('MODERATE');
    expect(levelOf(cfg, 8)?.level).toBe('SIGNIFICANT');
    expect(levelOf(cfg, 16)?.level).toBe('CRITICAL');
    expect(levelOf(cfg, null)).toBeNull();
    expect(() => scoreOf(cfg, 5, 1)).toThrow(RangeError);
  });
});

describe('cohérence de la cotation', () => {
  it('exige les deux axes et un résiduel ≤ inhérent sur chaque axe', () => {
    expect(scoringErrors(cfg, { ...base, inherentLikelihood: 3 })).toContain(
      'Risque inhérent : renseignez vraisemblance et gravité',
    );
    expect(
      scoringErrors(cfg, {
        inherentLikelihood: 2,
        inherentSeverity: 4,
        residualLikelihood: 3,
        residualSeverity: 1,
      }).some((e) => e.includes('ne peut pas dépasser')),
    ).toBe(true);
    expect(scoringErrors(cfg, { ...base, residualLikelihood: 1, residualSeverity: 1 })).toContain(
      'Le risque résiduel suppose un risque inhérent coté',
    );
    expect(scoringErrors(cfg, { ...base, inherentLikelihood: 5, inherentSeverity: 1 })).toContain(
      'Vraisemblance hors de l’échelle de la méthodologie',
    );
    expect(
      scoringErrors(cfg, { inherentLikelihood: 3, inherentSeverity: 3, residualLikelihood: 2, residualSeverity: 3 }),
    ).toEqual([]);
  });
});

describe('avertissements', () => {
  const r = {
    inherentLikelihood: 3,
    inherentSeverity: 4,
    residualLikelihood: 2,
    residualSeverity: 2,
    ownerId: 'u1',
    treatment: 'REDUCE',
    status: 'IN_TREATMENT',
    dueDate: '2026-12-31',
    existingMeasures: 1,
    methodologyActive: true,
  };
  it('aucun avertissement pour un risque complet', () => {
    expect(riskWarnings(r, '2026-11-10')).toEqual([]);
  });
  it('signale une réduction sans mesure en place, l’absence de propriétaire, l’échéance dépassée', () => {
    expect(riskWarnings({ ...r, existingMeasures: 0 }, '2026-11-10')).toContain('RESIDUAL_WITHOUT_MEASURE');
    expect(riskWarnings({ ...r, ownerId: null }, '2026-11-10')).toContain('NO_OWNER');
    expect(riskWarnings(r, '2027-01-01')).toContain('OVERDUE');
    expect(riskWarnings({ ...r, treatment: null }, '2026-11-10')).toContain('TREATMENT_MISSING');
    expect(riskWarnings({ ...r, methodologyActive: false }, '2026-11-10')).toContain('REPLACED_METHODOLOGY');
  });
  it('aucun avertissement pour un risque clos', () => {
    expect(riskWarnings({ ...r, status: 'CLOSED', ownerId: null }, '2027-01-01')).toEqual([]);
  });
  it('échéance des actions', () => {
    expect(isOverdue('OPEN', '2026-11-09', '2026-11-10')).toBe(true);
    expect(isOverdue('OPEN', '2026-11-10', '2026-11-10')).toBe(false);
    expect(isOverdue('DONE', '2026-01-01', '2026-11-10')).toBe(false);
    expect(isOverdue('IN_PROGRESS', null, '2026-11-10')).toBe(false);
  });
});
