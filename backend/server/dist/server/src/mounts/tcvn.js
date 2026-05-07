/**
 * mounts/tcvn.ts — mount /api/tcvn/*.
 * Lazy-load tcvn engine khi co request dau tien (avoid tsc follow source).
 */
import { z } from 'zod';
import { loadExternal } from '../lib/external-loader.js';
let cachedEngine = null;
let cachedRules = null;
async function getEngine() {
    if (cachedEngine)
        return cachedEngine;
    const mod = await loadExternal('tcvn/src/engine.js');
    cachedEngine = mod;
    return mod;
}
async function rules() {
    if (cachedRules)
        return cachedRules;
    try {
        const eng = await getEngine();
        cachedRules = eng.loadRules();
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[tcvn] loadRules failed:', e.message);
        cachedRules = [];
    }
    return cachedRules;
}
const ValidateSchema = z.object({
    design: z.record(z.unknown()),
});
export function mountTCVNRoutes(app) {
    app.get('/api/tcvn/rules', async (c) => {
        const list = (await rules());
        const byCategory = {};
        for (const r of list)
            byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
        return c.json({
            ok: true,
            total: list.length,
            by_category: byCategory,
            sample: list.slice(0, 20).map((r) => ({
                code: r.code,
                category: r.category,
                standard: r.standard,
                severity: r.severity,
                statement_vi: r.statement_vi,
            })),
        });
    });
    app.get('/api/tcvn/rules/:code', async (c) => {
        const code = c.req.param('code');
        const list = (await rules());
        const r = list.find((x) => x.code === code);
        if (!r)
            return c.json({ ok: false, error: 'rule_not_found' }, 404);
        return c.json({ ok: true, rule: r });
    });
    app.post('/api/tcvn/validate', async (c) => {
        const body = await c.req.json().catch(() => null);
        const parsed = ValidateSchema.safeParse(body);
        if (!parsed.success)
            return c.json({ ok: false, error: 'invalid_input' }, 400);
        const eng = await getEngine();
        const out = eng.validateDesign(parsed.data.design, await rules());
        return c.json({ ok: true, report: eng.summarize(out) });
    });
}
//# sourceMappingURL=tcvn.js.map