import type { PrismaClient } from '@prisma/client';
import { computeCompleteness } from '@chandelier/shared';
import { recordAudit } from '../audit/audit.js';

/**
 * Jeu de démonstration MANIFESTEMENT FICTIF (CDC §18). Aucune donnée réelle de GLS France.
 * Toutes les lignes portent isDemo = true et des libellés "[DEMO]".
 * Volontairement sans comptes utilisateurs fictifs : les utilisateurs sont créés par l'administrateur.
 * Les SIA-DEMO-* et le modèle générique fictif sont ajoutés avec les slices S2/S4.
 */
const DEMO_UNITS = [
  { code: 'DEMO-ENTITE', name: '[DEMO] Entité fictive', type: 'ENTITY', parent: null },
  { code: 'DEMO-DIR-OPS', name: '[DEMO] Direction des opérations (fictive)', type: 'DIRECTION', parent: 'DEMO-ENTITE' },
  {
    code: 'DEMO-DIR-SI',
    name: '[DEMO] Direction des systèmes d’information (fictive)',
    type: 'DIRECTION',
    parent: 'DEMO-ENTITE',
  },
  { code: 'DEMO-EQ-DATA', name: '[DEMO] Équipe data (fictive)', type: 'TEAM', parent: 'DEMO-DIR-SI' },
] as const;

/** SIA fictifs prévus par le CDC §18. Aucun propriétaire : à affecter par l'administrateur. */
const DEMO_SYSTEMS = [
  {
    reference: 'SIA-DEMO-001',
    name: '[DEMO] Assistant documentaire interne',
    unit: 'DEMO-DIR-SI',
    purpose: 'Exemple fictif : aider les équipes à retrouver des procédures internes dans une base documentaire.',
    description:
      'Donnée de démonstration. Assistant conversationnel fictif interrogeant une base de documents internes (RAG).',
    useCases: 'Recherche documentaire ; résumé de procédures.',
    status: 'PILOT',
    aiActRoles: ['DEPLOYER'],
    valueLevel: 'MEDIUM',
    autonomyLevel: 'ASSISTIVE',
  },
  {
    reference: 'SIA-DEMO-002',
    name: '[DEMO] Prévision fictive de volumes logistiques',
    unit: 'DEMO-DIR-OPS',
    purpose: 'Exemple fictif : estimer des volumes de colis à J+7 pour dimensionner des ressources.',
    description:
      'Donnée de démonstration. Modèle de prévision de séries temporelles sur des volumes agrégés, sans données personnelles.',
    useCases: 'Prévision de charge ; planification.',
    status: 'DRAFT',
    aiActRoles: ['DEPLOYER'],
    valueLevel: 'HIGH',
    autonomyLevel: 'HUMAN_IN_THE_LOOP',
  },
] as const;

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const u of DEMO_UNITS) {
      const existing = await tx.organizationUnit.findUnique({ where: { code: u.code } });
      if (existing) continue;
      const parent = u.parent ? await tx.organizationUnit.findUniqueOrThrow({ where: { code: u.parent } }) : null;
      const id = crypto.randomUUID();
      await tx.organizationUnit.create({
        data: {
          id,
          code: u.code,
          name: u.name,
          type: u.type,
          parentId: parent?.id ?? null,
          path: `${parent?.path ?? '/'}${id}/`,
          isDemo: true,
        },
      });
    }
    for (const s of DEMO_SYSTEMS) {
      if (await tx.aiSystem.findUnique({ where: { reference: s.reference } })) continue;
      const unit = await tx.organizationUnit.findUniqueOrThrow({ where: { code: s.unit } });
      const { unit: _u, aiActRoles, ...data } = s;
      const created = await tx.aiSystem.create({
        data: {
          ...data,
          aiActRoles: [...aiActRoles],
          orgUnitId: unit.id,
          countries: ['FR'],
          processesPersonalData: s.reference === 'SIA-DEMO-002' ? 'NO' : 'UNKNOWN',
          isDemo: true,
        },
      });
      await tx.aiSystem.update({
        where: { id: created.id },
        data: { completeness: computeCompleteness(created).percent },
      });
      await recordAudit(
        tx,
        { id: null, label: 'système (jeu de démonstration)', origin: 'SYSTEM' },
        {
          action: 'create',
          entityType: 'AiSystem',
          entityId: created.id,
          aiSystemId: created.id,
          changes: { reference: { old: null, new: created.reference }, isDemo: { old: null, new: true } },
        },
      );
    }

    // Fournisseur et modèle génériques manifestement fictifs (CDC §18), liés à SIA-DEMO-001.
    const vendor =
      (await tx.vendor.findUnique({ where: { name: '[DEMO] Éditeur fictif' } })) ??
      (await tx.vendor.create({
        data: { name: '[DEMO] Éditeur fictif', country: 'FR', description: 'Donnée de démonstration.', isDemo: true },
      }));
    const modelName = '[DEMO] Modèle de langage générique fictif';
    const model =
      (await tx.aiModel.findFirst({ where: { name: modelName } })) ??
      (await tx.aiModel.create({
        data: {
          name: modelName,
          version: '0.1-demo',
          vendorId: vendor.id,
          type: 'LLM',
          accessMode: 'API',
          description: 'Donnée de démonstration : modèle fictif, sans lien avec un produit réel.',
          regions: ['UE'],
          isGpai: 'UNKNOWN',
          isDemo: true,
        },
      }));
    const sys = await tx.aiSystem.findUnique({ where: { reference: 'SIA-DEMO-001' } });
    if (sys && !(await tx.aiSystemModel.findFirst({ where: { aiSystemId: sys.id, aiModelId: model.id } }))) {
      await tx.aiSystemModel.create({
        data: {
          aiSystemId: sys.id,
          aiModelId: model.id,
          usageDescription: 'Exemple fictif : génération de réponses à partir des documents retrouvés (RAG).',
          isPrimary: true,
        },
      });
      await recordAudit(
        tx,
        { id: null, label: 'système (jeu de démonstration)', origin: 'SYSTEM' },
        {
          action: 'link_model',
          entityType: 'AiSystem',
          entityId: sys.id,
          aiSystemId: sys.id,
          changes: { models: { old: null, new: modelName } },
        },
      );
    }
  });
}
