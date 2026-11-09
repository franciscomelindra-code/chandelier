import { describe, expect, it } from 'vitest';
import { PERMISSIONS, READ_ONLY_PERMISSIONS, ROLE_DEFINITIONS, ROLE_KEYS, parseGrant } from './permissions.js';

const holders = (permission: string) =>
  ROLE_KEYS.filter((r) => ROLE_DEFINITIONS[r].grants.some((g) => parseGrant(g)?.permission === permission)).sort();

describe('matrice RBAC', () => {
  it('toutes les grants sont valides', () => {
    for (const r of ROLE_KEYS)
      for (const g of ROLE_DEFINITIONS[r].grants) expect(parseGrant(g), `${r} ${g}`).not.toBeNull();
  });

  it('rejette les grants mal formées', () => {
    expect(parseGrant('aiSystem')).toBeNull();
    expect(parseGrant('inconnu:read')).toBeNull();
    expect(parseGrant('aiSystem:update:partout')).toBeNull();
  });

  it('SUPER_ADMIN détient toutes les permissions', () => {
    expect(new Set(ROLE_DEFINITIONS.SUPER_ADMIN.grants)).toEqual(new Set(PERMISSIONS));
  });

  it('READER et AUDITOR sont en lecture seule', () => {
    for (const r of ['READER', 'AUDITOR'] as const) {
      for (const g of ROLE_DEFINITIONS[r].grants) {
        expect(READ_ONLY_PERMISSIONS, `${r} ${g}`).toContain(parseGrant(g)!.permission);
      }
    }
  });

  it('points critiques conformes à SECURITY.md', () => {
    expect(holders('assessment:override')).toEqual(['DPO', 'LEGAL', 'SUPER_ADMIN']);
    expect(holders('user:manage')).toEqual(['SUPER_ADMIN']);
    expect(holders('referential:manage')).toEqual(['LEGAL', 'SUPER_ADMIN']);
    expect(holders('audit:read')).toEqual(['AI_GOVERNANCE', 'AUDITOR', 'DPO', 'LEGAL', 'RSSI', 'SUPER_ADMIN']);
    expect(holders('notice:validate')).toEqual(['DPO', 'LEGAL', 'SUPER_ADMIN']);
  });

  it('SYSTEM_OWNER et CONTRIBUTOR ont des droits d’écriture qualifiés', () => {
    expect(ROLE_DEFINITIONS.SYSTEM_OWNER.grants).toContain('aiSystem:update:own');
    expect(ROLE_DEFINITIONS.SYSTEM_OWNER.grants).not.toContain('aiSystem:update');
    expect(ROLE_DEFINITIONS.CONTRIBUTOR.grants).toContain('aiSystem:update:assigned');
    expect(ROLE_DEFINITIONS.CONTRIBUTOR.grants).not.toContain('aiSystem:create');
  });
});
