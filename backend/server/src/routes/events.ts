/**
 * events.ts — Server-Sent Events stream cho live progress.
 *
 * GET /api/events/stream/:projectId
 *   Yeu cau auth (cookie hoac Authorization).
 *   Phuc vu text/event-stream voi events tu lib/event-bus.
 *   Heartbeat moi 15s (": ping").
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { requireAuth } from '../middleware/auth.js';
import { bus } from '../lib/event-bus.js';
import { queryOne } from '../lib/db.js';

interface ProjectRow {
  id: string;
  owner_user_id: string;
}

export function createEventRouter(): Hono {
  const app = new Hono();
  app.use('*', requireAuth);

  app.get('/stream/:projectId', (c) => {
    const projectId = c.req.param('projectId');
    const user = c.get('user') as { id: string };
    const p = queryOne<ProjectRow>(
      'SELECT id, owner_user_id FROM projects WHERE id=?',
      [projectId],
    );
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);
    if (p.owner_user_id !== user.id) return c.json({ ok: false, error: 'forbidden' }, 403);

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    return stream(c, async (writer) => {
      const send = async (ev: { type: string; payload?: unknown }, raw?: unknown) => {
        await writer.write(`event: ${ev.type}\n`);
        await writer.write(`data: ${JSON.stringify(raw ?? ev)}\n\n`);
      };
      // Hello
      await writer.write(`: connected ${new Date().toISOString()}\n\n`);

      const unsub = bus.subscribe({ project_id: projectId }, (ev) => {
        // fire and forget — sse has its own buffer
        void send({ type: ev.type, payload: ev.payload }, ev);
      });

      // Heartbeat
      const hb = setInterval(() => {
        void writer.write(`: ping ${Date.now()}\n\n`);
      }, 15000);

      // Wait until client closes
      writer.onAbort(() => {
        unsub();
        clearInterval(hb);
      });

      // Keep stream open by waiting on a never-resolving promise that respects abort
      await new Promise<void>((resolve) => {
        writer.onAbort(() => resolve());
      });
    });
  });

  return app;
}
