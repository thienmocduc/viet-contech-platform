/**
 * test-server.ts — E2E test cho server.
 *
 * Boot server tren PORT random (env PORT=0 -> tu chon).
 * Kiem tra:
 *   1. /healthz pass
 *   2. /api/info pass + show modules
 *   3. /api/auth flow: register/start (dev mode -> otpDevPreview) -> register/verify -> /me OK
 *   4. /api/projects POST -> GET list -> GET detail -> start-pipeline -> revisions -> archive
 *   5. /api/deliverables/:projectId/manifest -> 200
 *   6. /api/dashboard/overview -> 200
 *   7. SSE /api/events/stream/:id nhan it nhat 1 event
 *   8. /api/tcvn/rules -> 200 (it nhat 1 rule, hoac empty neu engine khong load)
 *   9. /api/qc/health -> 200
 *  10. /api/mep/health, /api/boq/health, /api/bim/health, /api/render/health, /api/pipeline/health, /api/export/health all 200/503
 *
 * Exit code 0 = all pass; non-zero = fail.
 */

import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../src/server.js';
import { serve } from '@hono/node-server';

interface Result {
  name: string;
  ok: boolean;
  detail?: string;
  ms?: number;
}

const results: Result[] = [];

let baseUrl = '';
let cookieJar = '';

