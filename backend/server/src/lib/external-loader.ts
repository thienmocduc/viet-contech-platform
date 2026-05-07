/**
 * external-loader.ts — runtime ESM loader cho cac module Wave-1 ngoai tsconfig.
 *
 * Su dung dynamic import() voi path tuyet doi (resolve tu server root).
 * tsc khong follow source -> server typecheck 0 lo, runtime van work.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// /server/src/lib -> /platform/backend
const BACKEND_ROOT = path.resolve(HERE, '..', '..', '..');

export function externalUrl(rel: string): string {
  const abs = path.resolve(BACKEND_ROOT, rel);
  return pathToFileURL(abs).href;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadExternal<T = any>(rel: string): Promise<T> {
  return (await import(externalUrl(rel))) as T;
}
