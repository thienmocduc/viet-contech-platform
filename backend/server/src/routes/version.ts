/**
 * version.ts - Build / version metadata
 *
 *   GET /api/version
 *     {
 *       ok: true,
 *       service: 'vct-design-platform',
 *       version: '1.0.0',
 *       git_commit: '<hash>' | null,
 *       git_branch: '<branch>' | null,
 *       build_time: '<ISO>',
 *       node: 'vXX',
 *     }
 *
 * git info is optional; if `git` is not on PATH or this is a docker build with no .git,
 * fields fall back to env GIT_COMMIT / GIT_BRANCH / null.
 */

import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');

const VERSION = '1.0.0';
const BUILD_TIME = new Date().toISOString();

function safeGit(args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    });
    return out.toString('utf8').trim() || null;
  } catch {
    return null;
  }
}

const GIT_COMMIT = process.env.GIT_COMMIT ?? safeGit(['rev-parse', 'HEAD']);
const GIT_BRANCH =
  process.env.GIT_BRANCH ?? safeGit(['rev-parse', '--abbrev-ref', 'HEAD']);
const GIT_SHORT = GIT_COMMIT?.slice(0, 12) ?? null;

export function createVersionRouter(): Hono {
  const app = new Hono();
  app.get('/', (c) =>
    c.json({
      ok: true,
      service: 'vct-design-platform',
      version: VERSION,
      git_commit: GIT_COMMIT,
      git_short: GIT_SHORT,
      git_branch: GIT_BRANCH,
      build_time: BUILD_TIME,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    }),
  );
  return app;
}
