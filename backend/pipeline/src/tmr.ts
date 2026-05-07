/**
 * TMR — Triple Modular Redundancy.
 *
 * Chạy 3 instance độc lập của 1 agent (seed khác nhau hoặc temperature khác).
 * Voting 2/3:
 *   - 3 đồng thuận → confidence: high
 *   - 2/3 đồng thuận → confidence: medium, dissent_reasons từ instance bị loại
 *   - không có 2 instance đồng thuận → confidence: low, return null + dissent_reasons
 *
 * Dùng cho QC Inspector + bất kỳ agent nào tmr_enabled=true trong registry.
 */

import {
  AgentCode,
  PhaseCode,
  ProviderConfig,
  TMRResult,
  TMRVote,
} from "./types";
import { runAgent } from "./agent-runner";

export interface TMRRunOptions {
  agent_code: AgentCode;
  phase: PhaseCode;
  input: unknown;
  context?: Record<string, unknown>;
  config?: ProviderConfig;
  /** function so sánh equality giữa 2 output. Mặc định: deep JSON equal */
  equal?: (a: unknown, b: unknown) => boolean;
  /** Trích key field để vote (vd: chỉ vote dựa trên `gates[].passed`) */
  voteOn?: (output: unknown) => unknown;
}

const DEFAULT_EQUAL = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
};

export class TMRVoter {
  /**
   * Chạy 3 instance parallel của 1 agent, return kết quả voting.
   */
  async run<T = unknown>(opts: TMRRunOptions): Promise<TMRResult<T>> {
    const equal = opts.equal ?? DEFAULT_EQUAL;
    const voteOn = opts.voteOn ?? ((o: unknown) => o);

    // Chạy 3 instance parallel với seed khác
    const promises = [1, 2, 3].map((seed) =>
      this.runOnce({
        agent_code: opts.agent_code,
        phase: opts.phase,
        input: opts.input,
        context: opts.context,
        config: opts.config,
        variant_seed: seed,
        instance_id: `tmr_${seed}`,
      }),
    );
    const votes = await Promise.all(promises);

    // Vote
    return this.tally<T>(votes, equal, voteOn);
  }

  private async runOnce(opts: {
    agent_code: AgentCode;
    phase: PhaseCode;
    input: unknown;
    context?: Record<string, unknown>;
    config?: ProviderConfig;
    variant_seed: number;
    instance_id: string;
  }): Promise<TMRVote<unknown>> {
    const start = Date.now();
    try {
      const r = await runAgent({
        agent_code: opts.agent_code,
        phase: opts.phase,
        input: opts.input,
        context: opts.context,
        config: opts.config,
        variant_seed: opts.variant_seed,
      });
      return {
        instance_id: opts.instance_id,
        result: r.status === "succeeded" ? r.output : null,
        duration_ms: Date.now() - start,
        error: r.status !== "succeeded" ? r.errors.join("; ") : undefined,
      };
    } catch (err) {
      return {
        instance_id: opts.instance_id,
        result: null,
        duration_ms: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  private tally<T>(
    votes: TMRVote<unknown>[],
    equal: (a: unknown, b: unknown) => boolean,
    voteOn: (output: unknown) => unknown,
  ): TMRResult<T> {
    const valid = votes.filter((v) => v.result !== null);
    const dissent_reasons: string[] = [];

    // Mọi instance fail → low + null
    if (valid.length === 0) {
      return {
        result: null,
        confidence: "low",
        votes: votes as TMRVote<T>[],
        dissent_reasons: votes.map(
          (v) => v.error || `instance ${v.instance_id} returned null`,
        ),
        consensus_count: 0,
      };
    }

    // Group theo equality của vote-key
    const groups: { key: unknown; members: TMRVote<unknown>[] }[] = [];
    for (const v of valid) {
      const k = voteOn(v.result);
      const found = groups.find((g) => equal(g.key, k));
      if (found) found.members.push(v);
      else groups.push({ key: k, members: [v] });
    }
    groups.sort((a, b) => b.members.length - a.members.length);

    const winner = groups[0];

    // Đếm fail
    const failedCount = votes.length - valid.length;
    if (failedCount > 0) {
      dissent_reasons.push(
        ...votes.filter((v) => v.result === null).map(
          (v) => `${v.instance_id}: ${v.error ?? "null result"}`,
        ),
      );
    }

    // Dissent (instance không đồng ý winner)
    for (const g of groups.slice(1)) {
      for (const v of g.members) {
        dissent_reasons.push(`${v.instance_id}: divergent output`);
      }
    }

    // 3/3 same
    if (winner.members.length === 3) {
      return {
        result: winner.members[0].result as T,
        confidence: "high",
        votes: votes as TMRVote<T>[],
        dissent_reasons: [],
        consensus_count: 3,
      };
    }

    // 2/3 same
    if (winner.members.length === 2) {
      return {
        result: winner.members[0].result as T,
        confidence: "medium",
        votes: votes as TMRVote<T>[],
        dissent_reasons,
        consensus_count: 2,
      };
    }

    // 1/3 each → no consensus → low
    return {
      result: null,
      confidence: "low",
      votes: votes as TMRVote<T>[],
      dissent_reasons: [
        "no 2/3 consensus — all 3 instances diverged",
        ...dissent_reasons,
      ],
      consensus_count: 1,
    };
  }
}
