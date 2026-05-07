-- =============================================================
-- Viet-Contech AI Design Platform — Schema khoi tao (v1)
-- 18 bang Postgres-compatible (CHECK CONSTRAINT thay cho ENUM)
-- Chay duoc tren better-sqlite3 truoc, sau swap pg de production.
--
-- Triet ly: NASA/SpaceX
--   - V&V pyramid: requirements -> decisions -> deliverables -> qc_gates
--   - Closed-loop: agent_runs -> conflicts -> resolution -> revision moi
--   - FDIR: status field tren agent_runs/qc_gates ho tro detect/isolate/recover
--   - TMR: voters_json tren qc_gates (3 agent vote, majority wins)
--   - Configuration Management: project_revisions = git commit
--   - Immutable audit: append-only audit_log + signature/hash
-- =============================================================

PRAGMA foreign_keys = ON;

-- =============================================================
-- 1. PROJECTS — Du an cua khach hang
-- =============================================================
CREATE TABLE IF NOT EXISTS projects (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  owner_user_id       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','briefing','running','review','locked','delivered','archived','failed')),
  locked_revision_id  TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- =============================================================
-- 2. PROJECT_REVISIONS — Git-like commit cho moi project
--   parent_revision_id = NULL khi la commit dau tien
--   message = mo ta thay doi (vd: "Layout v2: dich PN ngu len lau")
-- =============================================================
CREATE TABLE IF NOT EXISTS project_revisions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  parent_revision_id  TEXT,
  message             TEXT NOT NULL,
  agent               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_revision_id) REFERENCES project_revisions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON project_revisions(project_id);
CREATE INDEX IF NOT EXISTS idx_revisions_parent  ON project_revisions(parent_revision_id);

-- =============================================================
-- 3. REQUIREMENTS — DNA brief immutable
--   source: 'brief' (KH nhap), 'kts' (KTS chot), 'auto' (agent suy ra)
--   locked = 1 -> khong duoc edit, chi tao requirement moi de override
-- =============================================================
CREATE TABLE IF NOT EXISTS requirements (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('brief','kts','auto')),
  type        TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  locked      INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_req_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_req_type    ON requirements(project_id, type, key);

-- =============================================================
-- 4. LOT_SPECS — Thong so lo dat (1-1 voi project)
-- =============================================================
CREATE TABLE IF NOT EXISTS lot_specs (
  project_id        TEXT PRIMARY KEY,
  width_m           REAL NOT NULL,
  depth_m           REAL NOT NULL,
  area_m2           REAL NOT NULL,
  direction         TEXT NOT NULL,
  address           TEXT,
  gfa_target        REAL,
  density_max_pct   REAL DEFAULT 80.0,
  setback_min_m     REAL DEFAULT 1.5,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- =============================================================
-- 5. CLIENT_PROFILE — Thong tin khach hang + cung menh (1-1 voi project)
-- =============================================================
CREATE TABLE IF NOT EXISTS client_profile (
  project_id      TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  phone           TEXT,
  year_born       INTEGER,
  gender          TEXT CHECK (gender IN ('male','female','other')),
  cung_menh       TEXT,
  ngu_hanh        TEXT,
  family_size     INTEGER,
  lifestyle_json  TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- =============================================================
-- 6. CONCEPTS — Phuong an y tuong (3-5 concept/du an, KH chon 1)
--   style_code: luxury|indochine|modern|walnut|neoclassic|japandi|wabisabi|minimalism|mediterranean
-- =============================================================
CREATE TABLE IF NOT EXISTS concepts (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  style_code        TEXT NOT NULL
                    CHECK (style_code IN ('luxury','indochine','modern','walnut','neoclassic','japandi','wabisabi','minimalism','mediterranean')),
  score_phongthuy   REAL,
  score_budget      REAL,
  score_aesthetic   REAL,
  selected          INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0,1)),
  image_url         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_concepts_project ON concepts(project_id);

-- =============================================================
-- 7. AGENTS_REGISTRY — Cataloge 19 AI agents
--   dna_prompt: system prompt chi tiet (TBD by Agent B)
--   input_schema_json / output_schema_json: zod-like JSON schema
--   formulas_json: cong thuc tinh toan agent dung (vd: Asc = (Nd-Rb*b*h*0.85)/Rs)
-- =============================================================
CREATE TABLE IF NOT EXISTS agents_registry (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  scope               TEXT NOT NULL,
  version             TEXT NOT NULL DEFAULT '1.0.0',
  dna_prompt          TEXT NOT NULL DEFAULT 'TBD',
  input_schema_json   TEXT NOT NULL DEFAULT '{}',
  output_schema_json  TEXT NOT NULL DEFAULT '{}',
  tcvn_refs           TEXT,
  formulas_json       TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','deprecated','training','disabled')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================
-- 8. AGENT_RUNS — Log moi lan run agent
--   phase: 1..7 trong 7-phase pipeline (Brief->Concept->...->Export)
--   status FDIR: running -> success | failed | timeout
--   input_hash / output_hash: sha256 stable JSON de detect duplicate run + replay
-- =============================================================
CREATE TABLE IF NOT EXISTS agent_runs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  revision_id   TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  phase         INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 7),
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','success','failed','timeout')),
  input_hash    TEXT NOT NULL,
  output_hash   TEXT,
  duration_ms   INTEGER,
  tokens_used   INTEGER DEFAULT 0,
  cost_vnd      INTEGER DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (project_id)  REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES project_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id)    REFERENCES agents_registry(id)
);
CREATE INDEX IF NOT EXISTS idx_runs_project   ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_revision  ON agent_runs(revision_id);
CREATE INDEX IF NOT EXISTS idx_runs_agent     ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_status    ON agent_runs(status);

