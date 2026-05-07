/**
 * mounts/bim.ts — mount /api/bim/* (lazy-load BIM bridge).
 */
import { loadExternal } from '../lib/external-loader.js';
let cached = null;
async function getMod() {
    if (cached)
        return cached;
    try {
        cached = await loadExternal('bim/node-bridge/api.js');
        return cached;
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[bim] load failed:', e.message);
        return null;
    }
}
export function mountBIMRoutes(app) {
    app.post('/api/bim/generate', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'bim_unavailable' }, 503);
        try {
            const body = await c.req.json();
            return c.json((await mod.handleGenerate(body)));
        }
        catch (e) {
            return c.json({ ok: false, error: e.message }, 500);
        }
    });
    app.post('/api/bim/clash', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'bim_unavailable' }, 503);
        try {
            const body = await c.req.json();
            return c.json((await mod.handleClash(body)));
        }
        catch (e) {
            return c.json({ ok: false, error: e.message }, 500);
        }
    });
    app.post('/api/bim/resolve', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'bim_unavailable' }, 503);
        try {
            const body = await c.req.json();
            return c.json((await mod.handleResolve(body)));
        }
        catch (e) {
            return c.json({ ok: false, error: e.message }, 500);
        }
    });
    app.get('/api/bim/elements', async (c) => {
        const mod = await getMod();
        if (!mod)
            return c.json({ ok: false, error: 'bim_unavailable' }, 503);
        try {
            const project_id = c.req.query('project_id');
            if (!project_id)
                return c.json({ ok: false, error: 'project_id required' }, 400);
            const items = mod.handleListElements({
                project_id,
                revision_id: c.req.query('revision_id'),
                type: c.req.query('type'),
                limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
            });
            return c.json({ ok: true, total: items.length, elements: items });
        }
        catch (e) {
            return c.json({ ok: false, error: e.message }, 500);
        }
    });
    app.get('/api/bim/health', (c) => c.json({ ok: true, service: 'bim-bridge', python: 'lazy' }));
}
//# sourceMappingURL=bim.js.map