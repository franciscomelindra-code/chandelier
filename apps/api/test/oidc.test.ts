import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { seedBase } from '../src/seed/base.js';
import { uniq } from './helpers.js';

/** Fournisseur d'identité simulé (local, aucun appel externe). */
let idp: Server;
let issuer = '';
let privateKey: CryptoKey;
let pendingNonce = '';
let tokenClaims: Record<string, unknown> = {};
let signWithOtherKey = false;
let otherKey: CryptoKey;

let app: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
  const signing = await generateKeyPair('RS256', { extractable: true });
  privateKey = signing.privateKey;
  const realPublic = await exportJWK(signing.publicKey);
  // Clé étrangère au JWKS publié : un jeton signé avec elle doit être refusé.
  otherKey = (await generateKeyPair('RS256')).privateKey;
  idp = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/.well-known/openid-configuration') {
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
    } else if (url.pathname === '/jwks') {
      res.end(JSON.stringify({ keys: [{ ...realPublic, kid: 'k1', alg: 'RS256', use: 'sig' }] }));
    } else if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const p = new URLSearchParams(body);
        if (p.get('client_secret') !== 'secret-de-test' || !p.get('code_verifier')) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'invalid_client' }));
        }
        const idToken = await new SignJWT({ nonce: pendingNonce, ...tokenClaims })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience('client-de-test')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(signWithOtherKey ? otherKey : privateKey);
        res.end(JSON.stringify({ id_token: idToken, token_type: 'Bearer' }));
      });
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;

  const url = process.env.DATABASE_URL_TEST!;
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    SESSION_SECRET: 'b'.repeat(64),
    APP_URL: 'http://localhost:8080',
    SECRETS_DIR: '',
    AUTH_MODE: 'oidc',
    OIDC_ISSUER: issuer,
    ENTRA_CLIENT_ID: 'client-de-test',
    ENTRA_CLIENT_SECRET: 'secret-de-test',
  });
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await seedBase(prisma);
  app = await buildApp({ config, prisma });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await new Promise((r) => idp.close(r));
});

async function startLogin() {
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/oidc/login' });
  expect(res.statusCode).toBe(302);
  const loc = new URL(res.headers.location as string);
  expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
  pendingNonce = loc.searchParams.get('nonce')!;
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(';')[0]!;
  return { state: loc.searchParams.get('state')!, cookie };
}
const callback = (state: string, cookie: string) =>
  app.inject({ method: 'GET', url: `/api/v1/auth/oidc/callback?code=abc&state=${state}`, headers: { cookie } });

describe('Microsoft Entra ID (OIDC)', () => {
  it('connexion locale désactivée, options exposées à l’écran de connexion', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'x@test.invalid', password: 'abcdefghijklmn' },
    });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/session' })).json()).toEqual({
      authenticated: false,
      sso: true,
      localLogin: false,
    });
  });

  it('ouvre une session pour un compte OIDC pré-provisionné et lie l’identifiant IdP', async () => {
    const email = `${uniq('sso')}@test.invalid`;
    const user = await prisma.user.create({ data: { email, displayName: 'Utilisateur SSO', authProvider: 'OIDC' } });
    tokenClaims = { oid: `oid-${user.id}`, email };
    signWithOtherKey = false;
    const { state, cookie } = await startLogin();
    const res = await callback(state, cookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:8080/');
    const sid = (res.headers['set-cookie'] as string[]).find((c) => c.startsWith('chandelier_sid='))!.split(';')[0]!;
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: sid } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).externalId).toBe(`oid-${user.id}`);
  });

  it('refuse : compte inconnu, compte local homonyme, state falsifié, signature invalide', async () => {
    const localEmail = `${uniq('local')}@test.invalid`;
    await prisma.user.create({ data: { email: localEmail, displayName: 'Local', authProvider: 'LOCAL' } });
    for (const claims of [
      { oid: 'inconnu', email: 'inconnu@test.invalid' },
      { oid: 'x-local', email: localEmail },
    ]) {
      tokenClaims = claims;
      const { state, cookie } = await startLogin();
      const res = await callback(state, cookie);
      expect(res.headers.location).toBe('http://localhost:8080/connexion?erreur=sso');
    }
    const { cookie } = await startLogin();
    expect((await callback('state-falsifie', cookie)).headers.location).toBe(
      'http://localhost:8080/connexion?erreur=sso',
    );

    const email = `${uniq('sso2')}@test.invalid`;
    await prisma.user.create({ data: { email, displayName: 'SSO 2', authProvider: 'OIDC' } });
    tokenClaims = { oid: 'oid-sso2', email };
    signWithOtherKey = true;
    const t = await startLogin();
    expect((await callback(t.state, t.cookie)).headers.location).toBe('http://localhost:8080/connexion?erreur=sso');
    signWithOtherKey = false;
    expect(
      await prisma.auditEvent.count({ where: { action: 'login_failed', justification: { not: null } } }),
    ).toBeGreaterThan(0);
  });
});
