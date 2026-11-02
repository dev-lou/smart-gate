// After the uniform-vision retirement, old rows may still carry uniform-era
// text in failure_reason (e.g. "NO CICI UNIFORM DETECTED"). New rows always
// set decision_note, so prefer it; map legacy uniform strings to neutral
// wording instead of naming garments that are no longer checked.

const LEGACY_UNIFORM_RE = /uniform|cici|cbmsd|coag|blazer|chef/i;

export interface DecisionLike {
  success: boolean;
  reason_code?: string | null;
  decision_note?: string | null;
  failure_reason?: string | null;
}

export function displayDecision(log: DecisionLike): string {
  if (log.decision_note) return log.decision_note;
  const fr = log.failure_reason ?? "";
  if (fr && LEGACY_UNIFORM_RE.test(fr)) {
    return log.success ? "Access granted (legacy record)" : "Access denied (legacy record)";
  }
  if (fr) return fr;
  return log.success ? "Access granted" : "Access denied";
}
