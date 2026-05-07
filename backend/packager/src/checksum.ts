// ===============================================================
// Checksum — SHA-256 + manifest.json signature (immutable seal)
// ===============================================================
// Mục đích:
//   1. Khách verify integrity sau khi nhận ZIP (sha256sum -c)
//   2. Audit log immutable — bất kỳ thay đổi nào đều phá vỡ chữ ký
//   3. Lineage: parent_deliverable_id × signature → tamper detect
// ===============================================================

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ChecksumManifest, ChecksumManifestEntry, DeliverableKind } from './types.js';
import { SCHEMA_VERSION } from './manifest-builder.js';

/** SHA-256 từ buffer */
export function sha256Buffer(buf: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** SHA-256 streaming từ file (an toàn với file lớn — không load hết vào RAM) */
export async function sha256File(absPath: string): Promise<{ sha256: string; size: number }> {
  const stats = await stat(absPath);
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size: stats.size }));
    stream.on('error', reject);
  });
}

/** Build manifest.json — toàn bộ entries + chữ ký */
export function buildChecksumManifest(opts: {
  package_id: string;
  entries: ChecksumManifestEntry[];
}): ChecksumManifest {
  const sorted = [...opts.entries].sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  const total_files = sorted.length;
  const total_size_bytes = sorted.reduce((s, e) => s + e.size_bytes, 0);

  // Chữ ký = sha256 của JSON canonical (sort key + remove whitespace nhạy cảm)
  const canonical = JSON.stringify(sorted.map(e => ({
    p: e.rel_path,
    s: e.size_bytes,
    h: e.sha256,
    k: e.kind,
    c: e.code ?? null,
  })));
  const manifest_signature = sha256Buffer(canonical);

  return {
    package_id: opts.package_id,
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    total_files,
    total_size_bytes,
    entries: sorted,
    manifest_signature,
  };
}

/** Render manifest.txt theo format `sha256sum` — khách paste vào lệnh verify */
export function renderSha256SumFile(manifest: ChecksumManifest): string {
  const lines = manifest.entries.map(e => `${e.sha256}  ${e.rel_path}`);
  // header comment
  const header = [
    `# Viet-Contech Package Integrity Manifest`,
    `# package_id: ${manifest.package_id}`,
    `# generated: ${manifest.generated_at}`,
    `# files: ${manifest.total_files} | size: ${manifest.total_size_bytes} bytes`,
    `# signature: ${manifest.manifest_signature}`,
    `# verify: sha256sum -c manifest.txt`,
    ``,
  ];
  return header.concat(lines).join('\n');
}

/** Helper: build entry từ file path */
export async function buildEntry(opts: {
  rel_path: string;
  abs_path: string;
  kind: DeliverableKind;
  code?: string;
}): Promise<ChecksumManifestEntry> {
  const { sha256, size } = await sha256File(opts.abs_path);
  return {
    rel_path: opts.rel_path,
    size_bytes: size,
    sha256,
    kind: opts.kind,
    code: opts.code,
  };
}

/** Verify 1 file — true nếu khớp checksum đã ghi */
export async function verifyEntry(absPath: string, expectedSha256: string): Promise<boolean> {
  try {
    const { sha256 } = await sha256File(absPath);
    return sha256 === expectedSha256;
  } catch {
    return false;
  }
}

/** Verify toàn bộ manifest — return list file failed */
export async function verifyManifest(
  manifest: ChecksumManifest,
  pathResolver: (relPath: string) => string,
): Promise<{ ok: boolean; failed: string[] }> {
  const failed: string[] = [];
  for (const e of manifest.entries) {
    const abs = pathResolver(e.rel_path);
    const ok = await verifyEntry(abs, e.sha256);
    if (!ok) failed.push(e.rel_path);
  }
  return { ok: failed.length === 0, failed };
}
