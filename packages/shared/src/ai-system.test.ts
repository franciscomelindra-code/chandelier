import { describe, expect, it } from 'vitest';
import { aiSystemListQuerySchema, computeCompleteness, type CompletenessInput } from './ai-system.js';

const empty: CompletenessInput = {
  name: 'X',
  description: '',
  purpose: '',
  useCases: '',
  functioning: '',
  operationalContext: '',
  status: 'DRAFT',
  ownerId: null,
  businessOwnerId: null,
  aiActRoles: [],
  autonomyLevel: 'UNKNOWN',
  countries: [],
  processesPersonalData: 'UNKNOWN',
  valueLevel: 'UNKNOWN',
  valueJustification: '',
  nextReviewDate: null,
  productionDate: null,
  firstDeploymentDate: null,
};

describe('complétude', () => {
  it('vaut 0 % pour une fiche vide et liste chaque critère manquant', () => {
    const r = computeCompleteness(empty);
    expect(r.percent).toBe(0);
    expect(r.checks.every((c) => !c.ok)).toBe(true);
  });

  it('vaut 100 % quand tous les critères sont remplis', () => {
    const r = computeCompleteness({
      ...empty,
      description: 'Une description suffisamment longue.',
      purpose: 'Finalité claire',
      useCases: 'Cas',
      functioning: 'Fonctionnement',
      operationalContext: 'Contexte',
      ownerId: 'a',
      businessOwnerId: 'b',
      aiActRoles: ['DEPLOYER'],
      autonomyLevel: 'ASSISTIVE',
      countries: ['FR'],
      processesPersonalData: 'NO',
      valueLevel: 'HIGH',
      valueJustification: 'Gain de temps mesuré',
      nextReviewDate: '2027-01-01',
    });
    expect(r.percent).toBe(100);
  });

  it('exige une date de déploiement pour un SIA actif', () => {
    const active = computeCompleteness({ ...empty, status: 'ACTIVE' });
    expect(active.checks.map((c) => c.key)).toContain('deploymentDate');
    expect(computeCompleteness(empty).checks.map((c) => c.key)).not.toContain('deploymentDate');
  });
});

describe('paramètres de liste', () => {
  it('parse les listes séparées par des virgules', () => {
    const q = aiSystemListQuerySchema.parse({ status: 'DRAFT,ACTIVE', risk: 'HIGH' });
    expect(q.status).toEqual(['DRAFT', 'ACTIVE']);
    expect(q.risk).toEqual(['HIGH']);
    expect(q.archived).toBe('exclude');
  });

  it('rejette une valeur inconnue', () => {
    expect(aiSystemListQuerySchema.safeParse({ status: 'INVENTE' }).success).toBe(false);
  });
});
