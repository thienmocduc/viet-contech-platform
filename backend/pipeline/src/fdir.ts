/**
 * FDIR — Fault Detection, Isolation, Recovery (NASA-style).
 *
 * Detect:
 *   - timeout: agent vượt deadline
 *   - schema_mismatch: output không có field bắt buộc
 *   - nan_or_infinity: số hỏng trong output
 *   - contradiction_locked: vi phạm spec đã chốt (locked_specs)
 *   - empty_output: output null/empty
 *
 * Isolate:
 *   - identify root agent
 *   - freeze downstream phase nếu agent bị lỗi là input của phase khác
 *
 * Recovery:
 *   - retry với reduced scope (max 3 lần)
 *   - rollback last good revision
 *   - escalate sau 3 fail liên tiếp
 */

import {
  AgentCode,
  AgentRunResult,
  FaultReport,
  FaultType,
  PhaseCode,
} from "./types";

export interface FDIRConfig {
  max_retries: number;
  escalation_threshold: number;
}

const DEFAULT_FDIR_CONFIG: FDIRConfig = {
  max_retries: 3,
  escalation_threshold: 3,
};

export class FDIR {
  private config: FDIRConfig;
  /** Đếm fail liên tiếp theo agent_code:phase */
  private fail_counter: Map<string, number> = new Map();

  constructor(config?: Partial<FDIRConfig>) {
    this.config = { ...DEFAULT_FDIR_CONFIG, ...(config || {}) };
  }

  // ─────────────────────────────────────────────────────────────
  // DETECT
  // ─────────────────────────────────────────────────────────────

  detect(
    run: AgentRunResult,
    locked_specs: Record<string, unknown>,
    expectedFields?: string[],
  ): FaultReport | null {
    if (run.status === "timeout") {
      return this.makeReport(run, "timeout", `Agent ${run.agent_code} timeout`);
    }
    if (run.status === "failed") {
      return this.makeReport(
        run,
        "exception",
        `Agent ${run.agent_code} failed: ${run.errors.join("; ")}`,
      );
    }

    // Check empty output
    if (run.output === null || run.output === undefined) {
      return this.makeReport(run, "empty_output", `Agent ${run.agent_code} returned null`);
    }

    // Check NaN/Infinity trong số
    if (this.hasNaNOrInfinity(run.output)) {
      return this.makeReport(
        run,
        "nan_or_infinity",
        `Agent ${run.agent_code} output contains NaN or Infinity`,
      );
    }

    // Check schema (field bắt buộc)
    if (expectedFields && expectedFields.length > 0) {
      const missing = this.findMissingFields(run.output, expectedFields);
      if (missing.length > 0) {
        return this.makeReport(
          run,
          "schema_mismatch",
          `Agent ${run.agent_code} missing fields: ${missing.join(", ")}`,
        );
      }
    }

    // Check contradiction with locked specs
    const contradiction = this.findContradiction(run.output, locked_specs);
    if (contradiction) {
      return this.makeReport(run, "contradiction_locked", contradiction);
    }

    return null;
  }

  private makeReport(
    run: AgentRunResult,
    type: FaultType,
    message: string,
  ): FaultReport {
    const key = `${run.agent_code}:${run.phase}`;
    const cur = this.fail_counter.get(key) ?? 0;
    this.fail_counter.set(key, cur + 1);
    const retry_count = cur + 1;

    let recovery_action: FaultReport["recovery_action"];
    if (retry_count >= this.config.escalation_threshold) {
      recovery_action = "escalate";
    } else if (type === "contradiction_locked") {
      recovery_action = "rollback";
    } else if (type === "timeout" || type === "exception") {
      recovery_action = "retry";
    } else {
      recovery_action = "retry";
    }

    return {
      agent_code: run.agent_code,
      phase: run.phase,
      type,
      message,
      detected_at: Date.now(),
      recovery_action,
      retry_count,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // ISOLATE
  // ─────────────────────────────────────────────────────────────

  /**
   * Trả về list downstream agents/phases cần freeze nếu agent này hỏng.
   */
  isolate(
    failedAgent: AgentCode,
    failedPhase: PhaseCode,
    downstreamMap: Map<AgentCode, AgentCode[]>,
  ): { frozen_agents: AgentCode[]; frozen_phase: PhaseCode } {
    const frozen = downstreamMap.get(failedAgent) ?? [];
    return {
      frozen_agents: frozen,
      frozen_phase: failedPhase,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // RECOVERY
  // ─────────────────────────────────────────────────────────────

  /**
   * Trả về action cụ thể để recovery.
   */
  plan_recovery(report: FaultReport): {
    action: FaultReport["recovery_action"];
    rationale: string;
  } {
    if (report.retry_count >= this.config.escalation_threshold) {
      return {
        action: "escalate",
        rationale: `Vượt threshold ${this.config.escalation_threshold} lần — chuyển CTO xử lý`,
      };
    }
    switch (report.type) {
      case "contradiction_locked":
        return {
          action: "rollback",
          rationale: "Vi phạm locked spec — rollback về revision gần nhất",
        };
      case "timeout":
        return {
          action: "retry",
          rationale: "Timeout — retry với scope nhỏ hơn",
        };
      case "schema_mismatch":
      case "nan_or_infinity":
      case "empty_output":
        return {
          action: "retry",
          rationale: `${report.type} — retry với prompt rõ ràng hơn`,
        };
      case "exception":
        return {
          action: "retry",
          rationale: "Exception — retry sau 100ms",
        };
      default:
        return { action: "retry", rationale: "Default retry" };
    }
  }

  /**
   * Reset counter sau khi agent thành công.
   */
  ack_success(agent: AgentCode, phase: PhaseCode): void {
    const key = `${agent}:${phase}`;
    this.fail_counter.delete(key);
  }

  // ─────────────────────────────────────────────────────────────
  // Internal checks
  // ─────────────────────────────────────────────────────────────

  private hasNaNOrInfinity(obj: unknown): boolean {
    if (typeof obj === "number") {
      return Number.isNaN(obj) || !Number.isFinite(obj);
    }
    if (Array.isArray(obj)) {
      return obj.some((v) => this.hasNaNOrInfinity(v));
    }
    if (obj && typeof obj === "object") {
      return Object.values(obj).some((v) => this.hasNaNOrInfinity(v));
    }
    return false;
  }

  private findMissingFields(output: unknown, expected: string[]): string[] {
    if (!output || typeof output !== "object") return expected;
    const obj = output as Record<string, unknown>;
    return expected.filter((f) => !(f in obj));
  }

  private findContradiction(
    output: unknown,
    locked: Record<string, unknown>,
  ): string | null {
    if (!locked || Object.keys(locked).length === 0) return null;
    if (!output || typeof output !== "object") return null;
    const out = output as Record<string, unknown>;
    for (const [key, lockedVal] of Object.entries(locked)) {
      if (key in out) {
        try {
          if (JSON.stringify(out[key]) !== JSON.stringify(lockedVal)) {
            return `Field "${key}" mâu thuẫn locked spec: got ${JSON.stringify(
              out[key],
            )}, expected ${JSON.stringify(lockedVal)}`;
          }
        } catch {
          // ignore
        }
      }
    }
    return null;
  }
}
