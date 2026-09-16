// The N-of-M quorum rule (§8.3) — the one formula the whole approval
// workflow rests on. Pure and framework-free on purpose: given a step
// definition and its decisions so far, what's the step's outcome?
//
//   approvals = distinct approvers whose latest non-recalled decision is 'approve'
//   rejections = distinct approvers whose latest non-recalled decision is 'reject'
//   passed  when approvals  >= N
//   failed  when rejections >  M - N   (no way left to reach N approvals)
//   otherwise: waiting
//
// `step.approvers` is already deduplicated by the time it reaches here
// (§7.5 dedup happens at resolve time), so M = step.approvers.length.

export function evaluateStep(step, decisions) {
  const M = step.approvers.length;
  const N = step.quorum;

  // Only the latest decision per approver counts — an approver who acted,
  // was recalled, and hasn't acted again has no active vote.
  const latestByApprover = new Map();
  for (const decision of decisions) {
    if (decision.action !== 'approve' && decision.action !== 'reject') continue;
    latestByApprover.set(decision.emp_id, decision);
  }

  let approvals = 0;
  let rejections = 0;
  for (const decision of latestByApprover.values()) {
    if (decision.recalledAt) continue;
    if (decision.action === 'approve') approvals++;
    else if (decision.action === 'reject') rejections++;
  }

  if (approvals >= N) return 'passed';
  if (rejections > M - N) return 'failed';
  return 'waiting';
}
