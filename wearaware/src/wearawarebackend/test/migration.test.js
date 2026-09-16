const { test } = require('node:test');
const assert = require('node:assert/strict');
const { digest, validate, verify } = require('../scripts/migrate-postgres');
const { normalize, manilaDate } = require('../repository');
const source = () => ({ roles: [{ id: 1, name: 'admin' }], users: [{ id: 1, role_id: 1, email: 'admin@example.test', password_hash: 'preserved-hash' }], devices: [{ id: 5, device_id: 'scanner-uuid', inspector_id: 1 }], workers: [{ id: 7, employee_id: 'WA-0007', device_id: 5 }], detections: [{ id: 8, worker_id: 7, device_id: 5, inspector_id: 1 }], notifications: [{ id: 9, detection_id: 8, inspector_id: 1 }], password_reset_requests: [] });
test('migration validates IDs, unique keys, and all relationships', () => {
  validate(source());
  const broken = source(); broken.detections[0].worker_id = 999;
  assert.throws(() => validate(broken), /Broken relationship/);
  const duplicate = source(); duplicate.users.push({ ...duplicate.users[0] });
  assert.throws(() => validate(duplicate), /duplicate integer IDs/);
});
test('verification compares values, including hashes, rather than only counts', async () => {
  const rows = source();
  const db = { collection: name => ({ find: () => ({ sort: () => ({ toArray: async () => name === 'users' ? [{ ...rows.users[0], password_hash: 'changed' }] : rows[name] }) }) }) };
  await assert.rejects(verify(db, rows), /Verification failed for users/);
  assert.equal(digest([{ b: 2, a: new Date('2026-01-01Z') }]), digest([{ a: new Date('2026-01-01Z'), b: 2 }]));
});
test('integer foreign keys are normalized but scanner UUIDs stay strings', () => {
  assert.deepEqual(normalize('workers', { id: '7', device_id: '5' }), { id: 7, device_id: 5 });
  assert.deepEqual(normalize('devices', { device_id: 'scanner-uuid' }), { device_id: 'scanner-uuid' });
  assert.throws(() => normalize('users', { email: { $ne: null } }), /Invalid email/);
  assert.throws(() => normalize('workers', { id: '7x' }), /Invalid id/);
});
test('Manila display dates cross the UTC day boundary correctly', () => {
  assert.deepEqual(manilaDate('2026-09-16T17:05:00Z'), { date: '2026-09-17', time: '01:05 AM' });
});
