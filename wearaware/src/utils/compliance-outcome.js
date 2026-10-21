import rules from '../config/compliance-outcomes.json' with { type: 'json' };

// A false-detection label or entry override alone does not verify actual PPE.
export function finalComplianceOutcome(record = {}) {
  return rules.find(rule => Object.entries(rule.when).every(([field, value]) => record[field] === value))?.outcome || 'manual_review';
}
export function originalComplianceOutcome(record = {}) {
  return record.ai_result || record.result || 'manual_review';
}
export function complianceLabel(outcome) {
  return ({ compliant: 'Compliant', violation: 'Violation', manual_review: 'Manual Review / Inconclusive' })[outcome] || 'Manual Review / Inconclusive';
}
