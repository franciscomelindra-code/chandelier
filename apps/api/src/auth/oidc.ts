import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfig } from '../config.js';
import { safeEqual } from './session.js';

/**
 * OpenID Connect (Microsoft Entra ID) — flux « authorization code » avec PKCE, state et nonce.
 * L'émetteur provient de la configuration (jamais d'une entrée utilisateur : pas de SSRF).
 */
interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const b64url = (b: Buffer) => b.toString('base64url');

export function oidcClient(cfg: NonNullable<AppConfig['oidc']>, sessionSecret: string) {
  let discovery: Promise<Discovery> | null = null;
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  const discover = () => {
    discovery ??= fetch(`${cfg.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Découverte OIDC : HTTP ${r.status}`);
        const d = (await r.json()) as Discovery;
        if (d.issuer.replace(/\/+$/, '') !== cfg.issuer) throw new Error('Découverte OIDC : émetteur inattendu');
        return d;
      })
      .catch((e: unknown) => {
        discovery = null; // nouvel essai au prochain appel
        throw e;
      });
    return discovery;
  };

  /** Cookie de transaction signé (HMAC) : state, nonce, verifier PKCE, expiration 10 min. */
  const sign = (payload: string) => createHmac('sha256', sessionSecret).update(`oidc:${payload}`).digest('base64url');

  return {
    async authorizationUrl() {
      const d = await discover();
      const state = b64url(randomBytes(24));
      const nonce = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(48));
      const challenge = b64url(createHash('sha256').update(verifier).digest());
      const payload = b64url(Buffer.from(JSON.stringify({ state, nonce, verifier, exp: Date.now() + 10 * 60_000 })));
      const url = new URL(d.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: 'code',
        redirect_uri: cfg.redirectUri,
        response_mode: 'query',
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      return { url: url.toString(), cookie: `${payload}.${sign(payload)}` };
    },

    readTransaction(cookie: string | undefined, state: string) {
      if (!cookie) return null;
      const [payload, mac] = cookie.split('.');
      if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
      const t = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        state: string;
        nonce: string;
        verifier: string;
        exp: number;
      };
      if (t.exp < Date.now() || !safeEqual(t.state, state)) return null;
      return t;
    },

    /** Échange du code et vérification du jeton d'identité (signature, émetteur, audience, nonce, expiration). */
    async exchange(code: string, verifier: string, nonce: string): Promise<JWTPayload> {
      const d = await discover();
      const res = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: cfg.redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Échange du code OIDC refusé (HTTP ${res.status})`);
      const body = (await res.json()) as { id_token?: string };
      if (!body.id_token) throw new Error('Réponse OIDC sans id_token');
      jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
      const { payload } = await jwtVerify(body.id_token, jwks, {
        issuer: d.issuer,
        audience: cfg.clientId,
        clockTolerance: 60,
      });
      if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, nonce)) throw new Error('Nonce OIDC invalide');
      return payload;
    },
  };
}
