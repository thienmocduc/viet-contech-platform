/**
 * viewer.tsx — Placeholder React component cho BIM 3D Viewer
 * ===========================================================
 *
 * Frontend nhe hien thi:
 *   - Load IFC file qua xeokit-sdk hoac three.js (chua chot)
 *   - Highlight clash voi mau:
 *       hard     -> #dc2626 (red)
 *       soft     -> #f97316 (orange)
 *       workflow -> #eab308 (yellow)
 *   - Click element -> show GUID + properties + lineage (agent nao tao)
 *
 * Hien tai code la SCAFFOLD — su dung canvas overlay + fetch JSON data.
 * Khi web-frontend cai xeokit-sdk, swap WebGL renderer block.
 *
 * Props:
 *   ifcUrl                  : URL den .ifc.json (fallback) hoac .ifc
 *   clashes                 : list clash tu /api/bim/clash
 *   projectId / revisionId : audit/lineage
 *   onElementClick(elem)   : callback khi user click 1 element
 */

import * as React from 'react';

// ============================================================
// Types matching backend
// ============================================================
export interface ViewerElement {
  guid: string;
  type: string;
  ifc_class: string;
  name: string;
  material: string;
  geometry: Record<string, unknown>;
  parent_guid: string | null;
  properties?: Record<string, unknown>;
  lineage?: {
    created_by_agent: string;
    revision_id: string;
    created_at: string;
  };
}

export interface ViewerClash {
  id: string;
  element_a_guid: string;
  element_b_guid: string;
  kind: 'hard' | 'soft' | 'workflow';
  severity: 'low' | 'medium' | 'high' | 'critical';
  color: string;
  intersection_volume_mm3: number;
  min_distance_mm: number;
  suggestion: string;
}

export interface BIMViewerProps {
  ifcUrl: string;
  clashes?: ViewerClash[];
  projectId: string;
  revisionId: string;
  onElementClick?: (e: ViewerElement) => void;
}

// ============================================================
// Helper: load .ifc.json fallback (real IFC binary se phai
// dung web-ifc-three; trong giai doan placeholder cho fallback)
// ============================================================
async function loadIfcJson(url: string): Promise<{
  meta: Record<string, unknown>;
  elements: ViewerElement[];
}> {
  const res = await fetch(url);
  const data = (await res.json()) as {
    meta?: Record<string, unknown>;
    elements: ViewerElement[];
  };
  return { meta: data.meta ?? {}, elements: data.elements };
}

