import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, createOrgUnit, loginAs, multipart, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let unit: { id: string; code: string };
let other: { id: string };
let gov: Session;
let reader: Session;
let outsider: Session;

const req = (s: Session, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });
const upload = (s: Session, url: string, name: string, content: string) => {
  const b = multipart({}, { name, content });
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: authed(s, { 'content-type': b.contentType }),
    payload: b.payload,
  });
};

/** Lit les noms et contenus d'une archive ZIP (méthode deflate) produite par l'API. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extra;
    out[name] = inflateRawSync(buf.subarray(start, start + size));
    i = start + size;
  }
  return out;
}

beforeAll(async () => {
  ctx = await setupApp();
  unit = await createOrgUnit(ctx.prisma);
  other = await createOrgUnit(ctx.prisma);
  gov = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE', orgUnitId: unit.id }])).session;
  reader = (await loginAs(ctx, [{ role: 'READER', orgUnitId: unit.id }])).session;
  outsider = (await loginAs(ctx, [{ role: 'AI_GOVERNANCE', orgUnitId: other.id }])).session;
});
afterAll(async () => ctx.close());

describe('rapports et exports', () => {
  it('rapports standards en XLSX, CSV (formules neutralisées) et JSON, limités au périmètre', async () => {
    const s = (await req(gov, 'POST', '/ai-systems', { name: '=HYPERLINK("http://x")', orgUnitId: unit.id })).json();
    const catalog = (await req(reader, 'GET', '/reports')).json();
    expect(catalog.items).toHaveLength(11);

    const xlsx = await req(reader, 'GET', '/reports/registre?format=xlsx');
    expect(xlsx.statusCode).toBe(200);
    const files = unzip(xlsx.rawPayload);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']),
    );
    expect(files['xl/worksheets/sheet1.xml']!.toString()).toContain('t="inlineStr"');
    expect(files['xl/worksheets/sheet1.xml']!.toString()).toContain('=HYPERLINK(&quot;');

    const csv = await req(reader, 'GET', '/reports/registre?format=csv');
    expect(csv.body).toContain(`"'=HYPERLINK(""http://x"")"`);

    const json = (await req(reader, 'GET', '/reports/matrice-valeur-risque?format=json')).json();
    expect(json.rows).toHaveLength(6);
    const out = (await req(outsider, 'GET', '/reports/registre?format=json')).json();
    expect(out.rows.some((r: unknown[]) => r[0] === s.reference)).toBe(false);
    expect((await req(gov, 'GET', '/reports/inconnu')).statusCode).toBe(400);
  });

  it('fiche SIA et dossier d’audit ZIP (journal et pièces réservés aux détenteurs de audit:read)', async () => {
    const s = (await req(gov, 'POST', '/ai-systems', { name: uniq('SIA audit'), orgUnitId: unit.id })).json();
    const b = multipart({ title: 'Contrat', type: 'CONTRACT' }, { name: 'contrat.pdf', content: '%PDF-1.4\n%%EOF\n' });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/ai-systems/${s.id}/documents`,
      headers: authed(gov, { 'content-type': b.contentType }),
      payload: b.payload,
    });
    const sheet = await req(reader, 'GET', `/ai-systems/${s.id}/sheet?format=html`);
    expect(sheet.statusCode).toBe(200);
    expect(sheet.body).toContain(s.reference);
    expect((await req(reader, 'GET', `/ai-systems/${s.id}/audit-dossier`)).statusCode).toBe(403);
    const dossier = await req(gov, 'GET', `/ai-systems/${s.id}/audit-dossier`);
    expect(dossier.statusCode, dossier.body).toBe(200);
    const files = unzip(dossier.rawPayload);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['fiche.md', 'journal.csv', 'MANIFESTE.txt', 'pieces/contrat.pdf']),
    );
    expect(files['pieces/contrat.pdf']!.toString()).toBe('%PDF-1.4\n%%EOF\n');
    expect(files['MANIFESTE.txt']!.toString()).toMatch(/[0-9a-f]{64} {2}pieces\/contrat\.pdf/);
  });
});

describe('import du registre', () => {
  const csv = (rows: string[]) =>
    ['Label;Ref;State;RiskLevel;BenefitLevel;DateDeployment;TransparencyNoticeHtml', ...rows].join('\n');

  it('mapping proposé, validation, refus en bloc puis import transactionnel', async () => {
    const refA = uniq('EXT-A').slice(0, 30);
    const bad = await upload(
      gov,
      '/imports/ai-systems/preview',
      'registre.csv',
      csv([`Outil A;${refA};Active;Élevé;High;2025-01-15;`, 'Outil B;;Inconnu;;;demain;']),
    );
    expect(bad.statusCode, bad.body).toBe(201);
    const p = bad.json();
    expect(p.suggestedMapping.Label).toBe('name');
    expect(p.total).toBe(2);
    const body = { mapping: p.suggestedMapping, defaultOrgUnitId: unit.id };
    const v = (await req(gov, 'POST', `/imports/${p.jobId}/validate`, body)).json();
    expect(v.valid).toBe(false);
    expect(v.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['status', 'firstDeploymentDate']),
    );
    const refused = await req(gov, 'POST', `/imports/${p.jobId}/commit`, body);
    expect(refused.statusCode).toBe(400);
    expect(await ctx.prisma.aiSystem.count({ where: { reference: refA } })).toBe(0);

    const good = (
      await upload(
        gov,
        '/imports/ai-systems/preview',
        'registre.csv',
        csv([
          `Outil A;${refA};Active;Élevé;High;15/01/2025;"<p>Vous échangez avec une IA<script>x</script></p>"`,
          'Outil B;;Brouillon;;Faible;;',
        ]),
      )
    ).json();
    expect((await req(reader, 'POST', `/imports/${good.jobId}/commit`, body)).statusCode).toBe(403);
    expect((await req(outsider, 'POST', `/imports/${good.jobId}/commit`, body)).statusCode).toBe(404);
    const done = await req(gov, 'POST', `/imports/${good.jobId}/commit`, {
      mapping: good.suggestedMapping,
      defaultOrgUnitId: unit.id,
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().imported).toBe(2);
    const a = await ctx.prisma.aiSystem.findUniqueOrThrow({ where: { reference: refA }, include: { notices: true } });
    // Le niveau de risque déclaré n'est jamais repris comme qualification AI Act.
    expect(a.riskCategory).toBe('UNDETERMINED');
    expect(a.riskJustification).toContain('Élevé');
    expect(a.valueLevel).toBe('HIGH');
    expect(a.notices[0]!.contentMarkdown).not.toContain('<script>');
    expect(a.notices[0]!.status).toBe('IN_PROGRESS');
    const ev = await ctx.prisma.auditEvent.findFirst({ where: { entityId: a.id, action: 'import' } });
    expect(ev?.origin).toBe('IMPORT');
    expect((await req(gov, 'POST', `/imports/${good.jobId}/commit`, body)).statusCode).toBe(400);
  });
});
