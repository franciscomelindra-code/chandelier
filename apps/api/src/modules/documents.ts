import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DOCUMENT_TYPES,
  UPLOAD_FORMATS,
  documentMetaSchema,
  documentUpdateSchema,
  extensionOf,
  sanitizeFileName,
  sniffMatches,
  type UploadExtension,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { actorOf, requirePermission } from '../http.js';
import { can, hasPermission, type AccessContext } from '../rbac/access.js';
import { localStorage, type StoredFile } from '../storage.js';
import { loadVisible, scopeWhere, targetOf, type SystemRow } from './ai-systems/service.js';
import { namesFor, type Db } from './common.js';

const id = z.uuid();

const docInclude = {
  versions: { orderBy: { versionNo: 'desc' } },
  aiSystem: { select: { id: true, reference: true, name: true, isDemo: true } },
  aiModel: { select: { id: true, name: true } },
  obligations: { include: { obligation: { select: { id: true, title: true, templateKey: true } } } },
  risks: { include: { risk: { select: { id: true, reference: true, title: true } } } },
} satisfies Prisma.DocumentInclude;
type DocRow = Prisma.DocumentGetPayload<{ include: typeof docInclude }>;

function serialize(d: DocRow, names: Map<string, string>, canWrite?: boolean) {
  const current = d.versions[0] ?? null;
  return {
    id: d.id,
    title: d.title,
    type: d.type,
    description: d.description,
    currentVersionNo: d.currentVersionNo,
    aiSystem: d.aiSystem,
    aiModel: d.aiModel,
    isDemo: d.isDemo,
    archivedAt: d.archivedAt?.toISOString() ?? null,
    current: current && {
      versionNo: current.versionNo,
      fileName: current.fileName,
      sizeBytes: current.sizeBytes,
      mimeType: current.mimeType,
      scanStatus: current.scanStatus,
      uploadedAt: current.uploadedAt.toISOString(),
      uploadedBy: names.get(current.uploadedById) ?? null,
    },
    versions: d.versions.map((v) => ({
      versionNo: v.versionNo,
      fileName: v.fileName,
      sizeBytes: v.sizeBytes,
      sha256: v.sha256,
      scanStatus: v.scanStatus,
      changeNote: v.changeNote,
      uploadedAt: v.uploadedAt.toISOString(),
      uploadedBy: names.get(v.uploadedById) ?? null,
    })),
    obligations: d.obligations.map((l) => l.obligation),
    risks: d.risks.map((l) => l.risk),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    ...(canWrite === undefined ? {} : { permissions: { canWrite } }),
  };
}
const namesOfDocs = (db: Db, docs: DocRow[]) =>
  namesFor(
    db,
    docs.flatMap((d) => d.versions.map((v) => v.uploadedById)),
  );

const canUploadSystem = (ctx: AccessContext, s: SystemRow, sections: string[]) =>
  !s.archivedAt && can(ctx, 'document:upload', targetOf(s, sections, 'documentation'));

