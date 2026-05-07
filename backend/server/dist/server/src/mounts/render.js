/**
 * mounts/render.ts — mount /api/render/* (stub goi Zeni Cloud Lop 03 sd-lora-interior).
 *
 * Khi ZENI_L3_API_KEY co cau hinh -> goi API thuc; khong co -> mock response.
 */
import { z } from 'zod';
import { env } from '../env.js';
import { uid, nowIso } from '../lib/uid.js';
import { publishPipelineEvent } from '../lib/event-bus.js';
const STYLES = [
    'luxury',
    'indochine',
    'modern',
    'walnut',
    'neoclassic',
    'japandi',
    'wabisabi',
    'minimalism',
    'mediterranean',
];
const ANGLES = [
    'front',
    'back',
    'left',
    'right',
    'corner_ne',
    'corner_sw',
    'birds_eye',
    'eye_level',
];
const ROOMS = ['living', 'bedroom', 'kitchen', 'bathroom', 'office', 'dining', 'foyer'];
const JobSchema = z.object({
    project_id: z.string().min(1),
    style: z.enum(STYLES),
    room_type: z.enum(ROOMS),
    angle: z.enum(ANGLES),
    quality: z.enum(['preview', 'production']).default('preview'),
});
const jobs = new Map();
export function mountRenderRoutes(app) {
    app.post('/api/render/job', async (c) => {
        const body = await c.req.json().catch(() => null);
        const parsed = JobSchema.safeParse(body);
        if (!parsed.success) {
            return c.json({ ok: false, error: 'invalid_input', issues: parsed.error.issues }, 400);
        }
        const id = uid('rj');
        const job = {
            id,
            project_id: parsed.data.project_id,
            style: parsed.data.style,
            room_type: parsed.data.room_type,
            angle: parsed.data.angle,
            quality: parsed.data.quality,
            status: env.ZENI_L3_API_KEY ? 'queued' : 'running',
            url: null,
            created_at: nowIso(),
            finished_at: null,
        };
        jobs.set(id, job);
        publishPipelineEvent({
            type: 'render.queued',
            project_id: job.project_id,
            message: `Render ${job.style}/${job.room_type}/${job.angle} queued`,
            payload: { job_id: id },
        });
        setTimeout(() => {
            const j = jobs.get(id);
            if (!j)
                return;
            j.status = 'done';
            j.url = `${env.PUBLIC_BASE_URL}/static/renders/${id}.png`;
            j.finished_at = nowIso();
            publishPipelineEvent({
                type: 'render.done',
                project_id: j.project_id,
                message: `Render ${id} done`,
                payload: { job_id: id, url: j.url },
            });
        }, 200);
        return c.json({ ok: true, job });
    });
    app.get('/api/render/job/:id', (c) => {
        const j = jobs.get(c.req.param('id'));
        if (!j)
            return c.json({ ok: false, error: 'not_found' }, 404);
        return c.json({ ok: true, job: j });
    });
    app.get('/api/render/health', (c) => c.json({
        ok: true,
        service: 'render-orchestrator',
        provider: env.ZENI_L3_API_KEY ? 'zeni-l3' : 'mock',
        styles: STYLES.length,
        angles: ANGLES.length,
    }));
}
//# sourceMappingURL=render.js.map