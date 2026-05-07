/**
 * agents.ts - Agent Legion API
 *
 * Routes (mount tai /api/agents):
 *   GET    /                     list 19 agents (slim view: code, name, icon, scope, phase)
 *   GET    /raw                  full registry JSON (DNA prompt + schema + formulas)
 *   GET    /:code                detail 1 agent (full DNA + schema + formulas + tcvn refs)
 *   POST   /:code/run            run 1 agent voi input payload via pipeline agent-runner
 *
 * Registry source: platform/backend/agents/registry.json (19 agent definitions)
 * Run engine:      platform/backend/pipeline/src/agent-runner.ts (mock/real Zeni Cloud L3)
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadExternal } from '../lib/external-loader.js';
import { audit } from '../lib/audit.js';
import { optionalAuth } from '../middleware/auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// /server/src/routes -> /platform/backend
const BACKEND_ROOT = path.resolve(HERE, '..', '..', '..');
const REGISTRY_PATH = path.join(BACKEND_ROOT, 'agents', 'registry.json');

// ============================================================
// Registry loader (cached)
// ============================================================

interface AgentDef {
  code: string;
  name: string;
  icon?: string;
  scope?: string;
  version?: string;
  phase?: string[] | string;
  tcvn_refs?: string[];
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  dna_prompt?: string;
  formulas?: Array<Record<string, unknown>>;
  self_test_examples?: Array<Record<string, unknown>>;
  timeout_seconds?: number;
  tokens_max?: number;
  model_hint?: string;
  tmr_voters?: string[];
}

let _agents: AgentDef[] | null = null;
function getAgents(): AgentDef[] {
  if (_agents) return _agents;
  if (!fs.existsSync(REGISTRY_PATH)) {
    // eslint-disable-next-line no-console
    console.warn('[agents] registry.json not found at', REGISTRY_PATH);
    _agents = [];
    return _agents;
  }
  const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  if (Array.isArray(raw)) _agents = raw as AgentDef[];
  else if (raw && typeof raw === 'object' && Array.isArray(raw.agents))
    _agents = raw.agents as AgentDef[];
  else _agents = [];
  return _agents;
}

export function agentsCount(): number {
  return getAgents().length;
}

// ============================================================
// Pipeline runAgent loader (lazy)
// ============================================================

interface AgentRunnerMod {
  runAgent: (opts: {
    agent_code: string;
    phase: string;
    input: unknown;
    context?: Record<string, unknown>;
    config?: { mode: string };
    variant_seed?: number;
  }) => Promise<unknown>;
}

let _runnerCache: AgentRunnerMod | null = null;
async function getRunner(): Promise<AgentRunnerMod | null> {
  if (_runnerCache) return _runnerCache;
  try {
    _runnerCache = await loadExternal<AgentRunnerMod>('pipeline/src/agent-runner.js');
    return _runnerCache;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[agents] runAgent loader fail:', (e as Error).message);
    return null;
  }
}

// ============================================================
// Schemas
// ============================================================

const RunSchema = z.object({
  input: z.unknown(),
  phase: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  variant_seed: z.number().int().optional(),
});

// ============================================================
// Router
// ============================================================

export function createAgentRouter(): Hono {
  const app = new Hono();
  app.use('*', optionalAuth);

  // ----- GET / list (slim) -----
  app.get('/', (c) => {
    const list = getAgents();
    const slim = list.map((a) => ({
      code: a.code,
      name: a.name,
      icon: a.icon ?? null,
      scope: a.scope ?? '',
      version: a.version ?? '1.0.0',
      phase: a.phase ?? [],
      tcvn_refs: a.tcvn_refs ?? [],
      timeout_seconds: a.timeout_seconds ?? 60,
      model_hint: a.model_hint ?? 'balanced',
    }));
    return c.json({ ok: true, total: slim.length, items: slim });
  });

  // ----- GET /raw full registry -----
  app.get('/raw', (c) => {
    const list = getAgents();
    return c.json({ ok: true, total: list.length, agents: list });
  });

  // ----- GET /:code detail -----
  app.get('/:code', (c) => {
    const code = c.req.param('code');
    const a = getAgents().find((x) => x.code === code);
    if (!a) return c.json({ ok: false, error: 'agent_not_found' }, 404);
    return c.json({ ok: true, agent: a });
  });

  // ----- POST /:code/run -----
  app.post('/:code/run', async (c) => {
    const code = c.req.param('code');
    const a = getAgents().find((x) => x.code === code);
    if (!a) return c.json({ ok: false, error: 'agent_not_found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const parsed = RunSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_input', issues: parsed.error.issues }, 400);
    }

    // Resolve phase: explicit body.phase, else first agent phase, else B1-Brief
    const explicitPhase = parsed.data.phase;
    const agentPhase = Array.isArray(a.phase) ? a.phase[0] : a.phase;
    const phase = explicitPhase ?? mapAgentPhaseToPhaseCode(agentPhase) ?? 'B1-Brief';

    const runner = await getRunner();

    const user = c.get('user') as { id: string } | undefined;
    const startedAt = Date.now();

    if (!runner || code === 'cto') {
      // CTO khong co mock output trong agent-runner — degrade gracefully
      const fallback = {
        agent_code: code,
        phase,
        run_id: `mock_${startedAt}`,
        status: 'succeeded',
        input: parsed.data.input,
        output: {
          notice:
            code === 'cto'
              ? 'CTO orchestrator does not run a single payload — call /api/pipeline/run instead'
              : 'agent runner unavailable — returning echo for development',
          echo: parsed.data.input,
        },
        deliverables: [],
        warnings: runner ? [] : ['agent_runner_module_not_loaded'],
        errors: [],
        started_at: startedAt,
        finished_at: Date.now(),
        duration_ms: Date.now() - startedAt,
      };
      audit({
        action: 'agent.run',
        actor: user?.id ?? 'anonymous',
        target_type: 'agent',
        target_id: code,
        after: { phase, mode: 'fallback' },
      });
      return c.json({ ok: true, result: fallback });
    }

    try {
      const result = await runner.runAgent({
        agent_code: code,
        phase,
        input: parsed.data.input,
        context: parsed.data.context,
        variant_seed: parsed.data.variant_seed,
      });
      audit({
        action: 'agent.run',
        actor: user?.id ?? 'anonymous',
        target_type: 'agent',
        target_id: code,
        after: { phase },
      });
      return c.json({ ok: true, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: 'run_failed', message: msg }, 500);
    }
  });

  return app;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Map registry phase strings (vd "B1-brief", "B2-phongthuy") sang
 * pipeline PhaseCode chinh thuc ("B1-Brief", "B2-Concept", ...).
 */
