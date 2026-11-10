import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { frameworkSchema, validateFramework, type Framework } from '@chandelier/shared';
import type { Prisma, PrismaClient } from '@prisma/client';

/** Répertoire des référentiels : REFERENTIALS_DIR, sinon ./referentials ou ../../referentials (exécution depuis apps/api). */
export function referentialsDir(): string {
  const candidates = [
    process.env.REFERENTIALS_DIR,
    resolve(process.cwd(), 'referentials'),
    resolve(process.cwd(), '../../referentials'),
  ];
  const found = candidates.find((c): c is string => !!c && existsSync(c));
  if (!found) throw new Error('Répertoire des référentiels introuvable (définir REFERENTIALS_DIR)');
  return found;
}

/** Empreinte du contenu canonique (indépendante des fins de ligne et de l'indentation du fichier). */
export const checksumOf = (fw: Framework) => createHash('sha256').update(JSON.stringify(fw)).digest('hex');

export function readFrameworks(dir = referentialsDir()): Framework[] {
  const out: Framework[] = [];
  for (const sub of readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    for (const f of readdirSync(join(dir, sub.name)).filter((n) => n.endsWith('.json'))) {
      const fw = frameworkSchema.parse(JSON.parse(readFileSync(join(dir, sub.name, f), 'utf8')));
      const errors = validateFramework(fw);
      if (errors.length) throw new Error(`Référentiel ${f} invalide :\n  - ${errors.join('\n  - ')}`);
      out.push(fw);
    }
  }
  return out;
}

/**
 * Importe les référentiels au démarrage. Une version déjà importée n'est JAMAIS modifiée :
 * si le contenu a changé sans changement de version, le démarrage échoue.
 * Une seule version ACTIVE par clé (la plus récente déclarée ACTIVE).
 */
export async function importFrameworks(prisma: PrismaClient): Promise<{ imported: string[] }> {
  const imported: string[] = [];
  for (const fw of readFrameworks()) {
    const checksum = checksumOf(fw);
    const existing = await prisma.regulatoryFramework.findUnique({
      where: { key_version: { key: fw.key, version: fw.version } },
    });
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Le référentiel ${fw.key} ${fw.version} a été modifié sans changement de version : créez une nouvelle version (une version importée est immuable).`,
        );
      }
      continue;
    }
    await prisma.$transaction(async (tx) => {
      if (fw.status === 'ACTIVE') {
        await tx.regulatoryFramework.updateMany({
          where: { key: fw.key, status: 'ACTIVE' },
          data: { status: 'RETIRED', effectiveTo: new Date() },
        });
      }
      const created = await tx.regulatoryFramework.create({
        data: {
          key: fw.key,
          version: fw.version,
          label: fw.label,
          status: fw.status,
          effectiveFrom: new Date(`${fw.effectiveFrom}T00:00:00Z`),
          content: fw as unknown as Prisma.InputJsonValue,
          checksum,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorLabel: 'système (import de référentiel)',
          origin: 'SYSTEM',
          action: 'import_framework',
          entityType: 'RegulatoryFramework',
          entityId: created.id,
          changes: { version: { old: null, new: `${fw.key} ${fw.version}` }, checksum: { old: null, new: checksum } },
        },
      });
    });
    imported.push(`${fw.key} ${fw.version}`);
  }
  return { imported };
}
