/**
 * index.ts - Node <-> Python subprocess bridge
 * =============================================
 * Spawn Python script, pipe JSON stdin/stdout, validate with zod.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  QuantitiesSchema,
  BOQReportSchema,
  type Quantities,
  type BOQReport,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PYTHON_DIR = resolve(__dirname, '..', 'python');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const TIMEOUT_MS = Number(process.env.BOQ_TIMEOUT_MS || 60_000);

/**
 * Run Python script with args + optional stdin payload.
 * Returns stdout as string. Rejects on timeout or non-zero exit.
 */
async function runPython(
  scriptName: string,
  args: string[] = [],
  stdinPayload?: string,
): Promise<string> {
  const scriptPath = join(PYTHON_DIR, scriptName);
  const proc = spawn(PYTHON_BIN, [scriptPath, ...args], {
    cwd: PYTHON_DIR,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');
  proc.stdout.on('data', (d) => (stdout += d));
  proc.stderr.on('data', (d) => (stderr += d));

  if (stdinPayload) {
    proc.stdin.setDefaultEncoding('utf-8');
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  }

  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rej(new Error(`BOQ Python timeout after ${TIMEOUT_MS}ms (${scriptName})`));
    }, TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      rej(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rej(
          new Error(
            `BOQ Python exit ${code}: ${stderr || stdout || '<no output>'}`,
          ),
        );
      } else {
        res(stdout);
      }
    });
  });
}

/**
 * Extract DXF -> quantities (validated Quantities object).
 */
export async function extractQuantities(dxfPath: string): Promise<Quantities> {
  const out = await runPython('extract.py', [dxfPath]);
  const parsed = JSON.parse(out);
  return QuantitiesSchema.parse(parsed);
}

/**
 * Generate BOQ from quantities + project_meta.
 * Uses temp file for stdin to avoid shell quoting issues.
 */
export async function generateBOQ(
  quantities: Quantities,
  projectMeta: {
    project_id: string;
    project_name?: string;
    floors: number;
    total_floor_area_m2: number;
    style?: string;
  },
  materialsOverride?: Record<string, string>,
): Promise<BOQReport> {
  // Write quantities to a temp file, then call Python via small wrapper that reads it.
  const tmpDir = join(tmpdir(), 'vct-boq');
  await mkdir(tmpDir, { recursive: true });
  const qtyPath = join(tmpDir, `qty-${randomUUID()}.json`);
  await writeFile(qtyPath, JSON.stringify(quantities), 'utf-8');

  // Use a small inline shim script that imports boq_generator and runs.
  const shim = `
import sys, json
sys.path.insert(0, r"${PYTHON_DIR.replace(/\\/g, '\\\\')}")
from boq_generator import generate_boq
qty = json.load(open(sys.argv[1], "r", encoding="utf-8"))
pm = json.loads(sys.argv[2])
override = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
boq = generate_boq(qty, pm, override)
print(json.dumps(boq, ensure_ascii=False))
`.trim();

  const shimPath = join(tmpDir, `shim-${randomUUID()}.py`);
  await writeFile(shimPath, shim, 'utf-8');

  const args = [
    qtyPath,
    JSON.stringify(projectMeta),
    JSON.stringify(materialsOverride || null),
  ];

  // Use python with shim path directly (not relative to PYTHON_DIR)
  const proc = spawn(PYTHON_BIN, [shimPath, ...args], {
    cwd: PYTHON_DIR,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.setEncoding('utf-8');
  proc.stderr.setEncoding('utf-8');
  proc.stdout.on('data', (d) => (stdout += d));
  proc.stderr.on('data', (d) => (stderr += d));

  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rej(new Error(`BOQ generate timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      rej(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rej(new Error(`BOQ generate exit ${code}: ${stderr || stdout}`));
      } else {
        try {
          const parsed = JSON.parse(stdout);
          res(BOQReportSchema.parse(parsed));
        } catch (e) {
          rej(e);
        }
      }
    });
  });
}

/**
 * Export BOQ -> Excel file. Returns absolute path of saved file.
 */
export async function exportBOQExcel(
  boq: BOQReport,
  outputPath: string,
): Promise<string> {
  const tmpDir = join(tmpdir(), 'vct-boq');
  await mkdir(tmpDir, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });

  const boqPath = join(tmpDir, `boq-${randomUUID()}.json`);
  await writeFile(boqPath, JSON.stringify(boq), 'utf-8');

  const out = await runPython('excel_export.py', [boqPath, outputPath]);
  // excel_export.py prints "Excel saved to: <path>"
  const m = out.match(/Excel saved to: (.+)/);
  return m ? m[1].trim() : outputPath;
}

/**
 * Full pipeline: DXF -> quantities -> BOQ -> Excel.
 */
export async function runFullPipeline(
  dxfPath: string,
  projectMeta: {
    project_id: string;
    project_name?: string;
    floors?: number;
    total_floor_area_m2?: number;
    style?: string;
  },
  outputXlsxPath: string,
): Promise<{
  quantities: Quantities;
  boq: BOQReport;
  xlsx_path: string;
}> {
  const quantities = await extractQuantities(dxfPath);
  const meta = {
    floors: quantities.floors_detected,
    total_floor_area_m2: quantities.total_floor_area_m2,
    style: 'modern',
    ...projectMeta,
  };
  const boq = await generateBOQ(quantities, meta);
  const xlsxPath = await exportBOQExcel(boq, outputXlsxPath);
  return { quantities, boq, xlsx_path: xlsxPath };
}

export * from './types.js';
