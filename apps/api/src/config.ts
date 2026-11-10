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
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  SEED_DEMO: booleanFromString,
  SECRETS_DIR: z.string().optional(),
  LLM_PROVIDER: z.enum(['disabled', 'anthropic']).default('disabled'),
  REMOTE_ACCESS_MODE: z.enum(['disabled', 'lan', 'tailscale', 'cloudflare']).default('disabled'),
  /// Répertoire des pièces justificatives (volume Docker /data/documents ; .local/storage en développement).
  STORAGE_DIR: z.string().min(1).default('.local/storage'),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(200).default(25),
});

export type AppConfig = z.infer<typeof schema> & { cookieSecure: boolean };

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

  if (cfg.AUTH_MODE === 'oidc') {
    throw new Error(
      'AUTH_MODE=oidc : authentification Microsoft Entra ID non implémentée à ce stade. Utiliser AUTH_MODE=local.',
    );
  }
  if (cfg.LLM_PROVIDER !== 'disabled') {
    throw new Error('LLM_PROVIDER : assistant IA non implémenté à ce stade. Utiliser LLM_PROVIDER=disabled.');
  }

  const cookieSecure = cfg.COOKIE_SECURE === 'auto' ? cfg.APP_URL.startsWith('https://') : cfg.COOKIE_SECURE === 'true';

  return { ...cfg, cookieSecure };
}
