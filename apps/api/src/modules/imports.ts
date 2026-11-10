import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AI_SYSTEM_STATUS_META,
  EDITABLE_STATUSES,
  IGNORED_COLUMNS,
  STATUS_ALIASES,
  VALUE_ALIASES,
  VALUE_LEVEL_META,
  htmlToText,
  importMappingSchema,
  matchEnum,
  parseCsv,
  parseDay,
  suggestMapping,
  type ImportField,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { AppError, badRequest, forbidden, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, type AccessContext } from '../rbac/access.js';
import { nextReference, refreshCompleteness, snapshot, systemInclude } from './ai-systems/service.js';
import type { Db } from './common.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;

interface Parsed {
  headers: string[];
  rows: string[][];
}
interface RowError {
  row: number;
  field: string;
  message: string;
}
interface Prepared {
  row: number;
  data: Prisma.AiSystemUncheckedCreateInput;
  noticeText: string | null;
  declaredRisk: string | null;
  archived: boolean;
}

/** Validation de toutes les lignes ; aucune écriture. */
async function prepare(
  db: Db,
  ctx: AccessContext,
  parsed: Parsed,
  mapping: Record<string, ImportField | null>,
  defaultOrgUnitId: string | null,
) {
  const errors: RowError[] = [];
  const prepared: Prepared[] = [];
  const unknownCols = Object.keys(mapping).filter((h) => !parsed.headers.includes(h));
  if (unknownCols.length)
    errors.push({ row: 0, field: unknownCols.join(', '), message: 'Colonnes du mapping absentes du fichier' });
  const targets = Object.values(mapping).filter(Boolean) as ImportField[];
  const dup = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (dup.length) errors.push({ row: 0, field: dup.join(', '), message: 'Champ cible associé à plusieurs colonnes' });
  if (!targets.includes('name'))
    errors.push({ row: 0, field: 'name', message: 'La colonne du nom doit être associée' });
  if (errors.length) return { errors, prepared };

  const units = await db.organizationUnit.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, path: true },
  });
  const defaultUnit = defaultOrgUnitId ? units.find((u) => u.id === defaultOrgUnitId) : undefined;
  if (defaultOrgUnitId && !defaultUnit)
    errors.push({ row: 0, field: 'defaultOrgUnitId', message: 'Unité par défaut inconnue ou désactivée' });
  const users = await db.user.findMany({ where: { isActive: true }, select: { id: true, email: true } });
  const existingRefs = new Set((await db.aiSystem.findMany({ select: { reference: true } })).map((s) => s.reference));
  const fileRefs = new Set<string>();
  const col = (field: ImportField) => {
    const h = Object.entries(mapping).find(([, f]) => f === field)?.[0];
    return h === undefined ? -1 : parsed.headers.indexOf(h);
  };
  const idx = Object.fromEntries(
    (
      [
        'name',
        'reference',
        'description',
        'purpose',
        'status',
        'orgUnit',
        'ownerEmail',
        'declaredRiskLevel',
        'declaredRiskJustification',
        'valueLevel',
        'valueJustification',
        'firstDeploymentDate',
        'actualRetirementDate',
        'archivedOn',
        'noticeHtml',
      ] as ImportField[]
    ).map((f) => [f, col(f)]),
  ) as Record<ImportField, number>;

  parsed.rows.forEach((r, i) => {
    const line = i + 2; // ligne 1 = en-têtes
    const get = (f: ImportField) => (idx[f] >= 0 ? (r[idx[f]] ?? '').trim() : '');
    const err = (field: string, message: string) => errors.push({ row: line, field, message });
    const name = get('name');
    if (name.length < 2 || name.length > 200) err('name', 'Nom obligatoire (2 à 200 caractères)');
    const reference = get('reference');
    if (reference) {
      if (reference.length > 40 || !/^[\w.\-/ ]+$/u.test(reference))
        err('reference', 'Référence invalide (40 caractères, lettres, chiffres, . - / _)');
      else if (existingRefs.has(reference) || fileRefs.has(reference))
        err('reference', `Référence déjà utilisée : ${reference}`);
      fileRefs.add(reference);
    }
    const unitVal = get('orgUnit');
    const unit = unitVal
      ? units.find(
          (u) => u.code.toLowerCase() === unitVal.toLowerCase() || u.name.toLowerCase() === unitVal.toLowerCase(),
        )
      : defaultUnit;
    if (!unit) err('orgUnit', unitVal ? `Unité inconnue : ${unitVal}` : 'Unité absente et aucune unité par défaut');
    const ownerEmail = get('ownerEmail').toLowerCase();
    const owner = ownerEmail ? users.find((u) => u.email.toLowerCase() === ownerEmail) : undefined;
    if (ownerEmail && !owner) err('ownerEmail', 'Propriétaire inconnu ou désactivé');
    if (
      unit &&
      !can(ctx, 'aiSystem:create', {
        orgUnitPath: unit.path,
        ownerId: owner?.id ?? ctx.user.id,
        section: 'general',
        assignedSections: [],
      })
    )
      err('orgUnit', 'Unité hors de votre périmètre de création');
    const statusVal = get('status');
    const status = statusVal ? matchEnum(statusVal, AI_SYSTEM_STATUS_META, STATUS_ALIASES) : 'DRAFT';
    if (!status || status === 'ARCHIVED' || !(EDITABLE_STATUSES as readonly string[]).includes(status))
      err('status', `Statut non reconnu : ${statusVal}`);
    const valueVal = get('valueLevel');
    const valueLevel = valueVal ? matchEnum(valueVal, VALUE_LEVEL_META, VALUE_ALIASES) : 'UNKNOWN';
    if (!valueLevel) err('valueLevel', `Niveau de valeur non reconnu : ${valueVal}`);
    const dates: Record<string, string | null> = {};
    for (const f of ['firstDeploymentDate', 'actualRetirementDate', 'archivedOn'] as const) {
      const d = parseDay(get(f));
      if (d === undefined) err(f, `Date invalide : ${get(f)} (AAAA-MM-JJ ou JJ/MM/AAAA)`);
      else dates[f] = d;
    }
    for (const f of ['description', 'purpose', 'valueJustification', 'declaredRiskJustification'] as const)
      if (get(f).length > 10_000) err(f, '10 000 caractères maximum');
    const declaredRisk = get('declaredRiskLevel');
    const riskNote = declaredRisk
      ? `Niveau de risque déclaré dans l’outil source : « ${declaredRisk} »${get('declaredRiskJustification') ? ` — ${get('declaredRiskJustification')}` : ''}. Non repris comme qualification : qualification AI Act à réaliser.`
      : '';
    if (!unit || !status || !valueLevel) return;
    prepared.push({
      row: line,
      declaredRisk: declaredRisk || null,
      noticeText: get('noticeHtml') ? htmlToText(get('noticeHtml')).slice(0, 50_000) : null,
      archived: !!dates.archivedOn,
      data: {
        reference: reference || '',
        name,
        description: get('description'),
        purpose: get('purpose'),
        status: status as never,
        orgUnitId: unit.id,
        ownerId: owner?.id ?? null,
        valueLevel: valueLevel as never,
        valueJustification: get('valueJustification'),
        riskJustification: riskNote,
        firstDeploymentDate: dates.firstDeploymentDate ? new Date(`${dates.firstDeploymentDate}T00:00:00Z`) : null,
        actualRetirementDate: dates.actualRetirementDate ? new Date(`${dates.actualRetirementDate}T00:00:00Z`) : null,
        ...(dates.archivedOn
          ? {
              archivedAt: new Date(`${dates.archivedOn}T00:00:00Z`),
              archiveReason: 'Archivé dans l’outil source (import)',
              statusBeforeArchive: status as never,
              status: 'ARCHIVED' as never,
            }
          : {}),
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      },
    });
  });
  return { errors, prepared };
}

