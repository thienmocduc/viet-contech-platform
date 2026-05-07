// ===============================================================
// Metadata Embed — nhúng thông tin dự án vào file deliverable
// ===============================================================
// Mỗi loại file có cách nhúng metadata khác nhau:
//   - DWG/DXF: title block (text fields trong block STANDARD)
//   - PDF: PDF dictionary keys /Title /Author /Subject /Keywords
//   - IFC: IfcOwnerHistory + IfcProject HEADER
//   - XLSX: Core properties (docProps/core.xml)
//
// Ở stage 1 packager **không sửa file gốc** — chỉ tạo sidecar
// `.meta.json` cùng folder để embed engine của agent đọc lại.
// Hàm `applyMetadataInPlace()` sẽ patch khi tools binding sẵn sàng.
// ===============================================================

import { writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import type { DeliverableSpec, ProjectInfo } from './types.js';
import { sanitizeVi } from './file-naming.js';

export interface EmbedMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  project_code: string;
  project_name: string;
  revision: number;
  revision_id: string;
  drawing_code: string;
  phase: string;
  agent_source: string;
  designer_company: string;
  designer_director: string;
  designer_cert: string;
  date_iso: string;
  /** ASCII-safe variant — dùng cho PDF dictionary tránh encoding bug */
  title_ascii: string;
  author_ascii: string;
}

export function buildEmbedMetadata(spec: DeliverableSpec, project: ProjectInfo): EmbedMetadata {
  const title = `${spec.code} — ${spec.name}`;
  const author = project.designer.company;
  const subject = `${project.name} (${project.code}) | ${spec.phase} | rev v${project.revision_num}`;

  return {
    title,
    author,
    subject,
    keywords: [
      project.code, spec.code, spec.phase, spec.source,
      'Viet-Contech', 'AI Design Platform',
    ],
    project_code: project.code,
    project_name: project.name,
    revision: project.revision_num,
    revision_id: project.revision_id,
    drawing_code: spec.code,
    phase: spec.phase,
    agent_source: spec.source,
    designer_company: project.designer.company,
    designer_director: project.designer.director_name,
    designer_cert: project.designer.cert_no,
    date_iso: new Date().toISOString(),
    title_ascii: sanitizeVi(title),
    author_ascii: sanitizeVi(author),
  };
}

/** Sidecar JSON cùng folder file — agent đọc khi mở file */
export async function writeMetadataSidecar(
  fileAbsPath: string,
  meta: EmbedMetadata,
): Promise<string> {
  const dir = dirname(fileAbsPath);
  const base = basename(fileAbsPath);
  const sidecarPath = join(dir, `${base}.meta.json`);
  await writeFile(sidecarPath, JSON.stringify(meta, null, 2), 'utf-8');
  return sidecarPath;
}

// ----------------------------------------------------------------
// Per-format embed (stub — production sẽ delegate cho native libs)
// ----------------------------------------------------------------

/** DWG: title block fields theo Viet-Contech template */
export function buildDwgTitleBlock(meta: EmbedMetadata): Record<string, string> {
  return {
    DRAWING_TITLE: meta.title_ascii,
    DRAWING_NUMBER: meta.drawing_code,
    PROJECT_NAME: sanitizeVi(meta.project_name),
    PROJECT_CODE: meta.project_code,
    REVISION: `v${meta.revision}`,
    DATE: meta.date_iso.slice(0, 10),
    DESIGNER: meta.author_ascii,
    DIRECTOR: sanitizeVi(meta.designer_director),
    CERT_NO: meta.designer_cert,
    PHASE: meta.phase,
    SCALE: '1:100',
    DRAWN_BY: meta.agent_source,
  };
}

/** PDF Info Dictionary — production dùng pdf-lib */
export function buildPdfInfoDict(meta: EmbedMetadata): Record<string, string> {
  return {
    Title: meta.title,
    Author: meta.author,
    Subject: meta.subject,
    Keywords: meta.keywords.join(', '),
    Creator: 'Viet-Contech AI Design Platform',
    Producer: 'Viet-Contech Output Packager v1.0',
    CreationDate: meta.date_iso,
    ModDate: meta.date_iso,
  };
}

/**
 * IFC HEADER — STEP physical file format (ISO 10303-21).
 * Trả về string fragment để chèn đầu file IFC.
 */
export function buildIfcHeader(meta: EmbedMetadata): string {
  const esc = (s: string) => s.replace(/'/g, "''");
  return [
    `ISO-10303-21;`,
    `HEADER;`,
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
    `FILE_NAME('${esc(meta.drawing_code)}.ifc','${meta.date_iso}',('${esc(meta.author_ascii)}'),('${esc(meta.designer_company)}'),'IFC4','Viet-Contech Packager v1.0','');`,
    `FILE_SCHEMA(('IFC4'));`,
    `ENDSEC;`,
  ].join('\n');
}

/** Excel core properties — production dùng exceljs */
export function buildXlsxCoreProps(meta: EmbedMetadata): Record<string, string> {
  return {
    creator: meta.author,
    lastModifiedBy: meta.author,
    title: meta.title,
    subject: meta.subject,
    keywords: meta.keywords.join('; '),
    description: `Viet-Contech | ${meta.project_code} | rev v${meta.revision}`,
    category: meta.phase,
    created: meta.date_iso,
    modified: meta.date_iso,
  };
}

/**
 * Future: applyMetadataInPlace — gọi pdf-lib / exceljs / ifc-parser
 * để patch metadata vào file gốc. Stage 1: noop, ghi sidecar.
 */
export async function applyMetadataInPlace(
  _fileAbsPath: string,
  _meta: EmbedMetadata,
  _kind: string,
): Promise<{ patched: boolean; method: string }> {
  // Stage 1: chỉ sidecar — agents tương ứng có nhiệm vụ ghi metadata native
  // khi xuất file lần đầu. Packager re-pack với sidecar attached.
  return { patched: false, method: 'sidecar-only' };
}