async function request(
  method: string,
  path: string,
  body?: unknown,
  opts: { headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any; text: string; setCookie: string | null }> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieJar ? { Cookie: cookieJar } : {}),
      ...(opts.headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    // capture vct_session cookie
    const m = setCookie.match(/vct_session=[^;]+/);
    if (m) cookieJar = m[0];
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, setCookie };
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now();
  try {
    const out = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    return out;
  } catch (e) {
    results.push({
      name,
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0,
    });
    return undefined;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  // Boot server tren port 0
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.SMTP_HOST = ''; // ensure dev OTP mode

  const app = buildApp();
  let actualPort = 0;
  const httpServer = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve) => {
    const ready = () => {
      const addr = (httpServer as unknown as http.Server).address();
      if (typeof addr === 'object' && addr) {
        actualPort = addr.port;
        resolve();
      } else {
        setTimeout(ready, 50);
      }
    };
    ready();
  });
  baseUrl = `http://localhost:${actualPort}`;
  // eslint-disable-next-line no-console
  console.log(`[test] server booted on ${baseUrl}`);

  await delay(50); // ensure ready

  // 1. healthz
  await step('healthz', async () => {
    const r = await request('GET', '/healthz');
    assert(r.status === 200 && r.json?.ok === true, `healthz status=${r.status}`);
  });

  // 2. /api/info
  await step('api info', async () => {
    const r = await request('GET', '/api/info');
    assert(r.status === 200 && Array.isArray(r.json?.modules), 'info missing modules');
  });

  // 3. auth register
  const email = `tester+${Date.now()}@gmail.com`;
  let sessionId = '';
  let otp = '';
  await step('register/start', async () => {
    const r = await request('POST', '/api/auth/register/start', {
      name: 'Tester',
      year: 1990,
      email,
      phone: '0901234567',
      role: 'client',
    });
    assert(r.status === 200, `register start = ${r.status} ${r.text}`);
    assert(typeof r.json.sessionId === 'string', 'no sessionId');
    assert(typeof r.json.otpDevPreview === 'string', 'no dev OTP returned (smtp must be empty)');
    sessionId = r.json.sessionId;
    otp = r.json.otpDevPreview;
  });

  await step('register/verify', async () => {
    const r = await request('POST', '/api/auth/register/verify', { sessionId, otp });
    assert(r.status === 200 && r.json?.user?.email === email, `verify=${r.status} ${r.text}`);
    assert(!!cookieJar, 'no auth cookie');
  });

  await step('GET /me', async () => {
    const r = await request('GET', '/api/auth/me');
    assert(r.status === 200 && r.json?.user?.email === email, `me=${r.status}`);
  });

  // 4. project lifecycle
  let projectId = '';
  await step('POST /projects', async () => {
    const r = await request('POST', '/api/projects', {
      name: 'Biet thu Saigon',
      lot: { width_m: 8, depth_m: 16, direction: 'south', address: 'Quan 7' },
      client: { full_name: 'Anh Tu', year_born: 1985, gender: 'male', family_size: 4 },
      requirements: [{ type: 'lifestyle', key: 'pet', value: 'dog' }],
    });
    assert(r.status === 200 && r.json?.project?.id, `create=${r.status} ${r.text}`);
    projectId = r.json.project.id;
  });

  await step('GET /projects', async () => {
    const r = await request('GET', '/api/projects');
    assert(r.status === 200 && Array.isArray(r.json?.items) && r.json.items.length >= 1, `list=${r.status}`);
  });

  await step('GET /projects/:id', async () => {
    const r = await request('GET', `/api/projects/${projectId}`);
    assert(r.status === 200 && r.json?.project?.id === projectId, `detail=${r.status}`);
  });

  await step('PATCH /projects/:id', async () => {
    const r = await request('PATCH', `/api/projects/${projectId}`, { name: 'Biet thu Saigon v2' });
    assert(r.status === 200 && r.json?.project?.name === 'Biet thu Saigon v2', `patch=${r.status}`);
  });

  await step('start-pipeline', async () => {
    const r = await request('POST', `/api/projects/${projectId}/start-pipeline`);
    assert(r.status === 200 && typeof r.json?.revision_id === 'string', `start=${r.status} ${r.text}`);
  });

  await step('GET /pipeline state', async () => {
    const r = await request('GET', `/api/projects/${projectId}/pipeline`);
    assert(r.status === 200 && r.json?.status === 'running', `pipeline=${r.status} ${r.text}`);
  });

  await step('GET /revisions', async () => {
    const r = await request('GET', `/api/projects/${projectId}/revisions`);
    assert(r.status === 200 && Array.isArray(r.json?.items) && r.json.items.length >= 2, `revisions=${r.status}`);
  });

  // 5. deliverables
  await step('GET /deliverables/manifest', async () => {
    const r = await request('GET', `/api/deliverables/${projectId}/manifest`);
    assert(r.status === 200 && r.json?.ok === true, `manifest=${r.status}`);
  });

  // 6. dashboard
  await step('GET /dashboard/overview', async () => {
    const r = await request('GET', '/api/dashboard/overview');
    assert(r.status === 200 && r.json?.ok === true, `overview=${r.status}`);
  });

  await step('GET /dashboard/agent-stats', async () => {
    const r = await request('GET', '/api/dashboard/agent-stats');
    assert(r.status === 200, `agent-stats=${r.status}`);
  });

  await step('GET /dashboard/recent-activity', async () => {
    const r = await request('GET', '/api/dashboard/recent-activity');
    assert(r.status === 200 && Array.isArray(r.json?.items), `activity=${r.status}`);
  });

  // 7. SSE
  await step('SSE event stream', async () => {
    const ctrl = new AbortController();
    let received = 0;
    const reqProm = fetch(`${baseUrl}/api/events/stream/${projectId}`, {
      headers: { Accept: 'text/event-stream', Cookie: cookieJar },
      signal: ctrl.signal,
    });
    const res = await reqProm;
    assert(res.status === 200, `sse status=${res.status}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // Trigger an event
    setTimeout(() => {
      void request('POST', `/api/projects/${projectId}/start-pipeline`).catch(() => null);
    }, 50);
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      if (chunk.includes('data:')) {
        received++;
        if (received >= 1) break;
      }
    }
    ctrl.abort();
    assert(received >= 1, 'SSE no data received');
  });

  // 8. TCVN
  await step('GET /api/tcvn/rules', async () => {
    const r = await request('GET', '/api/tcvn/rules');
    assert(r.status === 200 && r.json?.ok === true, `tcvn=${r.status}`);
  });

  // 9-10. healths cua module ngoai (cho phep 503 neu khong load)
  for (const path of [
    '/api/qc/health',
    '/api/boq/health',
    '/api/bim/health',
    '/api/mep/health',
    '/api/render/health',
    '/api/pipeline/health',
    '/api/export/health',
  ]) {
    await step(`GET ${path}`, async () => {
      const r = await request('GET', path);
      assert([200, 503].includes(r.status), `${path}=${r.status}`);
    });
  }

  // Restore revision
  await step('POST /revisions/:id/restore', async () => {
    const list = await request('GET', `/api/projects/${projectId}/revisions`);
    const target = list.json.items[0];
    const r = await request(
      'POST',
      `/api/projects/${projectId}/revisions/${target.id}/restore`,
    );
    assert(r.status === 200, `restore=${r.status} ${r.text}`);
  });

  // Soft delete
  await step('DELETE /projects/:id', async () => {
    const r = await request('DELETE', `/api/projects/${projectId}`);
    assert(r.status === 200 && r.json?.archived === true, `delete=${r.status}`);
  });

  // Logout
  await step('POST /auth/logout', async () => {
    const r = await request('POST', '/api/auth/logout');
    assert(r.status === 200, `logout=${r.status}`);
  });

  // Print summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log('\n=== E2E SUMMARY ===');
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`  ${r.ok ? 'OK ' : 'FAIL'}  ${r.name}${r.ms != null ? ` (${r.ms}ms)` : ''}${r.detail ? '   -> ' + r.detail : ''}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n=> ${passed}/${results.length} passed, ${failed.length} failed`);

  // shutdown
  (httpServer as unknown as http.Server).close();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[test] fatal', e);
  process.exit(2);
});