-- =============================================================
-- 9. DELIVERABLES — Output files (DWG/PDF/IFC/render/BOQ...)
--   ~150-200 deliverable per project (28 ban ve + BOQ + render + IFC + ...)
--   parent_deliverable_id: track lineage khi co revision (vd: A-04.dxf v2 parent = v1)
--   signature: hex sha256 cua file content -> verify integrity + tamper detect
-- =============================================================
CREATE TABLE IF NOT EXISTS deliverables (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  revision_id           TEXT NOT NULL,
  agent_run_id          TEXT NOT NULL,
  kind                  TEXT NOT NULL
                        CHECK (kind IN ('dwg','dxf','pdf','xlsx','ifc','png','jpg','glb','json','sql','py','md','zip')),
  path                  TEXT NOT NULL,
  size_bytes            INTEGER DEFAULT 0,
  version               INTEGER NOT NULL DEFAULT 1,
  parent_deliverable_id TEXT,
  locked                INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  signature             TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id)            REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id)           REFERENCES project_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_run_id)          REFERENCES agent_runs(id),
  FOREIGN KEY (parent_deliverable_id) REFERENCES deliverables(id)      ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_deliv_project   ON deliverables(project_id);
CREATE INDEX IF NOT EXISTS idx_deliv_revision  ON deliverables(revision_id);
CREATE INDEX IF NOT EXISTS idx_deliv_kind      ON deliverables(project_id, kind);

