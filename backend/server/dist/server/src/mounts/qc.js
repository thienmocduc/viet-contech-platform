/**
 * mounts/qc.ts — mount /api/qc/* (lazy-load QC sub-app).
 *
 * QC module export createQCApp() return Hono. Server mount sub-app
 * dung pattern Hono.route('/', sub) khi co request dau tien.
 */
import { loadExternal } from '../lib/external-loader.js';
let qcSubApp = null;
async function ensureSub() {
    if (qcSubApp)
        return qcSubApp;
    try {
        const mod = await loadExternal('qc/src/api.js');
        qcSubApp = mod.createQCApp();
        return qcSubApp;
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[qc] load failed:', e.message);
        return null;
    }
}
export function mountQCRoutes(app) {
    // Health phai dang ky TRUOC wildcard de avoid bi sub-app block
    app.get('/api/qc/health', (c) => c.json({ ok: true, service: 'qc', gates: 12 }));
    // Proxy: forward request /api/qc/* sang sub-app
    app.all('/api/qc/*', async (c) => {
        const sub = await ensureSub();
        if (!sub)
            return c.json({ ok: false, error: 'qc_unavailable' }, 503);
        return sub.fetch(c.req.raw);
    });
}
//# sourceMappingURL=qc.js.map