const SEVERITIES = Object.freeze(['Low', 'Medium', 'High', 'Critical']);
const SEVERITY_RANK = Object.freeze({ Low: 1, Medium: 2, High: 3, Critical: 4 });

function normalizeRule(rule = {}) {
  return {
    id: rule.id ?? null,
    name: typeof rule.name === 'string' ? rule.name.trim() : '',
    condition_type: rule.condition_type,
    ppe_item: typeof rule.ppe_item === 'string' ? rule.ppe_item.trim().toLowerCase() : null,
    checkpoint_id: rule.checkpoint_id == null ? null : Number(rule.checkpoint_id),
    profile_id: rule.profile_id == null ? null : Number(rule.profile_id),
    severity: rule.severity,
    is_active: rule.is_active !== false,
    created_at: rule.created_at || null,
    updated_at: rule.updated_at || null,
  };
}

function isValidRuleShape(rule) {
  const validScope = value => value == null || (Number.isSafeInteger(value) && value > 0);
  if (!['violation', 'missing_ppe'].includes(rule.condition_type)) return false;
  if (!validScope(rule.checkpoint_id) || !validScope(rule.profile_id)) return false;
  if (rule.condition_type === 'missing_ppe') return typeof rule.ppe_item === 'string' && rule.ppe_item.length > 0;
  return rule.ppe_item == null;
}

function matchesRule(ruleInput, context = {}) {
  const rule = normalizeRule(ruleInput);
  if (!rule.is_active || !SEVERITIES.includes(rule.severity) || !isValidRuleShape(rule)) return false;
  if (rule.checkpoint_id != null && Number(context.checkpoint_id) !== rule.checkpoint_id) return false;
  if (rule.profile_id != null && Number(context.profile_id) !== rule.profile_id) return false;
  if (rule.condition_type === 'violation') return context.result === 'violation';
  if (rule.condition_type === 'missing_ppe') {
    return context.result === 'violation'
      && Array.isArray(context.missing_ppe)
      && context.missing_ppe.includes(rule.ppe_item);
  }
  return false;
}

function ruleSpecificity(ruleInput) {
  const rule = normalizeRule(ruleInput);
  return (rule.condition_type === 'missing_ppe' ? 2 : 1)
    + (rule.checkpoint_id != null ? 1 : 0)
    + (rule.profile_id != null ? 1 : 0);
}

function assessRisk(rules = [], context = {}) {
  if (context.result === 'manual_review' || (Array.isArray(context.uncertain_ppe) && context.uncertain_ppe.length)) {
    return { risk_status: 'deferred', risk_severity: null, risk_rule_id: null, risk_rule_name: null, risk_rule_snapshot: null, matched_rule_ids: [] };
  }
  if (context.result !== 'violation') {
    return { risk_status: 'not_applicable', risk_severity: null, risk_rule_id: null, risk_rule_name: null, risk_rule_snapshot: null, matched_rule_ids: [] };
  }
  const matches = rules.filter(rule => matchesRule(rule, context)).map(normalizeRule);
  if (!matches.length) {
    return { risk_status: 'unmatched', risk_severity: null, risk_rule_id: null, risk_rule_name: null, risk_rule_snapshot: null, matched_rule_ids: [] };
  }
  matches.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    || (ruleSpecificity(b) - ruleSpecificity(a))
    || (Number(b.id || 0) - Number(a.id || 0)));
  const winner = matches[0];
  return {
    risk_status: 'matched',
    risk_severity: winner.severity,
    risk_rule_id: winner.id,
    risk_rule_name: winner.name,
    risk_rule_snapshot: {
      id: winner.id, name: winner.name, condition_type: winner.condition_type, ppe_item: winner.ppe_item,
      checkpoint_id: winner.checkpoint_id, profile_id: winner.profile_id, severity: winner.severity,
    },
    matched_rule_ids: matches.map(rule => rule.id).filter(Number.isSafeInteger),
  };
}

module.exports = { SEVERITIES, SEVERITY_RANK, normalizeRule, isValidRuleShape, matchesRule, assessRisk };