-- =============================================================
-- 10. CONFLICTS — Phat hien xung dot giua cac agent (KT vs KC, MEP vs Layout...)
--   FDIR isolation: status open->resolving->resolved | escalated (KTS vao xu)
--   severity: low (warning), medium (canh bao), high (block phase ke), critical (stop pipeline)
-- =============================================================
CREATE TABLE IF NOT EXISTS conflicts (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  revision_id         TEXT NOT NULL,
  severity            TEXT NOT NULL
                      CHECK (severity IN ('low','medium','high','critical')),
  detected_by_agent   TEXT NOT NULL,
  type                TEXT NOT NULL,
  description         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','resolving','resolved','escalated')),
  resolution          TEXT,
  resolved_by         TEXT,
  resolved_at         TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id)        REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id)       REFERENCES project_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (detected_by_agent) REFERENCES agents_registry(id)
);
CREATE INDEX IF NOT EXISTS idx_conflicts_project  ON conflicts(project_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_status   ON conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_severity ON conflicts(severity);

-- =============================================================
-- 11. QC_GATES — 12 checkpoint G01..G12
--   voters_json: TMR (Triple Modular Redundancy) — 3 agent vote, majority wins
--                [{agent:"qc_inspector",vote:"pass",reason:"..."},
--                 {agent:"architect",   vote:"pass",reason:"..."},
--                 {agent:"structural",  vote:"fail",reason:"..."}]
--   auto_fix_applied: 1 = QC tu sua loi nho roi pass; 0 = pass that su / fail
--   blocker_message: chi co khi status='failed' -> thong bao KTS
-- =============================================================
CREATE TABLE IF NOT EXISTS qc_gates (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  revision_id         TEXT NOT NULL,
  gate_code           TEXT NOT NULL
                      CHECK (gate_code IN ('G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','G11','G12')),
  gate_name           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','passed','failed','auto_fixed')),
  voters_json         TEXT,
  auto_fix_applied    INTEGER NOT NULL DEFAULT 0 CHECK (auto_fix_applied IN (0,1)),
  blocker_message     TEXT,
  ran_at              TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id)  REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES project_revisions(id) ON DELETE CASCADE,
  UNIQUE (revision_id, gate_code)
);
CREATE INDEX IF NOT EXISTS idx_qc_project  ON qc_gates(project_id);
CREATE INDEX IF NOT EXISTS idx_qc_revision ON qc_gates(revision_id);
CREATE INDEX IF NOT EXISTS idx_qc_status   ON qc_gates(status);

-- =============================================================
-- 12. TCVN_RULES — Catalog quy chuan/tieu chuan VN ap dung
--   formula_json: cong thuc validate (vd: {formula:"area>=corridor*0.9"})
--   applicable_phases: CSV phase ap dung (vd: "2,3,5")
--   severity: critical (vi pham = STOP pipeline), high, medium, low
-- =============================================================
CREATE TABLE IF NOT EXISTS tcvn_rules (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL,
  version             TEXT,
  category            TEXT NOT NULL,
  statement           TEXT NOT NULL,
  formula_json        TEXT,
  source_pdf_path     TEXT,
  applicable_phases   TEXT,
  severity            TEXT NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low','medium','high','critical')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, version, category, statement)
);
CREATE INDEX IF NOT EXISTS idx_tcvn_code     ON tcvn_rules(code);
CREATE INDEX IF NOT EXISTS idx_tcvn_category ON tcvn_rules(category);

-- =============================================================
-- 13. DECISIONS — MBSE: track moi quyet dinh thiet ke quan trong
--   alternatives_considered_json: cac phuong an khac da xet va ly do loai bo
--   requirements_satisfied_json: list requirement IDs ma decision nay thoa man
--   locked = 1 -> da lock revision, khong duoc thay doi
-- =============================================================
CREATE TABLE IF NOT EXISTS decisions (
  id                              TEXT PRIMARY KEY,
  project_id                      TEXT NOT NULL,
  revision_id                     TEXT NOT NULL,
  decision_type                   TEXT NOT NULL,
  made_by_agent                   TEXT,
  summary                         TEXT NOT NULL,
  reasoning_text                  TEXT,
  requirements_satisfied_json     TEXT,
  alternatives_considered_json    TEXT,
  locked                          INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  made_at                         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id)    REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id)   REFERENCES project_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (made_by_agent) REFERENCES agents_registry(id)
);
CREATE INDEX IF NOT EXISTS idx_dec_project   ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_dec_revision  ON decisions(revision_id);

-- =============================================================
-- 14. AUDIT_LOG — APPEND-ONLY (immutable)
--   immutable_hash: sha256(prev_hash + this_row_data) — chain hash chong sua
--   actor: agent_id | user_id | system
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id              TEXT PRIMARY KEY,
  project_id      TEXT,
  action          TEXT NOT NULL,
  actor           TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       TEXT,
  before_json     TEXT,
  after_json      TEXT,
  ip              TEXT,
  ua              TEXT,
  immutable_hash  TEXT NOT NULL,
  ts              TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts      ON audit_log(ts);

