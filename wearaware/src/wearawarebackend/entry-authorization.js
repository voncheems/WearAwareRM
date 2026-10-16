const AUTHORIZATION_STATUS = Object.freeze({
  AUTHORIZED: 'authorized',
  DENIED: 'denied',
  PENDING_INSPECTION: 'pending_inspection',
});

const AUTHORIZATION_EVENT = Object.freeze({
  [AUTHORIZATION_STATUS.AUTHORIZED]: 'ACCESS_AUTHORIZED',
  [AUTHORIZATION_STATUS.DENIED]: 'ACCESS_DENIED',
  [AUTHORIZATION_STATUS.PENDING_INSPECTION]: 'ACCESS_PENDING',
});

function authorizationFromCompliance(result) {
  const status = ({
    compliant: AUTHORIZATION_STATUS.AUTHORIZED,
    violation: AUTHORIZATION_STATUS.DENIED,
    manual_review: AUTHORIZATION_STATUS.PENDING_INSPECTION,
  })[result];
  if (!status) throw Object.assign(new Error('Unknown PPE compliance result.'), { status: 400 });
  return { status, event: AUTHORIZATION_EVENT[status] };
}

function authorizationFromInspectorDecision(decision) {
  const status = ({
    compliant: AUTHORIZATION_STATUS.AUTHORIZED,
    false_detection: AUTHORIZATION_STATUS.AUTHORIZED,
    non_compliant: AUTHORIZATION_STATUS.DENIED,
    unable_to_verify: AUTHORIZATION_STATUS.DENIED,
  })[decision];
  if (!status) throw Object.assign(new Error('Unknown inspector authorization decision.'), { status: 400 });
  return { status, event: AUTHORIZATION_EVENT[status] };
}

function authorizationRecord(complianceResult, decidedAt = new Date()) {
  const decision = authorizationFromCompliance(complianceResult);
  return {
    original_authorization: decision.status,
    authorization_status: decision.status,
    authorization_event: decision.event,
    authorization_decided_at: decidedAt,
    authorization_override_by: null,
    authorization_override_at: null,
    authorization_override_reason: null,
  };
}

module.exports = {
  AUTHORIZATION_STATUS,
  AUTHORIZATION_EVENT,
  authorizationFromCompliance,
  authorizationFromInspectorDecision,
  authorizationRecord,
};
