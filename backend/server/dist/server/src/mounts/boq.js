/**
 * mounts/boq.ts — mount /api/boq/* (lazy-load BOQ bridge).
 */
import { loadExternal } from '../lib/external-loader.js';
let cached = null;
async function getMod() {
    if (cached)
        return cached;
    try {
        cached = await loadExternal('boq/node-bridge/api.js');
        return cached;
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[boq] load failed:', e.message);
        return null;
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function code(s) {
    return s;
}
export function mountBOQRoutes(app) {
    app.post('/api/boq/extract', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'boq_unavailable' }, 503);
        const body = await c.req.json().catch(() => ({}));
        const r = await mod.extractHandler(body);
        return c.json(r.body, code(r.status));
    });
    app.post('/api/boq/generate', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'boq_unavailable' }, 503);
        const body = await c.req.json().catch(() => ({}));
        const r = await mod.generateHandler(body);
        return c.json(r.body, code(r.status));
    });
    app.post('/api/boq/export', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'boq_unavailable' }, 503);
        const body = await c.req.json().catch(() => ({}));
        const r = await mod.exportHandler(body);
        return c.json(r.body, code(r.status));
    });
    app.get('/api/boq/health', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'boq_unavailable' }, 503);
        const r = mod.healthHandler();
        return c.json(r.body, code(r.status));
    });
}
//# sourceMappingURL=boq.js.map