export const documentRoutes: FastifyPluginAsyncZod = async (app) => {
  const { prisma, config } = app.deps;
  const storage = localStorage(config.STORAGE_DIR);
  const maxBytes = config.UPLOAD_MAX_MB * 1024 * 1024;
  const tags = ['Documents et preuves'];

  /** Lecture du fichier multipart : champs AVANT le fichier, un seul fichier, taille bornée, format contrôlé. */
  async function receive(request: FastifyRequest) {
    if (!request.isMultipart()) throw badRequest('Envoi multipart/form-data attendu');
    const part = await request.file({ limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 4096 } });
    if (!part) throw badRequest('Aucun fichier reçu');
    const fileName = sanitizeFileName(part.filename);
    const ext = extensionOf(fileName) as UploadExtension;
    const format = UPLOAD_FORMATS[ext];
    if (!format) {
      part.file.resume();
      throw new AppError(
        415,
        'UNSUPPORTED_FORMAT',
        `Format non accepté (.${ext || '?'}) — formats admis : ${Object.keys(UPLOAD_FORMATS).join(', ')}`,
      );
    }
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(part.fields)) {
      const f = Array.isArray(v) ? v[0] : v;
      if (f && f.type === 'field') fields[k] = String(f.value);
    }
    const stored: StoredFile = await storage.save(part.file);
    const reject = async (e: AppError) => {
      await storage.remove(stored.storageKey);
      throw e;
    };
    if (part.file.truncated)
      await reject(new AppError(413, 'TOO_LARGE', `Fichier supérieur à ${config.UPLOAD_MAX_MB} Mo`));
    if (stored.sizeBytes === 0) await reject(badRequest('Fichier vide'));
    if (!sniffMatches(format.kind, stored.head))
      await reject(new AppError(415, 'CONTENT_MISMATCH', 'Le contenu du fichier ne correspond pas à son extension'));
    return { stored, fileName, mimeType: format.mime, fields };
  }

  async function loadDoc(db: Db, ctx: AccessContext, docId: string) {
    const d = await db.document.findUnique({ where: { id: docId }, include: docInclude });
    if (!d) throw notFound('Document introuvable');
    if (d.aiSystemId) {
      const { system, sections } = await loadVisible(db, ctx, d.aiSystemId).catch(() => {
        throw notFound('Document introuvable');
      });
      return { d, system, canWrite: canUploadSystem(ctx, system, sections) && !d.archivedAt };
    }
    if (!hasPermission(ctx, 'aiSystem:read')) throw notFound('Document introuvable');
    return { d, system: null, canWrite: hasPermission(ctx, 'catalog:manage') && !d.archivedAt };
  }
  async function out(db: Db, ctx: AccessContext, docId: string) {
    const { d, canWrite } = await loadDoc(db, ctx, docId);
    return serialize(d, await namesOfDocs(db, [d]), canWrite);
  }

  async function createDocument(
    request: FastifyRequest,
    ctx: AccessContext,
    owner: { aiSystemId?: string; aiModelId?: string; isDemo: boolean },
  ) {
    const { stored, fileName, mimeType, fields } = await receive(request);
    try {
      const meta = documentMetaSchema.safeParse({
        title: fields.title ?? fileName,
        type: fields.type ?? 'OTHER',
        description: fields.description ?? '',
      });
      if (!meta.success) throw badRequest(meta.error.issues.map((i) => i.message).join(' ; '));
      return await prisma.$transaction(async (tx) => {
        const d = await tx.document.create({
          data: {
            ...meta.data,
            ...owner,
            currentVersionNo: 1,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
            versions: {
              create: {
                versionNo: 1,
                storageKey: stored.storageKey,
                fileName,
                mimeType,
                sizeBytes: stored.sizeBytes,
                sha256: stored.sha256,
                uploadedById: ctx.user.id,
              },
            },
          },
        });
        await recordAudit(tx, actorOf(request), {
          action: 'upload',
          entityType: 'Document',
          entityId: d.id,
          aiSystemId: owner.aiSystemId ?? null,
          changes: {
            title: { old: null, new: d.title },
            file: { old: null, new: `${fileName} (${stored.sizeBytes} o, sha256 ${stored.sha256.slice(0, 12)}…)` },
          },
        });
        return d.id;
      });
    } catch (e) {
      await storage.remove(stored.storageKey);
      throw e;
    }
  }

  // ── Listes ──
  app.get(
    '/documents',
    {
      schema: {
        tags,
        summary: 'Documents du périmètre (SIA lisibles et modèles d’IA)',
        querystring: z.object({
          q: z.string().trim().max(200).optional(),
          type: z.enum(DOCUMENT_TYPES).optional(),
          aiSystemId: id.optional(),
          archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(5).max(200).default(50),
        }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const q = request.query;
      const and: Prisma.DocumentWhereInput[] = [
        { OR: [{ aiSystem: { AND: [scopeWhere(ctx), { archivedAt: null }] } }, { aiModelId: { not: null } }] },
      ];
      if (q.type) and.push({ type: q.type });
      if (q.aiSystemId) and.push({ aiSystemId: q.aiSystemId });
      if (q.archived === 'exclude') and.push({ archivedAt: null });
      if (q.archived === 'only') and.push({ archivedAt: { not: null } });
      if (q.q)
        and.push({
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
            { versions: { some: { fileName: { contains: q.q, mode: 'insensitive' } } } },
          ],
        });
      const where = { AND: and };
      const [total, rows] = await Promise.all([
        prisma.document.count({ where }),
        prisma.document.findMany({
          where,
          include: docInclude,
          orderBy: { updatedAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const names = await namesOfDocs(prisma, rows);
      return { items: rows.map((d) => serialize(d, names)), total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get(
    '/ai-systems/:sid/documents',
    { schema: { tags, summary: 'Documents du SIA', params: z.object({ sid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      const rows = await prisma.document.findMany({
        where: { aiSystemId: system.id },
        include: docInclude,
        orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { updatedAt: 'desc' }],
      });
      const names = await namesOfDocs(prisma, rows);
      return {
        items: rows.map((d) => serialize(d, names)),
        permissions: { canUpload: canUploadSystem(ctx, system, sections) },
        maxMb: config.UPLOAD_MAX_MB,
      };
    },
  );

  app.get(
    '/ai-models/:mid/documents',
    { schema: { tags, summary: 'Documents d’un modèle d’IA', params: z.object({ mid: id }) } },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const m = await prisma.aiModel.findUnique({ where: { id: request.params.mid }, select: { id: true } });
      if (!m) throw notFound();
      const rows = await prisma.document.findMany({
        where: { aiModelId: m.id },
        include: docInclude,
        orderBy: { updatedAt: 'desc' },
      });
      const names = await namesOfDocs(prisma, rows);
      return {
        items: rows.map((d) => serialize(d, names)),
        permissions: { canUpload: hasPermission(ctx, 'catalog:manage') },
        maxMb: config.UPLOAD_MAX_MB,
      };
    },
  );

  // ── Dépôt ──
  app.post(
    '/ai-systems/:sid/documents',
    {
      schema: {
        tags,
        summary: 'Déposer un document (multipart : champs title, type, description PUIS file)',
        params: z.object({ sid: id }),
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { system, sections } = await loadVisible(prisma, ctx, request.params.sid);
      if (system.archivedAt) throw conflict('SIA archivé');
      if (!canUploadSystem(ctx, system, sections)) throw forbidden('Droit de dépôt de documents requis sur ce SIA');
      const docId = await createDocument(request, ctx, { aiSystemId: system.id, isDemo: system.isDemo });
      return reply.status(201).send(await out(prisma, ctx, docId));
    },
  );

  app.post(
    '/ai-models/:mid/documents',
    {
      schema: {
        tags,
        summary: 'Déposer un document de modèle (catalog:manage)',
        params: z.object({ mid: id }),
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'catalog:manage');
      const m = await prisma.aiModel.findUnique({ where: { id: request.params.mid } });
      if (!m) throw notFound();
      const docId = await createDocument(request, ctx, { aiModelId: m.id, isDemo: m.isDemo });
      return reply.status(201).send(await out(prisma, ctx, docId));
    },
  );

  app.post(
    '/documents/:did/versions',
    {
      schema: {
        tags,
        summary: 'Nouvelle version (multipart : champ changeNote PUIS file)',
        params: z.object({ did: id }),
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { d, canWrite } = await loadDoc(prisma, ctx, request.params.did);
      if (!canWrite) throw forbidden('Document non modifiable');
      const { stored, fileName, mimeType, fields } = await receive(request);
      try {
        await prisma.$transaction(async (tx) => {
          // Verrou de ligne : numérotation des versions sans collision.
          const fresh = await tx.document.update({
            where: { id: d.id },
            data: { currentVersionNo: { increment: 1 }, updatedById: ctx.user.id },
          });
          await tx.documentVersion.create({
            data: {
              documentId: d.id,
              versionNo: fresh.currentVersionNo,
              storageKey: stored.storageKey,
              fileName,
              mimeType,
              sizeBytes: stored.sizeBytes,
              sha256: stored.sha256,
              changeNote: (fields.changeNote ?? '').slice(0, 1000),
              uploadedById: ctx.user.id,
            },
          });
          await recordAudit(tx, actorOf(request), {
            action: 'upload_version',
            entityType: 'Document',
            entityId: d.id,
            aiSystemId: d.aiSystemId,
            changes: {
              version: { old: d.currentVersionNo, new: fresh.currentVersionNo },
              file: { old: null, new: fileName },
            },
          });
        });
      } catch (e) {
        await storage.remove(stored.storageKey);
        throw e;
      }
      return reply.status(201).send(await out(prisma, ctx, d.id));
    },
  );

  app.get(
    '/documents/:did',
    { schema: { tags, summary: 'Détail d’un document (versions, preuves liées)', params: z.object({ did: id }) } },
    async (request) => out(prisma, requirePermission(request, 'aiSystem:read'), request.params.did),
  );

  app.get(
    '/documents/:did/versions/:no/download',
    {
      schema: {
        tags,
        summary: 'Télécharger une version (pièce jointe, jamais affichée en ligne)',
        params: z.object({ did: id, no: z.coerce.number().int().min(1) }),
      },
    },
    async (request, reply) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      const { d } = await loadDoc(prisma, ctx, request.params.did);
      const v = d.versions.find((x) => x.versionNo === request.params.no);
      if (!v) throw notFound('Version introuvable');
      if (v.scanStatus === 'INFECTED') throw forbidden('Fichier signalé infecté : téléchargement bloqué');
      const stream = await storage.open(v.storageKey).catch(() => {
        throw new AppError(410, 'FILE_MISSING', 'Fichier absent du stockage (restauration incomplète ?)');
      });
      await prisma.$transaction((tx) =>
        recordAudit(tx, actorOf(request), {
          action: 'download',
          entityType: 'Document',
          entityId: d.id,
          aiSystemId: d.aiSystemId,
          changes: { version: { old: null, new: v.versionNo } },
        }),
      );
      const ascii = v.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      return reply
        .header('Content-Type', v.mimeType)
        .header('Content-Length', v.sizeBytes)
        .header(
          'Content-Disposition',
          `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(v.fileName)}`,
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Cache-Control', 'private, no-store')
        .send(stream);
    },
  );

  app.patch(
    '/documents/:did',
    {
      schema: {
        tags,
        summary: 'Modifier titre, type, description',
        params: z.object({ did: id }),
        body: documentUpdateSchema,
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { d, canWrite } = await loadDoc(tx, ctx, request.params.did);
        if (!canWrite) throw forbidden('Document non modifiable');
        const u = await tx.document.update({
          where: { id: d.id },
          data: { ...request.body, updatedById: ctx.user.id },
        });
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const k of ['title', 'type', 'description'] as const)
          if (d[k] !== u[k]) changes[k] = { old: d[k], new: u[k] };
        await recordAudit(tx, actorOf(request), {
          action: 'update',
          entityType: 'Document',
          entityId: d.id,
          aiSystemId: d.aiSystemId,
          changes,
        });
      });
      return out(prisma, ctx, request.params.did);
    },
  );

  app.post(
    '/documents/:did/archive',
    {
      schema: {
        tags,
        summary: 'Archiver un document (les fichiers et preuves liées sont conservés)',
        params: z.object({ did: id }),
        body: z.strictObject({ reason: z.string().trim().min(10).max(1000) }),
      },
    },
    async (request) => {
      const ctx = requirePermission(request, 'aiSystem:read');
      await prisma.$transaction(async (tx) => {
        const { d, canWrite } = await loadDoc(tx, ctx, request.params.did);
        if (!canWrite) throw forbidden('Document non modifiable');
        await tx.document.update({ where: { id: d.id }, data: { archivedAt: new Date(), updatedById: ctx.user.id } });
        await recordAudit(tx, actorOf(request), {
          action: 'archive',
          entityType: 'Document',
          entityId: d.id,
          aiSystemId: d.aiSystemId,
          justification: request.body.reason,
        });
      });
      return out(prisma, ctx, request.params.did);
    },
  );

  // ── Preuves : rattachement aux obligations et aux risques du même SIA ──
  for (const target of ['obligations', 'risks'] as const) {
    const param = target === 'obligations' ? 'oid' : 'rid';
    const perm = target === 'obligations' ? 'obligation:update' : 'risk:manage';
    const load = async (db: Db, ctx: AccessContext, targetId: string) => {
      const row =
        target === 'obligations'
          ? await db.obligation.findUnique({ where: { id: targetId }, select: { aiSystemId: true, title: true } })
          : await db.risk.findUnique({ where: { id: targetId }, select: { aiSystemId: true, title: true } });
      if (!row) throw notFound();
      const { system, sections } = await loadVisible(db, ctx, row.aiSystemId).catch(() => {
        throw notFound();
      });
      if (system.archivedAt) throw conflict('SIA archivé');
      if (!can(ctx, perm, targetOf(system, sections))) throw forbidden();
      return { system, title: row.title };
    };
    app.post(
      `/${target}/:${param}/evidence`,
      {
        schema: {
          tags,
          summary: `Rattacher un document du SIA comme preuve (${perm})`,
          params: z.object({ [param]: id }) as z.ZodObject<{ oid: z.ZodUUID }>,
          body: z.strictObject({ documentId: id }),
        },
      },
      async (request, reply) => {
        const ctx = requirePermission(request, 'aiSystem:read');
        const targetId = (request.params as Record<string, string>)[param]!;
        await prisma.$transaction(async (tx) => {
          const { system, title } = await load(tx, ctx, targetId);
          const doc = await tx.document.findUnique({ where: { id: request.body.documentId } });
          if (!doc || doc.aiSystemId !== system.id) throw badRequest('Document inconnu pour ce SIA');
          if (doc.archivedAt) throw badRequest('Document archivé');
          if (target === 'obligations') {
            await tx.obligationEvidence.create({ data: { obligationId: targetId, documentId: doc.id } }).catch(() => {
              throw conflict('Preuve déjà rattachée');
            });
          } else {
            await tx.riskEvidence.create({ data: { riskId: targetId, documentId: doc.id } }).catch(() => {
              throw conflict('Preuve déjà rattachée');
            });
          }
          await recordAudit(tx, actorOf(request), {
            action: 'link_evidence',
            entityType: target === 'obligations' ? 'Obligation' : 'Risk',
            entityId: targetId,
            aiSystemId: system.id,
            changes: { evidence: { old: null, new: `${doc.title} → ${title}` } },
          });
        });
        return reply.status(204).send();
      },
    );
    app.delete(
      `/${target}/:${param}/evidence/:did`,
      {
        schema: {
          tags,
          summary: 'Détacher une preuve',
          params: z.object({ [param]: id, did: id }) as z.ZodObject<{ oid: z.ZodUUID; did: z.ZodUUID }>,
        },
      },
      async (request, reply) => {
        const ctx = requirePermission(request, 'aiSystem:read');
        const targetId = (request.params as Record<string, string>)[param]!;
        const did = (request.params as Record<string, string>).did!;
        await prisma.$transaction(async (tx) => {
          const { system } = await load(tx, ctx, targetId);
          const r =
            target === 'obligations'
              ? await tx.obligationEvidence.deleteMany({ where: { obligationId: targetId, documentId: did } })
              : await tx.riskEvidence.deleteMany({ where: { riskId: targetId, documentId: did } });
          if (!r.count) throw notFound('Preuve non rattachée');
          await recordAudit(tx, actorOf(request), {
            action: 'unlink_evidence',
            entityType: target === 'obligations' ? 'Obligation' : 'Risk',
            entityId: targetId,
            aiSystemId: system.id,
            changes: { evidence: { old: did, new: null } },
          });
        });
        return reply.status(204).send();
      },
    );
  }
};
