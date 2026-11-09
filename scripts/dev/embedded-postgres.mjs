// PostgreSQL embarqué pour le développement local SANS Docker (ex. poste Windows).
// Binaires officiels PostgreSQL distribués via npm (paquet embedded-postgres).
// Jamais utilisé en production. Données dans .local/pgdata (ignoré par Git).
//
// Variables : EMBEDDED_PG_PORT (défaut 54329), EMBEDDED_PG_PASSWORD (obligatoire).
// Crée les bases "chandelier" et "chandelier_test".
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
const password = process.env.EMBEDDED_PG_PASSWORD;
if (!password || password.length < 16) {
  console.error('EMBEDDED_PG_PASSWORD doit être défini (16 caractères minimum) dans .env');
  process.exit(1);
}

const databaseDir = resolve(process.cwd(), '.local/pgdata');
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'chandelier',
  password,
  port,
  persistent: true,
  // UTF-8 obligatoire (sinon Windows initialise en WIN1252).
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--auth=scram-sha-256'],
  onLog: () => {},
});

const fresh = !existsSync(resolve(databaseDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();
for (const db of ['chandelier', 'chandelier_test']) {
  try {
    await pg.createDatabase(db);
    console.log(`Base créée : ${db}`);
  } catch {
    // existe déjà
  }
}
console.log(`PostgreSQL embarqué prêt sur 127.0.0.1:${port} (Ctrl+C pour arrêter)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