// ============================================================
// Component
// ============================================================
export const BIMViewer: React.FC<BIMViewerProps> = ({
  ifcUrl,
  clashes = [],
  projectId,
  revisionId,
  onElementClick,
}) => {
  const [elements, setElements] = React.useState<ViewerElement[]>([]);
  const [selected, setSelected] = React.useState<ViewerElement | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadIfcJson(ifcUrl)
      .then((data) => {
        if (!cancelled) {
          setElements(data.elements);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ifcUrl]);

  // Map guid -> clash kind cho highlight
  const clashByGuid = React.useMemo(() => {
    const map = new Map<string, ViewerClash>();
    for (const c of clashes) {
      // Lay clash nang nhat cho element
      const aPrev = map.get(c.element_a_guid);
      if (!aPrev || severityOrder(c.severity) > severityOrder(aPrev.severity)) {
        map.set(c.element_a_guid, c);
      }
      const bPrev = map.get(c.element_b_guid);
      if (!bPrev || severityOrder(c.severity) > severityOrder(bPrev.severity)) {
        map.set(c.element_b_guid, c);
      }
    }
    return map;
  }, [clashes]);

  const handleClick = (e: ViewerElement) => {
    setSelected(e);
    onElementClick?.(e);
  };

  if (loading) return <div style={styles.placeholder}>Loading IFC...</div>;
  if (error) return <div style={styles.error}>Loi: {error}</div>;

  return (
    <div style={styles.root}>
      {/* HEADER */}
      <header style={styles.header}>
        <strong>BIM Viewer</strong>
        <span style={styles.meta}>
          Project: {projectId} | Rev: {revisionId.slice(0, 8)} | Elements: {elements.length}
          {clashes.length > 0 && ` | Clashes: ${clashes.length}`}
        </span>
      </header>

      {/* MAIN: 3D canvas (placeholder) + element list */}
      <div style={styles.body}>
        {/* 3D canvas — TODO swap voi xeokit-sdk */}
        <div style={styles.canvas}>
          <div style={styles.canvasNote}>
            3D canvas placeholder. Khi cai xeokit-sdk hoac three.js + web-ifc:
            <pre style={styles.code}>
{`import { Viewer, Mesh } from "@xeokit/xeokit-sdk";
const viewer = new Viewer({ canvasId: "bim-canvas" });
elements.forEach(e => {
  const color = clashByGuid.has(e.guid)
    ? clashByGuid.get(e.guid).color
    : "#6b7280";
  viewer.scene.createMesh({ id: e.guid, color, ...buildBox(e.geometry) });
});`}
            </pre>
            <p>Hien tai: render dang list 2D voi mau cua clash de demo.</p>
          </div>

          {/* Mini "iso plan" 2D demo */}
          <svg width="100%" height="320" style={styles.svg}>
            {elements.map((e) => {
              const g = e.geometry as Record<string, number>;
              const x = (g.x_mm ?? 0) / 50;
              const y = (g.y_mm ?? 0) / 50;
              const w =
                (g.length_mm ?? g.w_mm ?? g.diameter_mm ?? 100) / 50;
              const h = (g.thickness_mm ?? g.d_mm ?? 50) / 50;
              const clashHere = clashByGuid.get(e.guid);
              const fill = clashHere
                ? clashHere.color
                : colorByType(e.type);
              return (
                <rect
                  key={e.guid}
                  x={x}
                  y={y}
                  width={Math.max(w, 4)}
                  height={Math.max(h, 4)}
                  fill={fill}
                  fillOpacity={selected?.guid === e.guid ? 1 : 0.7}
                  stroke="#111"
                  strokeWidth={selected?.guid === e.guid ? 2 : 0.5}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleClick(e)}
                />
              );
            })}
          </svg>
        </div>

        {/* Side panel: properties */}
        <aside style={styles.aside}>
          {selected ? (
            <div>
              <h3 style={styles.h3}>Properties</h3>
              <div style={styles.kv}>
                <strong>GUID:</strong>
                <code>{selected.guid}</code>
              </div>
              <div style={styles.kv}>
                <strong>Type:</strong> {selected.type} ({selected.ifc_class})
              </div>
              <div style={styles.kv}>
                <strong>Material:</strong> {selected.material}
              </div>
              <div style={styles.kv}>
                <strong>Name:</strong> {selected.name}
              </div>
              {selected.lineage && (
                <>
                  <h4 style={styles.h4}>Lineage</h4>
                  <div style={styles.kv}>
                    <strong>Agent:</strong> {selected.lineage.created_by_agent}
                  </div>
                  <div style={styles.kv}>
                    <strong>Created:</strong> {selected.lineage.created_at}
                  </div>
                </>
              )}
              {clashByGuid.has(selected.guid) && (
                <div
                  style={{
                    ...styles.clashBox,
                    borderColor: clashByGuid.get(selected.guid)!.color,
                  }}
                >
                  <strong style={{ color: clashByGuid.get(selected.guid)!.color }}>
                    {clashByGuid.get(selected.guid)!.kind.toUpperCase()} CLASH
                  </strong>
                  <p>{clashByGuid.get(selected.guid)!.suggestion}</p>
                </div>
              )}
              <details style={styles.details}>
                <summary>Geometry JSON</summary>
                <pre style={styles.code}>
                  {JSON.stringify(selected.geometry, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <p style={styles.hint}>Click element trong canvas de xem properties.</p>
          )}
        </aside>
      </div>

      {/* Legend */}
      <footer style={styles.footer}>
        <span>
          <i style={{ ...styles.dot, background: '#dc2626' }} /> Hard clash
        </span>
        <span>
          <i style={{ ...styles.dot, background: '#f97316' }} /> Soft clash
        </span>
        <span>
          <i style={{ ...styles.dot, background: '#eab308' }} /> Workflow clash
        </span>
        <span>
          <i style={{ ...styles.dot, background: '#6b7280' }} /> No clash
        </span>
      </footer>
    </div>
  );
};

// ============================================================
// Helpers
// ============================================================
function severityOrder(s: ViewerClash['severity']): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[s];
}

function colorByType(t: string): string {
  return (
    {
      wall: '#a3a3a3',
      column: '#1f2937',
      beam: '#374151',
      slab: '#d1d5db',
      door: '#92400e',
      window: '#0ea5e9',
      stair: '#7c3aed',
      other: '#10b981',
    }[t] ?? '#6b7280'
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    overflow: 'hidden',
    background: '#fff',
  },
  header: {
    padding: '8px 12px',
    background: '#0f172a',
    color: '#fff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
  },
  meta: { color: '#cbd5e1', fontSize: 12 },
  body: { display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0, minHeight: 360 },
  canvas: { padding: 12, background: '#f8fafc', position: 'relative' },
  canvasNote: { fontSize: 12, color: '#475569', marginBottom: 8 },
  svg: { background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 4 },
  aside: { borderLeft: '1px solid #e5e7eb', padding: 12, fontSize: 13 },
  h3: { fontSize: 14, marginTop: 0 },
  h4: { fontSize: 12, marginTop: 12, color: '#475569' },
  kv: { display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  hint: { color: '#94a3b8', fontSize: 12 },
  details: { marginTop: 12 },
  code: {
    background: '#0f172a',
    color: '#e2e8f0',
    padding: 8,
    borderRadius: 4,
    fontSize: 11,
    overflow: 'auto',
    maxHeight: 240,
  },
  clashBox: {
    border: '2px solid',
    borderRadius: 4,
    padding: 8,
    marginTop: 8,
    background: '#fff7ed',
    fontSize: 12,
  },
  footer: {
    display: 'flex',
    gap: 12,
    padding: 8,
    fontSize: 11,
    color: '#475569',
    background: '#f1f5f9',
    borderTop: '1px solid #e5e7eb',
  },
  dot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: 10,
    marginRight: 4,
    verticalAlign: 'middle',
  },
  placeholder: { padding: 24, textAlign: 'center', color: '#64748b' },
  error: {
    padding: 24,
    color: '#dc2626',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 4,
  },
};

export default BIMViewer;
