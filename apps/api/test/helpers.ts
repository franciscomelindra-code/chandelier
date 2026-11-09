import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { RoleKey } from '@chandelier/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { seedBase } from '../src/seed/base.js';
import { hashPassword } from '../src/auth/password.js';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const TEST_PASSWORD = 'Mot-de-passe-de-test-123';
let hashed: string | undefined;

export interface TestCtx {
  app: FastifyInstance;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

export async function setupApp(): Promise<TestCtx> {
  const url = process.env.DATABASE_URL_TEST!;
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    SESSION_SECRET: 'a'.repeat(64),
    APP_URL: 'http://localhost:8080',
    SECRETS_DIR: '',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await seedBase(prisma);
  const app = await buildApp({ config, prisma });
  await app.ready();
  return {
    app,
    prisma,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

let counter = 0;
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export async function createOrgUnit(prisma: PrismaClient, parentId: string | null = null) {
  const parent = parentId ? await prisma.organizationUnit.findUniqueOrThrow({ where: { id: parentId } }) : null;
  const id = crypto.randomUUID();
  return prisma.organizationUnit.create({
    data: {
      id,
      code: uniq('OU').toUpperCase(),
      name: uniq('Unité'),
      type: 'DIRECTION',
      parentId,
      path: `${parent?.path ?? '/'}${id}/`,
    },
  });
}

export async function createUser(
  prisma: PrismaClient,
  roles: { role: RoleKey; orgUnitId?: string | null; includeDescendants?: boolean }[],
  opts: { mustChangePassword?: boolean; isActive?: boolean } = {},
) {
  hashed ??= await hashPassword(TEST_PASSWORD);
  const user = await prisma.user.create({
    data: {
      email: `${uniq('user')}@test.invalid`,
      displayName: uniq('Utilisateur test'),
      passwordHash: hashed,
      mustChangePassword: opts.mustChangePassword ?? false,
      isActive: opts.isActive ?? true,
    },
  });
  for (const r of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: r.role } });
    await prisma.userRoleAssignment.create({
      data: {
        userId: user.id,
        roleId: role.id,
        orgUnitId: r.orgUnitId ?? null,
        includeDescendants: r.includeDescendants ?? true,
      },
    });
  }
  return user;
}

export interface Session {
  cookie: string;
  csrf: string;
}

export async function login(app: FastifyInstance, email: string, password = TEST_PASSWORD): Promise<Session> {
  // Adresse source aléatoire : la limitation de débit du login est par IP.
  const remoteAddress = `10.${counter % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  counter++;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
    remoteAddress,
  });
  if (res.statusCode !== 204) throw new Error(`login ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  const cookie = raw.split(';')[0]!;
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
  return { cookie, csrf: me.json<{ csrfToken: string }>().csrfToken };
}

export async function loginAs(ctx: TestCtx, roles: Parameters<typeof createUser>[1]) {
  const user = await createUser(ctx.prisma, roles);
  return { user, session: await login(ctx.app, user.email) };
}

export function authed(s: Session, extra: Record<string, string> = {}) {
  return { cookie: s.cookie, 'x-csrf-token': s.csrf, ...extra };
}
