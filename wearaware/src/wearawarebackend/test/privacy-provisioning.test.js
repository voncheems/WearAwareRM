const { test } = require('node:test');
const assert = require('node:assert/strict');
const { main, provisioningFailureMessage } = require('../scripts/setup-privacy-requests');

test('provisioning stops before connecting when approval or admin URI is absent', async () => {
  await assert.rejects(main([], {}), { code: 'APPLY_REQUIRED' });
  await assert.rejects(main(['--apply'], {}), { code: 'ADMIN_URI_MISSING' });
  await assert.rejects(main(['--apply'], { MONGODB_ADMIN_URI: '   ' }), { code: 'ADMIN_URI_MISSING' });
});

test('safe provisioning diagnostics identify missing configuration and permission failures', () => {
  assert.match(provisioningFailureMessage({ code: 'ADMIN_URI_MISSING' }), /MONGODB_ADMIN_URI is missing or blank/);
  assert.match(provisioningFailureMessage({ code: 18 }), /rejected.*credentials/);
  assert.match(provisioningFailureMessage({ code: 13 }), /lacks permission/);
  assert.match(provisioningFailureMessage({ name: 'MongoParseError' }), /not a valid/);
  assert.match(provisioningFailureMessage({ name: 'MongoServerSelectionError' }), /could not be reached/);
});

test('diagnostics never echo raw connection strings or driver messages', () => {
  const secret = 'synthetic-private-value';
  for (const error of [{ message: secret }, { code: 18, message: secret }, { name: 'MongoParseError', message: secret }]) {
    assert.equal(provisioningFailureMessage(error).includes(secret), false);
  }
  assert.match(provisioningFailureMessage({ message: 'Existing privacy_requests schema differs; private details' }), /No validator or data was replaced/);
});