function mapAgentPhaseToPhaseCode(phase: string | undefined): string | undefined {
  if (!phase) return undefined;
  const p = phase.toLowerCase();
  if (p.startsWith('b0')) return 'B1-Brief';
  if (p.startsWith('b1') || p.includes('brief')) return 'B1-Brief';
  if (p.startsWith('b2') || p.includes('phongthuy') || p.includes('concept'))
    return 'B2-Concept';
  if (p.startsWith('b3') || p.includes('layout')) return 'B3-Layout';
  if (p.startsWith('b4') || p.includes('struct')) return 'B4-Structural';
  if (p.startsWith('b5') || p.includes('mep') || p.includes('bim'))
    return 'B5-MEP+BIM';
  if (p.startsWith('b6') || p.includes('interior') || p.includes('3d') || p.includes('render'))
    return 'B6-Interior+3D';
  if (
    p.startsWith('b7') ||
    p.startsWith('b8') ||
    p.startsWith('b9') ||
    p.startsWith('b10') ||
    p.startsWith('b11') ||
    p.startsWith('b12') ||
    p.includes('qc') ||
    p.includes('boq') ||
    p.includes('legal') ||
    p.includes('handoff') ||
    p.includes('export')
  )
    return 'B7-QC+Export';
  return undefined;
}
