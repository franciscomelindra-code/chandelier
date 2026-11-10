import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Stockage local des pièces justificatives (volume Docker en production).
 * Les clés sont générées (UUID) : aucun nom fourni par l'utilisateur n'entre dans un chemin.
 * Interface volontairement minimale pour un futur stockage S3 / Azure Blob.
 */
export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  head: Uint8Array;
}

export interface StorageProvider {
  save(stream: Readable): Promise<StoredFile>;
  open(storageKey: string): Promise<ReadStream>;
  remove(storageKey: string): Promise<void>;
}

const KEY = /^[0-9a-f]{2}\/[0-9a-f-]{36}$/;

export function localStorage(dir: string): StorageProvider {
  const root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  const pathOf = (key: string) => {
    if (!KEY.test(key)) throw new Error('Clé de stockage invalide');
    return join(root, key);
  };
  return {
    async save(stream) {
      const id = randomUUID();
      const key = `${id.slice(0, 2)}/${id}`;
      await mkdir(join(root, 'tmp'), { recursive: true });
      await mkdir(join(root, id.slice(0, 2)), { recursive: true });
      const tmp = join(root, 'tmp', id);
      const hash = createHash('sha256');
      let size = 0;
      const chunks: Buffer[] = [];
      let headLen = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          size += chunk.length;
          if (headLen < 4096) {
            chunks.push(chunk.subarray(0, 4096 - headLen));
            headLen += Math.min(chunk.length, 4096 - headLen);
          }
          cb(null, chunk);
        },
      });
      try {
        await pipeline(stream, meter, createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
        await rename(tmp, pathOf(key));
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
      return {
        storageKey: key,
        sizeBytes: size,
        sha256: hash.digest('hex'),
        head: new Uint8Array(Buffer.concat(chunks)),
      };
    },
    async open(key) {
      const p = pathOf(key);
      await stat(p);
      return createReadStream(p);
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
