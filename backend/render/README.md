# Render Farm Orchestrator — Viet-Contech AI Design Platform

Auto render **9 phong cách × 8 góc/phòng + 360° walkthrough** qua Zeni Cloud Lớp 03 `sd-lora-interior`.

Mirror agent `render_3d` trong `agents/registry.json` (B10-render phase).

## Architecture

```
                   +---------------------+
   POST API   -->  |    RenderFarm       | --> JobRegistry (progress)
                   +---------------------+
                          |
            +-------------+--------------+
            |             |              |
       PromptBuilder  ZeniL3Client   StorageAdapter
       (9 styles)    (sd-lora-int)   (local | Zeni L2)
            |             |              |
       prompt+neg     image bytes    PNG/GLB/USDZ
```

## Setup

```bash
cd platform/backend/render
npm install
npm run typecheck
npm test          # mock mode, ~10s
```

## ENV

```bash
ZENI_L3_TOKEN=...            # leave blank → mock mode
ZENI_L3_ENDPOINT=https://zenicloud.io/api/v1/router/route
ZENI_WORKSPACE=vietcontech
ZENI_L2_TOKEN=...            # production storage
ZENI_L2_BUCKET=vietcontech-projects
```

## Cost tier (sd-lora-interior @ $0.04/img preview, $0.08/img production)

| Project size | Rooms | Frames preview | USD | VND |
|---|---|---|---|---|
| 1 room 1 style 8 angles | 1 | 8 | $0.32 | 7,840 |
| 80m² 1 room 9 styles | 1 | 72 | $2.88 | 70,560 |
| 80m² 1 room 9 styles + 360 | 1 | 78 | $3.12 | 76,440 |
| **280m² 6 rooms 9 styles** | 6 | **432** | **$17.28** | **423,360** |
| 280m² 6 rooms 9 styles + 6×360 | 6 | 468 | $18.72 | 458,640 |
| Production 4K (×2 cost) 280m² | 6 | 432 | $34.56 | 846,720 |

360° walkthrough riêng: 6 cubemap face × $0.04 = **$0.24/scene** (5,880 VND).

## API

### Spec v2 (batch submitJob)
| Method | Path | Body / Query |
|---|---|---|
| POST | `/api/render/submit` | `RenderJobOpts` (zod) — return `{jobId, estimatedSec}` |
| GET | `/api/render/job/:jobId` | status — `SubmitJobInfo` |
| GET | `/api/render/job/:jobId/results` | — `RenderResultV2[]` |
| GET | `/api/render/stream/:jobId` | SSE — events `progress` + `done` |

### Wave 1 (legacy)
| Method | Path | Body / Query |
|---|---|---|
| POST | `/api/render/room` | `{projectId, roomType, style, cung_menh, num_angles?, quality?}` |
| POST | `/api/render/all-styles` | `{projectId, roomType, cung_menh, num_angles?, quality?}` |
| POST | `/api/render/360` | `{projectId, roomType, style, cung_menh, quality?}` |
| GET | `/api/render/legacy-job/:id` | — registry compat |
| GET | `/api/render/results/:projectId` | — |
| GET | `/api/render/cost-estimate` | `?num_rooms=6&num_styles=9&num_angles=8&quality=preview&include_360=true` |

## File output

### Spec v2 — `exports/renders/{projectId}/{revisionId}/`
```
4k/
  living_luxury_iso_high.png
  living_luxury_front.png
  master_bedroom_indochine_detail.png
  ... (100+ files at 4K resolution + watermark)
preview/
  living_luxury_iso_high.jpg     (1024px wide JPEG q80)
  ... (same names, ~10× smaller)
360/
  living_panorama.glb           (future)
manifest.json                    (jobId, scene/style/angle metadata + paths)
```

### Wave 1 — `data/renders/{projectId}/{style}/`
```
living-front.png ... 8 angles
panorama-panorama.png/.glb/.usdz (360)
```

Production: ZeniL2StorageAdapter → `vietcontech-projects/{projectId}/03-3d/{style}/...`

## Files

### Spec v2 (batch submitJob — 4K pipeline)
| File | Trách nhiệm |
|---|---|
| `src/index.ts` | `RenderFarm.submitJob / getStatus / getResults` (queue + retry + watermark + preview + manifest) |
| `src/types.ts` | Zod schemas `RenderJobOptsSchema`, `SceneSchema` + Resolution/Priority enums |
| `src/providers/provider.ts` | `ImageProvider` interface chung |
| `src/providers/zeni-l3.ts` | `ZeniL3Provider` — POST `router/route?ws=...` model_hint=image |
| `src/providers/mock.ts` | `MockProvider` — sinh PNG 64×64 RGBA + tEXt label deterministic |
| `src/watermark.ts` | `applyWatermark` — Sharp + SVG overlay "VIET CONTECH" italic 0.6 opacity |
| `src/resizer.ts` | `resizeForPreview` — Sharp 1024px JPEG quality 80 |
| `src/output-folder.ts` | `OutputFolder` — `exports/renders/{projectId}/{revisionId}/{4k,preview,360,manifest.json}` |
| `tests/test-render-v2.ts` | E2E 60 mock renders < 30s |

### Wave 1 (renderRoom / 360 walkthrough — Zeni L3 client legacy)
| File | Trách nhiệm |
|---|---|
| `src/render-farm.ts` | `RenderFarm.renderRoom / renderAll9Styles / render360` (Wave 1) |
| `src/prompt-builder.ts` | 9 STYLE_PROMPTS DNA + room + angle + ngũ hành colors + `buildPromptV2` |
| `src/zeni-l3-client.ts` | Client `sd-lora-interior` (mock + real) — Wave 1 |
| `src/storage.ts` | `LocalStorageAdapter` + `ZeniL2StorageAdapter` |
| `src/queue.ts` | `runPool` parallel-5 retry-3 + `JobRegistry` progress |
| `src/walkthrough-360.ts` | 360 helpers + cost estimator + validation |
| `src/api.ts` | Hono routes — v2 (`/submit /job/:jobId /stream`) + v1 legacy |
| `tests/test-render.ts` | E2E mock Wave 1 |

## Hard constraints (theo agent DNA)

- KHÔNG render người trong cảnh
- KHÔNG render logo thương hiệu
- Watermark VCT bắt buộc 30% opacity, góc dưới phải
- Resolution tối thiểu 2048×1536 (production)
- Negative prompt cố định cho mọi style

## Roadmap

- [ ] Sharp-based real cubemap → equirectangular stitch
- [ ] glTF-Transform real GLB pack với panorama texture
- [ ] BullMQ + Redis queue cho production scale
- [ ] Kết nối với BIM module (đọc DXF/IFC làm conditioning input)
- [ ] Day/night mode (2 lần render mỗi angle)
