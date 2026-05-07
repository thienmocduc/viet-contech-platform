/**
 * Escalation logic — quyet dinh lam gi sau khi gate fail.
 *
 * Severity ladder:
 *  low + auto_fixed   -> log + continue
 *  medium             -> log + warning notification cho KTS
 *  high               -> STOP pipeline + KTS approval required
 *  critical           -> STOP + lock revision + critical alert (SMS/Slack)
 */

import type {
  EscalationAction, EscalationChannel, GateResult, Severity,
} from './types.js';

export class EscalationEngine {
  /**
   * Tinh action escalation tu gate result.
   * Cap severity = max(worst_severity, severity_on_fail neu fail).
   */
  buildAction(result: GateResult): EscalationAction {
    const status = result.status;
    const sev: Severity = result.worst_severity ?? 'low';

    // Auto-fixed -> info, log only
    if (status === 'auto_fixed') {
      return {
        level: 'info',
        channels: ['log'],
        stop_pipeline: false,
        lock_revision: false,
        require_kts_approval: false,
        message: `[${result.gate_code}] auto-fixed: ${result.summary}`,
        detail: result,
      };
    }

    // Pass / warn -> info
    if (status === 'pass' || status === 'warn') {
      return {
        level: 'info',
        channels: ['log'],
        stop_pipeline: false,
        lock_revision: false,
        require_kts_approval: false,
        message: `[${result.gate_code}] ${status.toUpperCase()}: ${result.summary}`,
        detail: result,
      };
    }

    // Fail -> escalate theo severity
    return mapSeverityToAction(sev, result);
  }

  /** Run callbacks per channel — production se hook email/SMS/Slack */
  notify(action: EscalationAction, hooks?: Partial<Record<EscalationChannel, (a: EscalationAction) => void>>): void {
    for (const ch of action.channels) {
      const hook = hooks?.[ch];
      if (hook) {
        try { hook(action); } catch { /* swallow */ }
      } else if (ch === 'log') {
        // Default log
        const tag = `[QC.${action.level}]`;
        console.log(`${tag} ${action.message}`);
      }
    }
  }
}

// ============================================================
// Severity -> EscalationAction
// ============================================================
function mapSeverityToAction(sev: Severity, result: GateResult): EscalationAction {
  switch (sev) {
    case 'low':
      return {
        level: 'info',
        channels: ['log'],
        stop_pipeline: false,
        lock_revision: false,
        require_kts_approval: false,
        message: `[${result.gate_code}] LOW fail: ${result.summary}`,
        detail: result,
      };
    case 'medium':
      return {
        level: 'warning',
        channels: ['log', 'notification'],
        stop_pipeline: false,
        lock_revision: false,
        require_kts_approval: false,
        message: `[${result.gate_code}] WARN: ${result.summary} (canh bao KTS)`,
        detail: result,
      };
    case 'high':
      return {
        level: 'block',
        channels: ['log', 'notification', 'email'],
        stop_pipeline: true,
        lock_revision: false,
        require_kts_approval: true,
        message: `[${result.gate_code}] BLOCK pipeline: ${result.summary}. Yeu cau KTS phe duyet.`,
        detail: result,
      };
    case 'critical':
      return {
        level: 'critical',
        channels: ['log', 'notification', 'email', 'sms', 'slack'],
        stop_pipeline: true,
        lock_revision: true,
        require_kts_approval: true,
        message: `[${result.gate_code}] CRITICAL: ${result.summary}. STOP + LOCK revision.`,
        detail: result,
      };
    default:
      return {
        level: 'info',
        channels: ['log'],
        stop_pipeline: false,
        lock_revision: false,
        require_kts_approval: false,
        message: `[${result.gate_code}] unknown severity`,
        detail: result,
      };
  }
}
