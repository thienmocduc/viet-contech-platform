# Viet-Contech Design Platform — Master API Server

Hono entry-point hop nhat 8 module Wave-1 thanh 1 service:

| Module          | Mount path        | Source                                 |
|-----------------|-------------------|----------------------------------------|
| Auth (Email-OTP)| `/api/auth`       | `server/src/routes/auth.ts`            |
| Agents (19)     | `/api/agents`     | `server/src/routes/agents.ts`          |
| Projects        | `/api/projects`   | `server/src/routes/projects.ts`        |
| Pipeline        | `/api/pipeline`   | `pipeline/src/orchestrator.ts`         |
| TCVN Engine     | `/api/tcvn`       | `tcvn/src/engine.ts`                   |
| BOQ             | `/api/boq`        | `boq/node-bridge/api.ts`               |
| BIM             | `/api/bim`        | `bim/node-bridge/api.ts`               |
| MEP routing     | `/api/mep`        | `mep/src/api.ts`                       |
| QC (12 gates)   | `/api/qc`         | `qc/src/api.ts`                        |
| Render          | `/api/render`     | mock + Zeni L3 sd-lora                 |
| Packager/Export | `/api/export`     | `packager/src/api.ts`                  |
| Deliverables    | `/api/deliverables` | `server/src/routes/deliverables.ts`  |
| Dashboard KPI   | `/api/dashboard`  | `server/src/routes/dashboard.ts`       |
| SSE events      | `/api/events/stream/:projectId` | `server/src/routes/events.ts` |

Module ngoai duoc nap qua **dynamic import** (xem `lib/external-loader.ts`)
nen `tsc` server typecheck doc lap khong yeu cau cross-package paths.

## Setup nhanh (local dev)

```bash
cd platform/backend/server
npm install            # tsc, hono, better-sqlite3, jose, nodemailer
cp .env.example .env   # sua JWT_SECRET, SMTP_*, ZENI_L3_API_KEY
npm run dev            # tsx watch src/server.ts
```

Khi boot thanh cong se thay log:

```
[DB] OK 18 tables, 19 agents seed, ... | migrations=4 | file=...
[Server] :8787 listening | DB ready 18 tables | Agents 19 | Pipeline ready (mode=mock)
```

## Endpoints chinh

```bash
# Health (200 khi DB+agents+pipeline san sang, 503 neu thieu)
curl http://localhost:8787/healthz | jq

# Agent registry
curl http://localhost:8787/api/agents | jq '.total'   # -> 19
curl http://localhost:8787/api/agents/brief_analyst | jq '.agent.name'

# Run 1 agent (mock provider)
curl -X POST http://localhost:8787/api/agents/brief_analyst/run \
  -H "Content-Type: application/json" \
  -d '{"input": {"project_id":"VCT-DEMO","brief":{"type":"biet-thu","floors":3}}}'

# Version
curl http://localhost:8787/api/version | jq

# Auth: dang ky email-OTP (dev mode tra otpDevPreview)
curl -X POST http://localhost:8787/api/auth/register/start \
  -H "Content-Type: application/json" \
  -d '{"name":"Tester","year":1990,"email":"tester@gmail.com","phone":"0901234567"}'

# Pipeline run by project_id (background job + SSE)
curl -X POST http://localhost:8787/api/pipeline/run/<projectId> \
  -H "Cookie: vct_session=<jwt>" -d '{"brief":{}}'
# -> { ok: true, job_id: "pipe_..." }

# Realtime SSE (job-scoped)
curl -N http://localhost:8787/api/pipeline/stream/<job_id>
```

## Scripts

```bash
npm run dev         # tsx watch src/server.ts (hot reload)
npm run typecheck   # tsc --noEmit (strict, 0 lo)
npm run build       # tsc -p tsconfig.json -> dist/
npm start           # node dist/server.js (production)
npm test            # tsx tests/test-server.ts (E2E smoke)
```

## Bien moi truong (`.env.example`)

| Bien                | Y nghia                                                     |
|---------------------|-------------------------------------------------------------|
| `PORT`              | HTTP port (default 8787)                                    |
| `NODE_ENV`          | `development` / `production` / `test`                       |
| `CORS_ORIGINS`      | csv whitelist, vd `http://localhost:5173,https://app...`    |
| `JWT_SECRET`        | secret HS256 (>= 16 ky tu, doi cho prod)                    |
| `VCT_DB_PATH`       | sqlite file path (relative tu `platform/backend/`)          |
| `SMTP_*`            | Gmail App Password — neu vang -> dev OTP in console         |
| `ZENI_L3_API_KEY`   | Zeni Cloud Lop 03 (sd-lora interior render)                 |
| `PROVIDER_MODE`     | `mock` (default) hoac `real` cho agent runner               |

## Docker

```bash
# Build (context = platform/backend, NOT server/)
docker build -t vct-server -f platform/backend/server/Dockerfile platform/backend

# Run
docker run -p 8787:8787 \
  -e JWT_SECRET=dev-32-chars-random-abcdef \
  -v $(pwd)/.data:/app/data \
  vct-server
```

Healthcheck noi bo container chay `wget -qO- /healthz` moi 20s.

## Cau truc thu muc

```
server/
  src/
    server.ts                  # Hono entry point — buildApp() + main()
    env.ts                     # Zod-validated env config
    routes/
      auth.ts                  # Email-OTP (Gmail SMTP) + JWT cookie
      agents.ts                # /api/agents — 19 agents Legion
      projects.ts              # CRUD project + brief/analyze + start-pipeline
      health.ts                # /healthz, /readyz, /livez (chi tiet)
      version.ts               # /api/version (semver + git commit)
      deliverables.ts          # manifest + signature
      dashboard.ts             # KPI overview / agent-stats / activity
      events.ts                # SSE per-project stream
    mounts/
      tcvn.ts pipeline.ts boq.ts bim.ts mep.ts qc.ts render.ts export.ts
    middleware/
      auth.ts rate-limit.ts audit.ts
    lib/
      db.ts (re-export 18-table DB layer)
      jwt.ts                   # jose HS256
      email-otp.ts             # nodemailer Gmail + HTML rose-gold
      event-bus.ts             # in-process bus cho SSE
      external-loader.ts       # dynamic import Wave-1 modules
      uid.ts audit.ts
  tests/
    test-server.ts             # E2E smoke (auth + project + pipeline + SSE)
  Dockerfile                   # multi-stage build cho Cloud Run
  .env.example                 # template config
```

## Lien he 1 mach voi cac module Wave 1

- DB la cung 1 sqlite file (`data/vct.db`) chia se voi pipeline orchestrator,
  qc-runner, packager. Migration runner tu auto-load `db/migrations/*.sql`.
- Agent registry `agents/registry.json` la nguon su that duy nhat — server doc
  truc tiep file (cached trong process), pipeline `agent-runner` cung doc cung file.
- TCVN rules `tcvn/rules/*.json` load mot lan vao memory khi co request /api/tcvn.

Bao mat:
- JWT HS256 cookie HttpOnly + SameSite=Lax + Secure khi prod
- Per-IP + per-user rate limit (token bucket)
- Audit log moi action vao bang `audit_log`
- CORS allowlist tu env

## Roadmap

- [x] Wave 1 mounting: 8 modules cu the
- [x] /api/agents Legion API + run via pipeline
- [x] /healthz + /api/version chi tiet
- [x] /api/pipeline/run/:projectId + SSE per job
- [x] Dockerfile multi-stage
- [ ] Replace better-sqlite3 -> Postgres (Wave 3)
- [ ] WebSocket cho heavier multi-room dashboards
