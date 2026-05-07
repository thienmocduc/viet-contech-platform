/**
 * mounts/mep.ts — mount /api/mep/* (lazy-load MEP routing).
 */
import { loadExternal } from '../lib/external-loader.js';
let cached = null;
async function getMod() {
    if (cached)
        return cached;
    try {
        cached = await loadExternal('mep/src/api.js');
        return cached;
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[mep] load failed:', e.message);
        return null;
    }
}
function pickLayout(body) {
    if (!body || typeof body !== 'object')
        return null;
    const b = body;
    if (b.layout_json && typeof b.layout_json === 'object')
        return b.layout_json;
    if (Array.isArray(b.rooms))
        return b;
    return null;
}
export function mountMEPRoutes(app) {
    app.post('/api/mep/electric', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'mep_unavailable' }, 503);
        const body = await c.req.json().catch(() => null);
        const layout = pickLayout(body);
        if (!layout)
            return c.json({ ok: false, error: 'layout_json required' }, 400);
        return c.json({ ok: true, result: mod.mepHandlers.electric(layout) });
    });
    app.post('/api/mep/plumbing', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'mep_unavailable' }, 503);
        const body = await c.req.json().catch(() => null);
        const layout = pickLayout(body);
        if (!layout)
            return c.json({ ok: false, error: 'layout_json required' }, 400);
        return c.json({ ok: true, result: mod.mepHandlers.plumbing(layout) });
    });
    app.post('/api/mep/camera', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'mep_unavailable' }, 503);
        const body = (await c.req.json().catch(() => null));
        const layout = pickLayout(body);
        if (!layout)
            return c.json({ ok: false, error: 'layout_json required' }, 400);
        const opts = {};
        if (typeof body?.fov === 'number')
            opts.fov_degrees = body.fov;
        if (typeof body?.range === 'number')
            opts.max_range_mm = body.range;
        return c.json({ ok: true, result: mod.mepHandlers.camera(layout, opts) });
    });
    app.post('/api/mep/all', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'mep_unavailable' }, 503);
        const body = await c.req.json().catch(() => null);
        const layout = pickLayout(body);
        if (!layout)
            return c.json({ ok: false, error: 'layout_json required' }, 400);
        return c.json({ ok: true, result: mod.mepHandlers.all(layout) });
    });
    app.get('/api/mep/health', (c) => c.json({ ok: true, service: 'mep-routing', algos: ['dijkstra', 'hunter', 'set-cover'] }));
}
//# sourceMappingURL=mep.js.map