import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../src/assistant/provider.js';
import { authed, createOrgUnit, loginAs, setupApp, uniq, type Session, type TestCtx } from './helpers.js';

/** Fournisseur simulé : aucune requête externe ; enregistre ce qui lui est transmis. */
const calls: LlmRequest<unknown>[] = [];
const fake: LlmProvider = {
  name: 'fake',
  model: 'fake-model',
  enabled: true,
  async generate<T>(req: LlmRequest<T>) {
    calls.push(req as LlmRequest<unknown>);
    const raw = req.input.includes('Texte fourni')
      ? {
          fields: [
            {
              field: 'purpose',
              value: 'Répondre aux questions internes.',
              sourceExcerpt: 'répond aux questions',
              uncertainty: 'faible',
            },
          ],
        }
      : {
          risks: [
            {
              category: 'HALLUCINATION_ACCURACY',
              title: 'Réponses inexactes',
              scenario: 'Le modèle invente une procédure.',
              consequence: 'Erreur opérationnelle',
              basedOn: ['purpose'],
              uncertainty: 'moyenne',
            },
          ],
        };
    return {
      data: req.parse.parse(raw),
      provider: 'fake',
      model: 'fake-model',
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
};

let ctx: TestCtx;
let disabled: TestCtx;
let unit: { id: string };
let owner: { user: { id: string; email: string; displayName: string }; session: Session };
let reader: Session;

const req = (c: TestCtx, s: Session, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  c.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: method === 'GET' ? { cookie: s.cookie } : authed(s),
    payload: payload as never,
  });

beforeAll(async () => {
  ctx = await setupApp({ llm: fake });
  disabled = await setupApp();
  unit = await createOrgUnit(ctx.prisma);
  owner = await loginAs(ctx, [{ role: 'SYSTEM_OWNER', orgUnitId: unit.id }]);
  reader = (await loginAs(ctx, [{ role: 'READER', orgUnitId: unit.id }])).session;
});
afterAll(async () => {
  await ctx.close();
  await disabled.close();
});

describe('assistant IA', () => {
  it('désactivé par défaut : aucun appel possible', async () => {
    const s = (
      await req(disabled, owner.session, 'POST', '/ai-systems', { name: uniq('SIA'), orgUnitId: unit.id })
    ).json();
    expect((await req(disabled, owner.session, 'GET', '/assistant/status')).json().enabled).toBe(false);
    const r = await req(disabled, owner.session, 'POST', `/ai-systems/${s.id}/assistant/extract`, {
      text: 'x'.repeat(60),
    });
    expect(r.statusCode).toBe(503);
  });

  it('propositions « À vérifier », données minimisées, journal sans contenu, décision humaine', async () => {
    const s = (
      await req(ctx, owner.session, 'POST', '/ai-systems', {
        name: uniq('SIA assistant'),
        orgUnitId: unit.id,
        purpose: 'Assistant documentaire interne.',
      })
    ).json();
    expect(
      (await req(ctx, reader, 'POST', `/ai-systems/${s.id}/assistant/extract`, { text: 'x'.repeat(60) })).statusCode,
    ).toBe(403);

    const ex = await req(ctx, owner.session, 'POST', `/ai-systems/${s.id}/assistant/extract`, {
      text: 'Ce service répond aux questions des collaborateurs à partir de la base documentaire interne.',
    });
    expect(ex.statusCode, ex.body).toBe(200);
    const field = ex.json().items.find((i: { field: string }) => i.field === 'purpose');
    expect(field.status).toBe('TO_VERIFY');
    // Rien n'est appliqué automatiquement à la fiche.
    expect((await req(ctx, owner.session, 'GET', `/ai-systems/${s.id}`)).json().purpose).toBe(
      'Assistant documentaire interne.',
    );

    const rk = await req(ctx, owner.session, 'POST', `/ai-systems/${s.id}/assistant/risks`);
    expect(rk.statusCode, rk.body).toBe(200);
    const lastInput = calls.at(-1)!.input;
    expect(lastInput).not.toContain(owner.user.email);
    expect(lastInput).not.toContain(owner.user.displayName);

    const risk = rk
      .json()
      .items.find((i: { field: string; status: string }) => i.field === 'risk' && i.status === 'TO_VERIFY');
    const acc = await req(ctx, owner.session, 'POST', `/assistant/suggestions/${risk.id}/decide`, {
      decision: 'ACCEPTED',
    });
    expect(acc.statusCode, acc.body).toBe(200);
    const created = (await req(ctx, owner.session, 'GET', `/risks/${acc.json().riskId}`)).json();
    expect(created.inherentScore).toBeNull();
    expect(created.title).toBe('Réponses inexactes');
    expect(
      (await req(ctx, owner.session, 'POST', `/assistant/suggestions/${risk.id}/decide`, { decision: 'REJECTED' }))
        .statusCode,
    ).toBe(409);

    const events = await ctx.prisma.auditEvent.findMany({ where: { aiSystemId: s.id, action: 'assistant_call' } });
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events.map((e) => e.changes))).not.toContain('base documentaire');
    expect(events[0]!.origin).toBe('ASSISTANT');
  });
});
