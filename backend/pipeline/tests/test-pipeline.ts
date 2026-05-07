/**
 * E2E test pipeline orchestrator (mock mode).
 *
 * Brief: biệt thự 280m² Q.2, 5 thành viên, 2.5 tỷ.
 * Expect:
 *   - 7 phases pass
 *   - 0 critical conflict
 *   - 12/12 QC gates pass
 *   - List deliverables
 *   - Total time < 30s
 */

import { PipelineOrchestrator } from "../src/orchestrator";
import { PipelineEvent, ProjectBrief } from "../src/types";

// Bật mock mode trước khi load orchestrator
process.env.PROVIDER_MODE = "mock";

const BRIEF: ProjectBrief = {
  project_name: "Biệt thự Q2 — anh Tuấn",
  owner: {
    full_name: "Cao Tuấn",
    birth_year: 1985,
    gender: "male",
    family_size: 5,
  },
  lot: {
    address: "Quận 2, TP.HCM",
    area_m2: 280,
    width_m: 14,
    depth_m: 20,
    facing: "S",
    setback_front_m: 4,
    setback_back_m: 2,
    setback_side_m: 1.5,
    far_max: 2.5,
    density_max: 60,
  },
  program: {
    floors: 3,
    bedrooms: 4,
    bathrooms: 4,
    has_garage: true,
    has_pool: true,
    has_altar_room: true,
    style_preference: "japandi",
  },
  budget: {
    total_vnd: 2_500_000_000,
    tolerance_pct: 5,
  },
  legal: {
    permit_status: "pending",
    is_renovation: false,
  },
};

// ─────────────────────────────────────────────────────────────────
// Emoji helpers cho live progress
// ─────────────────────────────────────────────────────────────────

function emojiForEvent(ev: PipelineEvent): string {
  switch (ev.type) {
    case "mission_started":
      return "🚀";
    case "mission_finished":
      return "🏁";
    case "cto_event":
      return "👑";
    case "phase_started":
      return "🟢";
    case "phase_finished":
      return "✅";
    case "agent_started":
      return "🤖";
    case "agent_finished":
      return "✓";
    case "agent_retry":
      return "🔁";
    case "conflict_detected":
      return "⚠️";
    case "conflict_resolved":
      return "🛠️";
    case "gate_passed":
      return "✅";
    case "gate_failed":
      return "❌";
    case "iteration_started":
      return "🔄";
    case "iteration_finished":
      return "🎯";
    case "fdir_alert":
      return "🚨";
    case "tmr_dissent":
      return "🗳️";
    default:
      return "•";
  }
}

function ts(t: number): string {
  return new Date(t).toISOString().slice(11, 23);
}

// ─────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────

async function main() {
  const orch = new PipelineOrchestrator();

  // Live progress
  orch.on("pipeline_event", (ev: PipelineEvent) => {
    const emoji = emojiForEvent(ev);
    const tag = ev.phase ? `[${ev.phase}]` : "";
    const agent = ev.agent ? ` ${ev.agent}` : "";
    // Lọc agent_started/finished cho gọn
    if (ev.type === "agent_started") return; // chỉ in finished
    console.log(`${ts(ev.timestamp)} ${emoji} ${tag}${agent} ${ev.message}`);
  });

  console.log("─".repeat(80));
  console.log("VietConTech Pipeline E2E Test (mock mode)");
  console.log("─".repeat(80));
  console.log(
    `Brief: ${BRIEF.project_name} · ${BRIEF.lot.area_m2}m² · ${BRIEF.owner.family_size} thành viên · ${(BRIEF.budget.total_vnd / 1e9).toFixed(1)} tỷ`,
  );
  console.log("─".repeat(80));

  const t0 = Date.now();
  const result = await orch.runMission("proj_test_001", BRIEF);
  const elapsed = (Date.now() - t0) / 1000;

  console.log("─".repeat(80));
  console.log("KẾT QUẢ");
  console.log("─".repeat(80));
  console.log(`Final status:  ${result.final_status}`);
  console.log(`Duration:      ${elapsed.toFixed(2)}s`);
  console.log(`Phases:        ${result.phases.length}/7`);
  console.log(
    `Phases pass:   ${result.phases.filter((p) => p.status === "succeeded").length}/${result.phases.length}`,
  );
  console.log(`Iterations:    ${result.iterations.length}`);
  console.log(`Deliverables:  ${result.deliverables.length}`);
  console.log(
    `QC gates:      ${result.qc_summary.passed_count}/${result.qc_summary.total_count} pass · score ${result.qc_summary.overall_score}`,
  );
  console.log(`Budget Δ:      ${result.qc_summary.budget_variance_pct.toFixed(1)}%`);
  // Critical = severity major+critical
  const criticalCount = result.phases.reduce(
    (s, p) =>
      s +
      p.conflicts.filter((c) => c.severity === "major" || c.severity === "critical").length,
    0,
  );
  const minorCount = result.phases.reduce(
    (s, p) => s + p.conflicts.filter((c) => c.severity === "minor" || c.severity === "info").length,
    0,
  );
  console.log(`Critical conf: ${criticalCount} (minor: ${minorCount} — auto-fixed)`);

  // Liệt kê 1 phần deliverables
  console.log("");
  console.log("Deliverables (sample):");
  for (const d of result.deliverables.slice(0, 14)) {
    console.log(`  • [${d.type}] ${d.name}`);
  }
  if (result.deliverables.length > 14) {
    console.log(`  … +${result.deliverables.length - 14} more`);
  }

  console.log("─".repeat(80));

  // ─────────────────────────────────────────────────────────────
  // ASSERTIONS
  // ─────────────────────────────────────────────────────────────
  let failed = 0;
  function check(label: string, cond: boolean, detail?: string) {
    const ok = cond ? "✅" : "❌";
    console.log(`${ok} ${label}${detail ? " — " + detail : ""}`);
    if (!cond) failed++;
  }

  check("E2E < 30s", elapsed < 30, `${elapsed.toFixed(2)}s`);
  check("7 phases run", result.phases.length === 7, `got ${result.phases.length}`);
  check(
    "All 7 phases succeeded",
    result.phases.every((p) => p.status === "succeeded"),
  );
  check("Mission converged", result.final_status === "converged");
  check(
    "12/12 QC gates pass",
    result.qc_summary.passed_count === 12,
    `${result.qc_summary.passed_count}/${result.qc_summary.total_count}`,
  );
  check("0 critical/major conflicts", criticalCount === 0, `critical=${criticalCount}, minor=${minorCount}`);
  check("Deliverables ≥ 20", result.deliverables.length >= 20, `${result.deliverables.length}`);
  check(
    "Budget variance ≤ 5%",
    Math.abs(result.qc_summary.budget_variance_pct) <= 5,
    `${result.qc_summary.budget_variance_pct.toFixed(1)}%`,
  );

  console.log("─".repeat(80));
  if (failed === 0) {
    console.log("🎉 ALL CHECKS PASSED");
    process.exit(0);
  } else {
    console.log(`💥 ${failed} CHECK(S) FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
