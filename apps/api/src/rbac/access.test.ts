import { describe, expect, it } from 'vitest';
import { can, hasPermission, readScopes, type AccessContext, type EffectiveGrant } from './access.js';

const user = { id: 'u1', email: 'u@test', displayName: 'U', orgUnitId: null, mustChangePassword: false };
const grant = (g: Partial<EffectiveGrant>): EffectiveGrant => ({
  permission: 'aiSystem:update',
  qualifier: 'all',
  scopePath: null,
  includeDescendants: true,
  role: 'AI_GOVERNANCE',
  ...g,
});
const ctxOf = (...grants: EffectiveGrant[]): AccessContext => ({ user, grants, roles: [] });

describe('contrôle d’accès objet', () => {
  it('portée globale', () => {
    expect(can(ctxOf(grant({})), 'aiSystem:update', { orgUnitPath: '/a/b/' })).toBe(true);
  });

  it('portée unité avec et sans descendants', () => {
    const withDesc = ctxOf(grant({ scopePath: '/a/' }));
    expect(can(withDesc, 'aiSystem:update', { orgUnitPath: '/a/b/' })).toBe(true);
    expect(can(withDesc, 'aiSystem:update', { orgUnitPath: '/c/' })).toBe(false);
    const exact = ctxOf(grant({ scopePath: '/a/', includeDescendants: false }));
    expect(can(exact, 'aiSystem:update', { orgUnitPath: '/a/' })).toBe(true);
    expect(can(exact, 'aiSystem:update', { orgUnitPath: '/a/b/' })).toBe(false);
  });

  it('qualificatif own : uniquement les SIA dont on est propriétaire', () => {
    const c = ctxOf(grant({ qualifier: 'own', role: 'SYSTEM_OWNER' }));
    expect(can(c, 'aiSystem:update', { orgUnitPath: '/a/', ownerId: 'u1' })).toBe(true);
    expect(can(c, 'aiSystem:update', { orgUnitPath: '/a/', ownerId: 'u2' })).toBe(false);
    expect(can(c, 'aiSystem:update', { orgUnitPath: '/a/', ownerId: null })).toBe(false);
  });

  it('qualificatif assigned : uniquement les sections affectées', () => {
    const c = ctxOf(grant({ qualifier: 'assigned', role: 'CONTRIBUTOR' }));
    const base = { orgUnitPath: '/a/', assignedSections: ['data'] };
    expect(can(c, 'aiSystem:update', { ...base, section: 'data' })).toBe(true);
    expect(can(c, 'aiSystem:update', { ...base, section: 'general' })).toBe(false);
    expect(can(c, 'aiSystem:update', { ...base })).toBe(false);
  });

  it('une permission absente n’est jamais accordée', () => {
    const c = ctxOf(grant({}));
    expect(hasPermission(c, 'user:manage')).toBe(false);
    expect(can(c, 'aiSystem:archive', { orgUnitPath: '/a/' })).toBe(false);
  });

  it('calcule les périmètres de lecture', () => {
    expect(readScopes(ctxOf(grant({ permission: 'aiSystem:read' })), 'aiSystem:read')).toEqual({ global: true });
    expect(
      readScopes(
        ctxOf(
          grant({ permission: 'aiSystem:read', scopePath: '/a/' }),
          grant({ permission: 'aiSystem:read', scopePath: '/b/', includeDescendants: false }),
        ),
        'aiSystem:read',
      ),
    ).toEqual({ global: false, prefixes: ['/a/'], exact: ['/b/'] });
  });
});
