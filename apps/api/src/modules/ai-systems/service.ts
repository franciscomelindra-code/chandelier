import {
  FIELD_SECTION,
  SECTIONS,
  computeCompleteness,
  type AiSystemListQuery,
  type CompletenessRelations,
  type SectionKey,
} from '@chandelier/shared';
import type { Prisma } from '@prisma/client';
import { type PrismaClient } from '@prisma/client';
import { notFound } from '../../errors.js';
import { can, readScopes, type AccessContext, type AccessTarget } from '../../rbac/access.js';

type Db = PrismaClient | Prisma.TransactionClient;

export const systemInclude = {
  orgUnit: { select: { id: true, name: true, path: true, code: true } },
  owner: { select: { id: true, displayName: true, email: true } },
  businessOwner: { select: { id: true, displayName: true, email: true } },
  tags: { include: { tag: true } },
  vendors: { include: { vendor: { select: { id: true, name: true } } } },
  stakeholders: { include: { stakeholder: true }, orderBy: { function: 'asc' } },
  assets: { include: { asset: true } },
  processing: { include: { processingActivity: true } },
  datasets: { include: { dataset: true } },
  dataCategories: { include: { dataCategory: true } },
  dataSubjects: { include: { dataSubject: true } },
} satisfies Prisma.AiSystemInclude;

export type SystemRow = Prisma.AiSystemGetPayload<{ include: typeof systemInclude }>;

export function relationsOf(s: SystemRow): CompletenessRelations {
  return {
    functions: [...new Set(s.stakeholders.map((x) => x.function))],
    stakeholders: s.stakeholders.length,
    assets: s.assets.length,
    processing: s.processing.length,
    datasets: s.datasets.length,
    dataCategories: s.dataCategories.length,
    dataSubjects: s.dataSubjects.length,
  };
}

/**
 * Recalcul de la complétude de tous les SIA (au démarrage) : nécessaire quand les critères
 * évoluent avec une nouvelle tranche. Champ dérivé : ni version, ni journal.
 */
export async function recomputeAllCompleteness(prisma: PrismaClient): Promise<number> {
  let changed = 0;
  const ids = await prisma.aiSystem.findMany({ select: { id: true } });
  for (const { id } of ids) {
    const s = await prisma.aiSystem.findUniqueOrThrow({ where: { id }, include: systemInclude });
    const { percent } = computeCompleteness({ ...s, relations: relationsOf(s) });
    if (percent !== s.completeness) {
      await prisma.aiSystem.update({ where: { id }, data: { completeness: percent } });
      changed++;
    }
  }
  return changed;
}

/** Recalcule et stocke la complétude (critères de toutes les sections disponibles). */
export async function refreshCompleteness(tx: Prisma.TransactionClient, id: string): Promise<SystemRow> {
  const s = await tx.aiSystem.findUniqueOrThrow({ where: { id }, include: systemInclude });
  const { percent } = computeCompleteness({ ...s, relations: relationsOf(s) });
  if (percent === s.completeness) return s;
  await tx.aiSystem.update({ where: { id }, data: { completeness: percent } });
  return { ...s, completeness: percent };
}

/** Champs suivis dans le journal et l'historique de versions. */
export const TRACKED_FIELDS = [
  'reference',
  'name',
  'description',
  'purpose',
  'objectives',
  'useCases',
  'functioning',
  'scope',
  'operationalContext',
  'countries',
  'targetPopulations',
  'status',
  'autonomyLevel',
  'orgUnitId',
  'ownerId',
  'businessOwnerId',
  'aiActRoles',
  'firstDeploymentDate',
  'productionDate',
  'plannedRetirementDate',
  'actualRetirementDate',
  'nextReviewDate',
  'processesPersonalData',
  'includesMinors',
  'includesVulnerable',
  'affectedVolumeEstimate',
  'potentialConsequences',
  'valueLevel',
  'valueJustification',
  'valueDetails',
  'raciEnabled',
  'archivedAt',
  'archiveReason',
] as const;

