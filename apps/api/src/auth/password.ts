import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// argon2id — paramètres OWASP (m = 19 MiB, t = 2, p = 1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Hash factice pour égaliser le temps de réponse quand le compte n'existe pas. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** Mot de passe aléatoire lisible (base64url, ~143 bits). */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}
