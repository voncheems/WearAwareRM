const rules = require('../config/compliance-outcomes.json');

// Read-time interpretation only: never rewrite the original scan or authorization.
function finalComplianceExpression() {
  return { $switch: {
    branches: rules.map(rule => ({
      case: { $and: Object.entries(rule.when).map(([field, value]) => ({ $eq: [`$${field}`, value] })) },
      then: rule.outcome,
    })),
    default: 'manual_review',
  } };
}
module.exports = { finalComplianceExpression };