export async function assignedSections(db: Db, aiSystemId: string, userId: string): Promise<string[]> {
  const rows = await db.sectionAssignment.findMany({ where: { aiSystemId, userId }, select: { section: true } });
  return rows.map((r) => r.section);
}

export function targetOf(
  s: { orgUnit: { path: string }; ownerId: string | null },
  sections: string[],
  section?: string,
): AccessTarget {
  return {
    orgUnitPath: s.orgUnit.path,
    ownerId: s.ownerId,
    assignedSections: sections,
    ...(section ? { section } : {}),
  };
}

/** Charge un SIA visible par l'utilisateur ; 404 s'il n'existe pas OU est hors périmètre (pas de fuite d'existence). */
export async function loadVisible(db: Db, ctx: AccessContext, id: string) {
  const s = await db.aiSystem.findUnique({ where: { id }, include: systemInclude });
  if (!s) throw notFound('SIA introuvable');
  const sections = await assignedSections(db, id, ctx.user.id);
  if (!can(ctx, 'aiSystem:read', targetOf(s, sections))) throw notFound('SIA introuvable');
  return { system: s, sections };
}

/** Sections que l'utilisateur peut modifier sur ce SIA. */
export function updatableSections(ctx: AccessContext, s: SystemRow, sections: string[]): SectionKey[] {
  return SECTIONS.filter((sec) => can(ctx, 'aiSystem:update', targetOf(s, sections, sec)));
}

export function sectionOfField(field: string): SectionKey {
  return FIELD_SECTION[field] ?? 'general';
}

/** Filtre Prisma limitant aux unités lisibles. */
export function scopeWhere(ctx: AccessContext): Prisma.AiSystemWhereInput {
  const scopes = readScopes(ctx, 'aiSystem:read');
  if (scopes.global) return {};
  const or: Prisma.OrganizationUnitWhereInput[] = [
    ...scopes.prefixes.map((p) => ({ path: { startsWith: p } })),
    ...scopes.exact.map((p) => ({ path: p })),
  ];
  // Aucun périmètre : condition impossible.
  return or.length ? { orgUnit: { OR: or } } : { id: { in: [] } };
}

/** Requête plein texte : chaque mot en préfixe (mot:*), combinés par ET. */
export function toTsQuery(input: string): string | null {
  const words = input
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => `${w.replace(/'/g, '')}:*`).join(' & ');
}

