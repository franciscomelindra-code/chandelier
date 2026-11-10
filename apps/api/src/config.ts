import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Configuration validée au démarrage. Toute valeur invalide arrête le processus
 * avec un message explicite (jamais de valeur sensible dans le message).
 *
 * Les secrets peuvent venir de variables d'environnement ou de fichiers
 * (<NOM>_FILE ou SECRETS_DIR/<fichier>) générés par le service compose "secrets-init".
 */
const booleanFromString = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  APP_URL: z.url().default('http://localhost:8080'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Hors conteneur, écoute locale uniquement ; l'image Docker fixe HOST=0.0.0.0 (réseau interne).
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY: booleanFromString,
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),
  SESSION_SECRET: z.string().min(64, 'SESSION_SECRET doit contenir au moins 64 caractères (openssl rand -hex 32)'),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(10),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  AUTH_MODE: z.enum(['local', 'oidc']).default('local'),
  /// OIDC (Microsoft Entra ID) : émetteur déduit de ENTRA_TENANT_ID, ou OIDC_ISSUER explicite.
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  ENTRA_REDIRECT_URI: z.string().optional(),
  OIDC_ISSUER: z.string().optional(),
  /// Connexion locale encore possible en mode OIDC (compte de secours) : désactivée par défaut.
  AUTH_LOCAL_FALLBACK: booleanFromString,
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  SEED_DEMO: booleanFromString,
  SECRETS_DIR: z.string().optional(),
  LLM_PROVIDER: z.enum(['disabled', 'anthropic']).default('disabled'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
  REMOTE_ACCESS_MODE: z.enum(['disabled', 'lan', 'tailscale', 'cloudflare']).default('disabled'),
  /// Répertoire des pièces justificatives (volume Docker /data/documents ; .local/storage en développement).
  STORAGE_DIR: z.string().min(1).default('.local/storage'),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(200).default(25),
});

export type AppConfig = z.infer<typeof schema> & {
  cookieSecure: boolean;
  oidc: { issuer: string; clientId: string; clientSecret: string; redirectUri: string } | null;
};

function readSecretFile(path: string | undefined): string | undefined {
  if (!path || !existsSync(path)) return undefined;
  const v = readFileSync(path, 'utf8').trim();
  return v.length > 0 ? v : undefined;
}

/** Résout VAR, puis VAR_FILE, puis SECRETS_DIR/<file>. */
function resolveSecret(env: NodeJS.ProcessEnv, name: string, file: string): string | undefined {
  const direct = env[name]?.trim();
  if (direct) return direct;
  const fromFile = readSecretFile(env[`${name}_FILE`]);
  if (fromFile) return fromFile;
  return env.SECRETS_DIR ? readSecretFile(`${env.SECRETS_DIR}/${file}`) : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const resolved: Record<string, string | undefined> = { ...env };
  resolved.SESSION_SECRET = resolveSecret(env, 'SESSION_SECRET', 'session_secret');
  resolved.ANTHROPIC_API_KEY = resolveSecret(env, 'ANTHROPIC_API_KEY', 'anthropic_api_key');
  resolved.ENTRA_CLIENT_SECRET = resolveSecret(env, 'ENTRA_CLIENT_SECRET', 'entra_client_secret');
  for (const k of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_REDIRECT_URI', 'OIDC_ISSUER'] as const)
    if (!env[k]?.trim()) delete resolved[k];
  if (!env.ANTHROPIC_MODEL?.trim()) delete resolved.ANTHROPIC_MODEL;

  if (!env.DATABASE_URL?.trim()) {
    const password = resolveSecret(env, 'POSTGRES_PASSWORD', 'postgres_password');
    const host = env.POSTGRES_HOST ?? 'postgres';
    if (password && env.POSTGRES_USER && env.POSTGRES_DB) {
      resolved.DATABASE_URL = `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(
        password,
      )}@${host}:${env.POSTGRES_PORT ?? '5432'}/${encodeURIComponent(env.POSTGRES_DB)}`;
    }
  }

  const parsed = schema.safeParse(resolved);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  const cfg = parsed.data;

  let oidc: { issuer: string; clientId: string; clientSecret: string; redirectUri: string } | null = null;
  if (cfg.AUTH_MODE === 'oidc') {
    const issuer =
      cfg.OIDC_ISSUER ??
      (cfg.ENTRA_TENANT_ID ? `https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/v2.0` : undefined);
    if (!issuer || (!/^https:\/\//.test(issuer) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(issuer)))
      throw new Error('AUTH_MODE=oidc : ENTRA_TENANT_ID (ou OIDC_ISSUER en https) est requis.');
    if (!cfg.ENTRA_CLIENT_ID || !cfg.ENTRA_CLIENT_SECRET)
      throw new Error(
        'AUTH_MODE=oidc : ENTRA_CLIENT_ID et ENTRA_CLIENT_SECRET (ou ENTRA_CLIENT_SECRET_FILE / SECRETS_DIR/entra_client_secret) sont requis.',
      );
    oidc = {
      issuer: issuer.replace(/\/+$/, ''),
      clientId: cfg.ENTRA_CLIENT_ID,
      clientSecret: cfg.ENTRA_CLIENT_SECRET,
      redirectUri: cfg.ENTRA_REDIRECT_URI ?? `/api/v1/auth/oidc/callback`,
    };
  }
  if (cfg.LLM_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) {
    throw new Error(
      'LLM_PROVIDER=anthropic : ANTHROPIC_API_KEY (ou ANTHROPIC_API_KEY_FILE, ou SECRETS_DIR/anthropic_api_key) est requise.',
    );
  }

  const cookieSecure = cfg.COOKIE_SECURE === 'auto' ? cfg.APP_URL.startsWith('https://') : cfg.COOKIE_SECURE === 'true';

  return { ...cfg, cookieSecure, oidc };
}