-- =============================================================
-- 15. MATERIALS — DB vat lieu (cap nhat theo quy)
--   last_updated_quarter: VD '2026-Q1' -> BOQ check don gia <= 90 ngay
-- =============================================================
CREATE TABLE IF NOT EXISTS materials (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  unit                  TEXT NOT NULL,
  price_vnd             INTEGER NOT NULL,
  supplier              TEXT,
  last_updated_quarter  TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);

-- =============================================================
-- 16. BOQ_ITEMS — Bang khoi luong (boc TU DXF, khong nhap tay)
--   source_dxf_handle: AutoCAD entity handle (cell-referenced)
--   total_vnd duoc tinh, KHONG store hard-coded — tinh tu quantity*unit_price
-- =============================================================
CREATE TABLE IF NOT EXISTS boq_items (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  revision_id         TEXT NOT NULL,
  code                TEXT NOT NULL,
  description         TEXT NOT NULL,
  quantity            REAL NOT NULL,
  unit                TEXT NOT NULL,
  material_id         TEXT,
  unit_price          INTEGER NOT NULL,
  total_vnd           INTEGER NOT NULL,
  source_dxf_handle   TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id)  REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES project_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);
CREATE INDEX IF NOT EXISTS idx_boq_project  ON boq_items(project_id);
CREATE INDEX IF NOT EXISTS idx_boq_revision ON boq_items(revision_id);

-- =============================================================
-- 17. BIM_ELEMENTS — Phan tu BIM (wall/column/slab/door/window/...)
--   geometry_json: {x,y,z,w,h,d_mm} hoac IFC geometry
--   ifc_class: IfcWall, IfcColumn, IfcSlab, IfcDoor, IfcWindow, IfcStair, ...
--   parent_element_id: phan cap (vd: door thuoc wall nao)
-- =============================================================
CREATE TABLE IF NOT EXISTS bim_elements (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  revision_id         TEXT NOT NULL,
  guid                TEXT NOT NULL,
  type                TEXT NOT NULL
                      CHECK (type IN ('wall','column','beam','slab','door','window','stair','roof','foundation','railing','furniture','space','other')),
  geometry_json       TEXT NOT NULL,
  material_id         TEXT,
  parent_element_id   TEXT,
  ifc_class           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id)        REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id)       REFERENCES project_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id)       REFERENCES materials(id),
  FOREIGN KEY (parent_element_id) REFERENCES bim_elements(id) ON DELETE SET NULL,
  UNIQUE (revision_id, guid)
);
CREATE INDEX IF NOT EXISTS idx_bim_project  ON bim_elements(project_id);
CREATE INDEX IF NOT EXISTS idx_bim_revision ON bim_elements(revision_id);
CREATE INDEX IF NOT EXISTS idx_bim_type     ON bim_elements(revision_id, type);

-- =============================================================
-- 18. CLASH_DETECTIONS — Va cham giua cac BIM element
--   intersection_volume_mm3: the tich va cham (mm^3)
--   severity: critical = phai sua truoc khi qua phase ke
-- =============================================================
CREATE TABLE IF NOT EXISTS clash_detections (
  id                          TEXT PRIMARY KEY,
  project_id                  TEXT NOT NULL,
  revision_id                 TEXT NOT NULL,
  element_a_guid              TEXT NOT NULL,
  element_b_guid              TEXT NOT NULL,
  intersection_volume_mm3     REAL NOT NULL,
  severity                    TEXT NOT NULL
                              CHECK (severity IN ('low','medium','high','critical')),
  status                      TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','resolving','resolved','ignored')),
  ran_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id)  REFERENCES projects(id)          ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES project_revisions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_clash_project  ON clash_detections(project_id);
CREATE INDEX IF NOT EXISTS idx_clash_revision ON clash_detections(revision_id);
CREATE INDEX IF NOT EXISTS idx_clash_status   ON clash_detections(status);

-- =============================================================
-- HET 18 BANG.
-- =============================================================
