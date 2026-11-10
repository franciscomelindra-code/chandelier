import { describe, expect, it } from 'vitest';
import { AI_SYSTEM_STATUS_META } from './labels.js';
import { STATUS_ALIASES, htmlToText, matchEnum, parseCsv, parseDay, suggestMapping } from './import.js';

describe('import CSV', () => {
  it('analyse séparateur, guillemets, retours à la ligne et BOM', () => {
    const { headers, rows } = parseCsv(
      '\ufeffLabel;Description;State\r\n"Assistant ""RH""";"ligne 1\nligne 2";Draft\r\nOutil B;;Active\r\n\r\n',
    );
    expect(headers).toEqual(['Label', 'Description', 'State']);
    expect(rows).toEqual([
      ['Assistant "RH"', 'ligne 1\nligne 2', 'Draft'],
      ['Outil B', '', 'Active'],
    ]);
    expect(parseCsv('a,b\n1,2').rows).toEqual([['1', '2']]);
  });
  it('propose un mapping depuis les en-têtes de compatibilité', () => {
    const m = suggestMapping([
      'Label',
      'Ref',
      'State',
      'RiskLevel',
      'BenefitLevel',
      'DateCreation',
      'Colonne inconnue',
    ]);
    expect(m).toEqual({
      Label: 'name',
      Ref: 'reference',
      State: 'status',
      RiskLevel: 'declaredRiskLevel',
      BenefitLevel: 'valueLevel',
      DateCreation: null,
      'Colonne inconnue': null,
    });
  });
  it('reconnaît statuts, dates, et neutralise le HTML', () => {
    expect(matchEnum('Brouillon', AI_SYSTEM_STATUS_META, STATUS_ALIASES)).toBe('DRAFT');
    expect(matchEnum('active', AI_SYSTEM_STATUS_META, STATUS_ALIASES)).toBe('ACTIVE');
    expect(matchEnum('n’importe quoi', AI_SYSTEM_STATUS_META, STATUS_ALIASES)).toBeNull();
    expect(parseDay('05/03/2025')).toBe('2025-03-05');
    expect(parseDay('2025-03-05T10:00:00Z')).toBe('2025-03-05');
    expect(parseDay('')).toBeNull();
    expect(parseDay('demain')).toBeUndefined();
    expect(htmlToText('<p>Bonjour<script>alert(1)</script></p><ul><li>a &amp; b</li></ul>')).toBe('Bonjour\n\na & b');
  });
});
