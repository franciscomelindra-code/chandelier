// Jeu de démonstration FICTIF (isDemo = true). Ne jamais exécuter sur une base de production réelle.
import { PrismaClient } from '@prisma/client';
import { seedBase } from '../apps/api/src/seed/base.js';
import { seedDemo } from '../apps/api/src/seed/demo.js';

const prisma = new PrismaClient();
await seedBase(prisma);
await seedDemo(prisma);
await prisma.$disconnect();
console.log('Jeu de démonstration [DEMO] chargé.');
