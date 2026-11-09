// Données de référence (rôles, catégories RGPD, méthodologie). Idempotent.
import { PrismaClient } from '@prisma/client';
import { seedBase } from '../apps/api/src/seed/base.js';

const prisma = new PrismaClient();
await seedBase(prisma);
await prisma.$disconnect();
console.log('Données de référence à jour.');