export async function fullTextIds(db: Db, q: string): Promise<string[]> {
  const tsq = toTsQuery(q);
  if (!tsq) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM "ai_system"
    WHERE "search" @@ to_tsquery('french', ${tsq}) OR "search" @@ to_tsquery('simple', ${tsq})
    LIMIT 5000`;
  return rows.map((r) => r.id);
}

export async function buildListWhere(
  db: Db,
  ctx: AccessContext,
  q: Omit<AiSystemListQuery, 'page' | 'pageSize' | 'sort' | 'dir'>,
): Promise<Prisma.AiSystemWhereInput> {
  const and: Prisma.AiSystemWhereInput[] = [scopeWhere(ctx)];
  if (q.archived === 'exclude') and.push({ archivedAt: null });
  if (q.archived === 'only') and.push({ archivedAt: { not: null } });
  if (q.demo === 'exclude') and.push({ isDemo: false });
  if (q.demo === 'only') and.push({ isDemo: true });
  if (q.status) and.push({ status: { in: q.status } });
  if (q.risk) and.push({ riskCategory: { in: q.risk } });
  if (q.value) and.push({ valueLevel: { in: q.value } });
  if (q.compliance) and.push({ complianceStatus: { in: q.compliance } });
  if (q.role) and.push({ aiActRoles: { hasSome: q.role } });
  if (q.ownerId) and.push({ ownerId: q.ownerId });
  if (q.tagId) and.push({ tags: { some: { tagId: q.tagId } } });
  if (q.personalData) and.push({ processesPersonalData: q.personalData });
  if (q.reviewBefore) and.push({ nextReviewDate: { lte: new Date(`${q.reviewBefore}T00:00:00Z`) } });
  if (q.orgUnitId) {
    const unit = await db.organizationUnit.findUnique({ where: { id: q.orgUnitId }, select: { path: true } });
    and.push(unit ? { orgUnit: { path: { startsWith: unit.path } } } : { id: { in: [] } });
  }
  if (q.q) {
    const ids = await fullTextIds(db, q.q);
    and.push({
      OR: [
        { id: { in: ids } },
        { reference: { contains: q.q, mode: 'insensitive' } },
        { name: { contains: q.q, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: and };
}

export function orderBy(
  sort: AiSystemListQuery['sort'],
  dir: 'asc' | 'desc',
): Prisma.AiSystemOrderByWithRelationInput[] {
  const primary: Prisma.AiSystemOrderByWithRelationInput =
    sort === 'nextReviewDate' ? { nextReviewDate: { sort: dir, nulls: 'last' } } : { [sort]: dir };
  return [primary, { reference: 'asc' }];
}

export function completenessOf(s: Parameters<typeof computeCompleteness>[0]) {
  return computeCompleteness(s);
}

/** Instantané versionné (comparaison / restauration en S7). */
export async function snapshot(tx: Prisma.TransactionClient, s: SystemRow, actorId: string, reason: string) {
  const {
    orgUnit: _o,
    owner: _ow,
    businessOwner: _b,
    tags,
    vendors,
    stakeholders,
    assets,
    processing,
    datasets,
    dataCategories,
    dataSubjects,
    ...row
  } = s;
  // Les liens sont figés par identifiant + attributs propres à la relation.
  const links = {
    tagIds: tags.map((t) => t.tagId),
    vendors: vendors.map((v) => ({ vendorId: v.vendorId, relation: v.relation })),
    stakeholders: stakeholders.map(({ stakeholder: _s, ...l }) => l),
    assets: assets.map(({ asset: _a, ...l }) => l),
    processing: processing.map(({ processingActivity: _p, ...l }) => l),
    datasets: datasets.map(({ dataset: _d, ...l }) => l),
    dataCategoryIds: dataCategories.map((c) => c.dataCategoryId),
    dataSubjects: dataSubjects.map(({ dataSubject: _d, ...l }) => l),
  };
  await tx.entityVersion.create({
    data: {
      entityType: 'AiSystem',
      entityId: s.id,
      version: s.version,
      snapshot: { ...row, ...links } as unknown as Prisma.InputJsonValue,
      reason,
      createdById: actorId,
    },
  });
}

export async function nextReference(db: Db): Promise<string> {
  const rows = await db.$queryRaw<{ n: number | null }[]>`
    SELECT max(substring("reference" from '^SIA-([0-9]+)$')::int) AS n FROM "ai_system"`;
  const n = (rows[0]?.n ?? 0) + 1;
  return `SIA-${String(n).padStart(4, '0')}`;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function serializeListItem(ctx: AccessContext, s: SystemRow, sections: string[] = []) {
  return {
    id: s.id,
    reference: s.reference,
    name: s.name,
    purpose: s.purpose.length > 240 ? `${s.purpose.slice(0, 237)}…` : s.purpose,
    status: s.status,
    orgUnit: { id: s.orgUnit.id, name: s.orgUnit.name },
    owner: s.owner ? { id: s.owner.id, displayName: s.owner.displayName } : null,
    businessOwner: s.businessOwner ? { id: s.businessOwner.id, displayName: s.businessOwner.displayName } : null,
    aiActRoles: s.aiActRoles,
    riskCategory: s.riskCategory,
    valueLevel: s.valueLevel,
    complianceStatus: s.complianceStatus,
    completeness: s.completeness,
    nextReviewDate: day(s.nextReviewDate),
    tags: s.tags.map((t) => ({ id: t.tag.id, label: t.tag.label, color: t.tag.color })),
    vendors: s.vendors.map((v) => v.vendor.name),
    isDemo: s.isDemo,
    archivedAt: s.archivedAt?.toISOString() ?? null,
    updatedAt: s.updatedAt.toISOString(),
    canUpdate: updatableSections(ctx, s, sections).length > 0,
    canArchive: can(ctx, 'aiSystem:archive', targetOf(s, sections)),
  };
}

export function serializeDetail(ctx: AccessContext, s: SystemRow, sections: string[]) {
  const sectionsAllowed = updatableSections(ctx, s, sections);
  return {
    ...serializeListItem(ctx, s, sections),
    purpose: s.purpose,
    description: s.description,
    objectives: s.objectives,
    useCases: s.useCases,
    functioning: s.functioning,
    scope: s.scope,
    operationalContext: s.operationalContext,
    countries: s.countries,
    targetPopulations: s.targetPopulations,
    autonomyLevel: s.autonomyLevel,
    owner: s.owner,
    businessOwner: s.businessOwner,
    firstDeploymentDate: day(s.firstDeploymentDate),
    productionDate: day(s.productionDate),
    plannedRetirementDate: day(s.plannedRetirementDate),
    actualRetirementDate: day(s.actualRetirementDate),
    processesPersonalData: s.processesPersonalData,
    includesMinors: s.includesMinors,
    includesVulnerable: s.includesVulnerable,
    affectedVolumeEstimate: s.affectedVolumeEstimate,
    potentialConsequences: s.potentialConsequences,
    valueJustification: s.valueJustification,
    riskJustification: s.riskJustification,
    archiveReason: s.archiveReason,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    completenessChecks: completenessOf({ ...s, relations: relationsOf(s) }).checks,
    valueDetails: s.valueDetails,
    raciEnabled: s.raciEnabled,
    stakeholders: s.stakeholders.map((l) => ({
      id: l.id,
      function: l.function,
      responsibility: l.responsibility,
      access: l.access,
      raci: l.raci,
      stakeholder: {
        id: l.stakeholder.id,
        name: l.stakeholder.name,
        kind: l.stakeholder.kind,
        organization: l.stakeholder.organization,
        contact: l.stakeholder.contact,
      },
    })),
    assets: s.assets.map((l) => ({
      dependency: l.dependency,
      asset: {
        id: l.asset.id,
        name: l.asset.name,
        type: l.asset.type,
        criticality: l.asset.criticality,
        location: l.asset.location,
      },
    })),
    processing: s.processing.map((l) => ({
      notes: l.notes,
      processingActivity: {
        id: l.processingActivity.id,
        reference: l.processingActivity.reference,
        name: l.processingActivity.name,
        legalBasis: l.processingActivity.legalBasis,
        dpiaRequired: l.processingActivity.dpiaRequired,
      },
    })),
    datasets: s.datasets.map((l) => ({
      usages: l.usages,
      notes: l.notes,
      dataset: {
        id: l.dataset.id,
        name: l.dataset.name,
        origin: l.dataset.origin,
        containsPersonalData: l.dataset.containsPersonalData,
        containsSpecialCategories: l.dataset.containsSpecialCategories,
        containsCriminalData: l.dataset.containsCriminalData,
        isSynthetic: l.dataset.isSynthetic,
        transfersOutsideEu: l.dataset.transfersOutsideEu,
      },
    })),
    dataCategories: s.dataCategories.map((c) => ({
      id: c.dataCategory.id,
      label: c.dataCategory.label,
      isSpecial: c.dataCategory.isSpecial,
      isCriminal: c.dataCategory.isCriminal,
    })),
    dataSubjects: s.dataSubjects.map((c) => ({
      id: c.dataSubject.id,
      label: c.dataSubject.label,
      isVulnerable: c.dataSubject.isVulnerable,
      volumeEstimate: c.volumeEstimate,
      consequences: c.consequences,
    })),
    permissions: {
      updatableSections: sectionsAllowed,
      canArchive: can(ctx, 'aiSystem:archive', targetOf(s, sections)),
      canExport: ctx.grants.some((g) => g.permission === 'aiSystem:export'),
    },
  };
}
