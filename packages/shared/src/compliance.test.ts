import { describe, expect, it } from 'vitest';
import { friaMissingSections, generateNotice, markdownToHtml, parseMarkdown, suggestedBlocks } from './compliance.js';

const src = {
  organization: 'Organisation fictive',
  contact: '',
  system: {
    name: '[DEMO] Assistant',
    reference: 'SIA-DEMO-001',
    purpose: 'Aider à retrouver des documents internes.',
    functioning: '',
  },
  models: [{ name: 'Modèle fictif', vendor: 'Éditeur fictif' }],
  processesPersonalData: 'YES',
  hasHumanOversight: false,
};

describe('notice de transparence', () => {
  it('propose les blocs d’après la qualification', () => {
    expect(suggestedBlocks({ T_INTERACTS: 'YES', T_SYNTHETIC: 'NO' })).toEqual(['aiInteraction', 'humanContact']);
    expect(suggestedBlocks(null)).toEqual(['humanContact']);
  });

  it('génère une notice déterministe, avec des marqueurs « à compléter » au lieu d’inventer', () => {
    const md = generateNotice(src, ['aiInteraction', 'decisionSupport', 'humanContact']);
    expect(md).toContain('Vous échangez avec un système d’IA');
    expect(md).toContain('[À compléter : contact]');
    expect(md).toContain('[À compléter : modalités de contrôle humain]');
    expect(md).toContain('Vos données personnelles');
    expect(md).not.toContain('Contenus générés par IA');
    expect(generateNotice(src, ['aiInteraction'])).toBe(generateNotice(src, ['aiInteraction']));
  });

  it('exporte un HTML entièrement échappé', () => {
    const html = markdownToHtml(
      '# Titre <script>alert(1)</script>\n\n**Gras** & <img src=x onerror=alert(1)>\n\n- a\n- b',
      'T<',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>Gras</strong>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<title>T&lt;</title>');
  });

  it('analyse le sous-ensemble Markdown', () => {
    expect(parseMarkdown('# A\n\ntexte\nsuite\n\n---').map((b) => b.kind)).toEqual(['h1', 'p', 'hr']);
  });
});

describe('FRIA', () => {
  it('une section est complète si renseignée ou couverte par la DPIA liée', () => {
    const long = 'x'.repeat(30);
    const missing = friaMissingSections(
      { process: long, periodFrequency: long, affectedPersons: 'court' },
      ['affectedPersons', 'specificRisks'],
      ['affectedPersons'],
    );
    expect(missing).toEqual(['specificRisks', 'humanOversight', 'mitigation']);
  });
});
