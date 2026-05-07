// TCVN Rules Engine — Test Runner
// Usage: tsx tests/run-tests.ts

import * as fs from 'fs';
import * as path from 'path';
import { loadRules, validateDesign, summarize } from '../src/engine';
import { DesignInput, RuleResult } from '../src/types';

interface Sample {
  name: string;
  design: DesignInput;
}

function testsDir(): string {
  // @ts-ignore — __dirname only exists in CJS
  if (typeof __dirname !== 'undefined') return __dirname;
  let cwd = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cwd, 'platform', 'backend', 'tcvn', 'tests');
    if (fs.existsSync(candidate)) return candidate;
    const local = path.join(cwd, 'tests');
    if (fs.existsSync(local)) return local;
    cwd = path.dirname(cwd);
  }
  return path.resolve('.');
}

const SAMPLES_PATH = path.resolve(testsDir(), 'sample-design.json');
const samples = (JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf-8')) as { samples: Sample[] }).samples;

const rules = loadRules();
console.log(`\n=== TCVN Rules Engine — Test Runner ===`);
console.log(`Loaded ${rules.length} rules across ${new Set(rules.map((r) => r.category)).size} categories\n`);

let allOk = true;

for (const sample of samples) {
  console.log(`\n----- ${sample.name} -----`);
  const results = validateDesign(sample.design, rules);
  const report = summarize(results);

  console.log(
    `Total: ${report.total_rules}  Passed: ${report.passed}  Failed: ${report.failed}  Warn: ${report.warnings}  Skipped: ${report.skipped}`
  );

  // Print only fails + warns (cao/khan/xanh)
  const interesting = results.filter((r: RuleResult) => r.status === 'fail' || r.status === 'warn');
  if (interesting.length === 0) {
    console.log('  All rules pass / skipped (no violations).');
  } else {
    for (const r of interesting) {
      const tag = r.status === 'fail' ? '[FAIL]' : '[WARN]';
      const sev = r.severity.toUpperCase();
      console.log(
        `  ${tag} ${r.rule_code} (${sev}) — ${r.statement_vi}\n    actual=${JSON.stringify(r.actual)} expected=${JSON.stringify(r.expected)}` +
          (r.suggestion ? `\n    suggest: ${r.suggestion}` : '')
      );
    }
  }

  // Sanity assertions per sample (lightweight)
  if (sample.name.includes('Sample 1')) {
    if (report.failed > 0) {
      console.log(`  WARN: Sample 1 expected to mostly pass but had ${report.failed} fails.`);
    }
  }
  if (sample.name.includes('Sample 2')) {
    if (report.failed === 0) {
      console.log(`  ASSERT: Sample 2 should have fails (cot 200x200 cho 5T) but had 0.`);
      allOk = false;
    }
  }
  if (sample.name.includes('Sample 3')) {
    const planFail = results.find((r) => r.rule_code === 'P001' && r.status === 'fail');
    if (!planFail) {
      console.log(`  ASSERT: Sample 3 should have P001 (mat do XD > 80%) fail but it did not.`);
      allOk = false;
    }
  }
}

console.log(`\n=== Test runner finished. ${allOk ? 'OK' : 'WITH ASSERTION ISSUES'} ===\n`);
process.exit(allOk ? 0 : 1);