function parseUpload(fileName: string, buf: Buffer): Parsed {
  const text = buf.toString('utf8');
  if (/\.json$/i.test(fileName)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw badRequest('JSON invalide');
    }
    const arr = Array.isArray(data)
      ? data
      : Array.isArray((data as { items?: unknown }).items)
        ? (data as { items: unknown[] }).items
        : null;
    if (!arr) throw badRequest('Tableau d’objets attendu (ou { "items": [...] })');
    const headers = [...new Set(arr.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o as object) : [])))];
    const rows = arr.map((o) =>
      headers.map((h) => {
        const v = (o as Record<string, unknown>)[h];
        return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      }),
    );
    return { headers, rows };
  }
  if (!/\.(csv|txt)$/i.test(fileName))
    throw new AppError(
      415,
      'UNSUPPORTED_FORMAT',
      'Formats d’import : CSV ou JSON (XLSX : fonctionnalité non implémentée)',
    );
  if (text.includes('\u0000')) throw badRequest('Fichier binaire refusé');
  return parseCsv(text);
}

export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma } = app.deps;
  const tags = ['Import'];

  async function loadJob(ctx: AccessContext, jobId: string) {
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    // Un utilisateur ne voit que ses propres imports.
    if (!job || job.createdById !== ctx.user.id) throw notFound('Import introuvable');
    return job;
  }

  app.post(
    '/imports/ai-systems/preview',
    {
      schema: {
        tags,
        summary: 'Téléverser un CSV / JSON : en-têtes, mapping proposé, aperçu (aucune écriture dans le registre)',
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'import:run');
      if (!request.isMultipart()) throw badRequest('Envoi multipart/form-data attendu');
      const part = await request.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
      if (!part) throw badRequest('Aucun fichier reçu');
      const buf = await part.toBuffer().catch(() => {
        throw new AppError(413, 'TOO_LARGE', 'Fichier d’import limité à 2 Mo');
      });
      const parsed = parseUpload(part.filename, buf);
      // Les aperçus non importés (lignes source) ne sont pas conservés au-delà de 24 heures.
      await prisma.importJob.deleteMany({
        where: { status: 'PREVIEW', createdAt: { lt: new Date(Date.now() - 86_400_000) } },
      });
      if (!parsed.headers.length) throw badRequest('Fichier vide');
      if (parsed.rows.length > MAX_ROWS) throw badRequest(`Au plus ${MAX_ROWS} lignes par import`);
      const job = await prisma.importJob.create({
        data: {
          kind: 'ai-systems',
          status: 'PREVIEW',
          fileName: part.filename.slice(0, 200),
          mapping: suggestMapping(parsed.headers),
          report: { headers: parsed.headers, rows: parsed.rows } as unknown as Prisma.InputJsonValue,
          createdById: ctx.user.id,
        },
      });
      return reply.status(201).send({
        jobId: job.id,
        fileName: job.fileName,
        headers: parsed.headers,
        suggestedMapping: job.mapping,
        ignoredColumns: parsed.headers.filter((h) => IGNORED_COLUMNS.includes(h.toLowerCase())),
        sample: parsed.rows.slice(0, 20),
        total: parsed.rows.length,
      });
    },
  );

  app.post(
    '/imports/:jobId/validate',
    {
      schema: {
        tags,
        summary: 'Valider l’import avec un mapping (aucune écriture)',
        params: z.object({ jobId: z.uuid() }),
        body: importMappingSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'import:run');
      const job = await loadJob(ctx, request.params.jobId);
      if (job.status !== 'PREVIEW') throw badRequest('Import déjà traité');
      const { errors, prepared } = await prepare(
        prisma,
        ctx,
        job.report as unknown as Parsed,
        request.body.mapping,
        request.body.defaultOrgUnitId,
      );
      return {
        valid: errors.length === 0,
        errors: errors.slice(0, 500),
        errorCount: errors.length,
        rows: (job.report as unknown as Parsed).rows.length,
        importable: prepared.length,
      };
    },
  );

  app.post(
    '/imports/:jobId/commit',
    {
      schema: {
        tags,
        summary: 'Importer : tout ou rien (une seule erreur annule l’import et renvoie le rapport)',
        params: z.object({ jobId: z.uuid() }),
        body: importMappingSchema,
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'import:run');
      if (!ctx.grants.some((g) => g.permission === 'aiSystem:create'))
        throw forbidden('Droit de création de SIA requis');
      const job = await loadJob(ctx, request.params.jobId);
      if (job.status !== 'PREVIEW') throw badRequest('Import déjà traité');
      const parsed = job.report as unknown as Parsed;
      const result = await prisma.$transaction(
        async (tx) => {
          const { errors, prepared } = await prepare(
            tx,
            ctx,
            parsed,
            request.body.mapping,
            request.body.defaultOrgUnitId,
          );
          if (errors.length) return { errors };
          const actor = { ...actorOf(request), origin: 'IMPORT' as const };
          const created: string[] = [];
          for (const p of prepared) {
            const reference = (p.data.reference as string) || (await nextReference(tx));
            const s = await tx.aiSystem.create({ data: { ...p.data, reference } });
            if (p.noticeText) {
              await tx.transparencyNotice.create({
                data: {
                  aiSystemId: s.id,
                  version: 1,
                  status: 'IN_PROGRESS',
                  origin: 'IMPORT',
                  blocks: [],
                  contentMarkdown: `${p.noticeText}\n\n[À compléter : relire la notice importée avant soumission]`,
                  createdById: ctx.user.id,
                  updatedById: ctx.user.id,
                },
              });
            }
            await refreshCompleteness(tx, s.id);
            const full = await tx.aiSystem.findUniqueOrThrow({ where: { id: s.id }, include: systemInclude });
            await snapshot(tx, full, ctx.user.id, `import ${job.fileName} (ligne ${p.row})`);
            await recordAudit(tx, actor, {
              action: 'import',
              entityType: 'AiSystem',
              entityId: s.id,
              aiSystemId: s.id,
              justification: `Import ${job.fileName}, ligne ${p.row}`,
              changes: {
                reference: { old: null, new: reference },
                name: { old: null, new: s.name },
                ...(p.declaredRisk ? { declaredRiskLevel: { old: null, new: `${p.declaredRisk} (informatif)` } } : {}),
                ...(p.archived ? { archivedAt: { old: null, new: s.archivedAt?.toISOString() } } : {}),
              },
            });
            created.push(reference);
          }
          await tx.importJob.update({
            where: { id: job.id },
            data: {
              status: 'COMPLETED',
              mapping: request.body.mapping,
              // Les lignes source ne sont plus conservées une fois importées : seul le résumé reste.
              report: { created, count: created.length, completedAt: new Date().toISOString() },
            },
          });
          return { created };
        },
        { timeout: 120_000 },
      );
      if ('errors' in result) {
        return reply.status(400).send({
          error: {
            code: 'IMPORT_INVALID',
            message: `Import refusé : ${result.errors!.length} erreur(s), aucune ligne importée`,
            details: { errors: result.errors!.slice(0, 500) },
          },
        });
      }
      return { imported: result.created.length, references: result.created };
    },
  );

  app.get('/imports', { schema: { tags, summary: 'Mes imports récents' } }, async (request) => {
    const ctx = requirePermission(request, 'import:run');
    const jobs = await prisma.importJob.findMany({
      where: { createdById: ctx.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      items: jobs.map((j) => ({
        id: j.id,
        fileName: j.fileName,
        status: j.status,
        createdAt: j.createdAt.toISOString(),
        count: j.status === 'COMPLETED' ? ((j.report as { count?: number }).count ?? 0) : null,
      })),
    };
  });
};
