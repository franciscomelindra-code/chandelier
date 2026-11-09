import type { PrismaClient } from '@prisma/client';

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
  });
}
