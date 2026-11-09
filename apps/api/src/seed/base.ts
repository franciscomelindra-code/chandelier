import { ROLE_DEFINITIONS, ROLE_KEYS } from '@chandelier/shared';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Données de référence (non DEMO), idempotentes : rôles système, catégories RGPD,
 * méthodologie de risque par défaut. Exécuté à chaque démarrage de l'API.
 */
const DATA_CATEGORIES: { key: string; label: string; isSpecial?: boolean; isCriminal?: boolean }[] = [
  { key: 'IDENTITY', label: 'Identité (nom, prénom, identifiants internes)' },
  { key: 'CONTACT', label: 'Coordonnées' },
  { key: 'PROFESSIONAL', label: 'Vie professionnelle' },
  { key: 'LOCATION', label: 'Localisation / géolocalisation' },
  { key: 'TECHNICAL', label: 'Données de connexion et journaux techniques' },
  { key: 'ECONOMIC', label: 'Informations d’ordre économique et financier' },
  { key: 'IMAGE_VIDEO', label: 'Images / vidéo' },
  { key: 'VOICE', label: 'Voix' },
  { key: 'BEHAVIOUR', label: 'Habitudes de vie, comportement, usage' },
  { key: 'FREE_TEXT', label: 'Contenus libres (messages, documents)' },
  { key: 'HEALTH', label: 'Santé', isSpecial: true },
  { key: 'BIOMETRIC', label: 'Données biométriques d’identification', isSpecial: true },
  { key: 'GENETIC', label: 'Données génétiques', isSpecial: true },
  { key: 'RACIAL_ETHNIC', label: 'Origine raciale ou ethnique', isSpecial: true },
  { key: 'POLITICAL', label: 'Opinions politiques', isSpecial: true },
  { key: 'RELIGIOUS', label: 'Convictions religieuses ou philosophiques', isSpecial: true },
  { key: 'TRADE_UNION', label: 'Appartenance syndicale', isSpecial: true },
  { key: 'SEX_LIFE', label: 'Vie sexuelle ou orientation sexuelle', isSpecial: true },
  { key: 'CRIMINAL', label: 'Condamnations pénales et infractions', isCriminal: true },
];

const DATA_SUBJECTS: { key: string; label: string; isVulnerable?: boolean }[] = [
  { key: 'EMPLOYEES', label: 'Salariés' },
  { key: 'CANDIDATES', label: 'Candidats' },
  { key: 'CONTRACTORS', label: 'Prestataires, sous-traitants, chauffeurs' },
  { key: 'CUSTOMERS', label: 'Clients' },
  { key: 'PROSPECTS', label: 'Prospects' },
  { key: 'RECIPIENTS', label: 'Destinataires' },
  { key: 'USERS', label: 'Utilisateurs d’un service' },
  { key: 'PUBLIC', label: 'Grand public' },
  { key: 'MINORS', label: 'Mineurs', isVulnerable: true },
  { key: 'VULNERABLE', label: 'Personnes vulnérables', isVulnerable: true },
];

export const DEFAULT_RISK_METHODOLOGY = {
  name: 'Méthode par défaut 4×4',
  version: 1,
  config: {
    likelihood: [
      { value: 1, label: 'Rare' },
      { value: 2, label: 'Possible' },
      { value: 3, label: 'Probable' },
      { value: 4, label: 'Quasi certain' },
    ],
    severity: [
      { value: 1, label: 'Négligeable' },
      { value: 2, label: 'Limitée' },
      { value: 3, label: 'Importante' },
      { value: 4, label: 'Critique' },
    ],
    thresholds: [
      { min: 1, level: 'LOW', label: 'Faible', tone: 'green' },
      { min: 4, level: 'MODERATE', label: 'Modéré', tone: 'yellow' },
      { min: 8, level: 'SIGNIFICANT', label: 'Significatif', tone: 'orange' },
      { min: 12, level: 'CRITICAL', label: 'Critique', tone: 'red' },
    ],
  },
} as const;

export async function seedBase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const key of ROLE_KEYS) {
      const def = ROLE_DEFINITIONS[key];
      await tx.role.upsert({
        where: { key },
        // Les rôles système sont resynchronisés avec la matrice du code à chaque démarrage.
        update: { label: def.label, description: def.description, permissions: def.grants, isSystem: true },
        create: { key, label: def.label, description: def.description, permissions: def.grants, isSystem: true },
      });
    }
    for (const c of DATA_CATEGORIES) {
      await tx.dataCategory.upsert({
        where: { key: c.key },
        update: {},
        create: { key: c.key, label: c.label, isSpecial: !!c.isSpecial, isCriminal: !!c.isCriminal },
      });
    }
    for (const s of DATA_SUBJECTS) {
      await tx.dataSubjectCategory.upsert({
        where: { key: s.key },
        update: {},
        create: { key: s.key, label: s.label, isVulnerable: !!s.isVulnerable },
      });
    }
    const active = await tx.riskMethodology.findFirst({ where: { isActive: true } });
    if (!active) {
      await tx.riskMethodology.upsert({
        where: { name_version: { name: DEFAULT_RISK_METHODOLOGY.name, version: DEFAULT_RISK_METHODOLOGY.version } },
        update: { isActive: true },
        create: {
          name: DEFAULT_RISK_METHODOLOGY.name,
          version: DEFAULT_RISK_METHODOLOGY.version,
          isActive: true,
          config: DEFAULT_RISK_METHODOLOGY.config as unknown as Prisma.InputJsonValue,
        },
      });
    }
  });
}
