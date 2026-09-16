const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BSON } = require('mongodb');
const { hash } = require('../scripts/atlas-to-local');
test('local migration verification preserves BSON values and ignores document/key order', () => {
  const first = [{ _id: new BSON.ObjectId('012345678901234567890123'), id: 1, at: new Date('2026-01-01T00:00:00Z'), nested: { a: 1, b: 2 } }, { id: 2, values: ['helmet', 'vest'] }];
  const roundTrip = BSON.EJSON.parse(BSON.EJSON.stringify(first, { relaxed: false }));
  assert.equal(hash(first), hash(roundTrip.reverse()));
  assert.notEqual(hash(first), hash([{ ...first[0], at: new Date('2026-01-02T00:00:00Z') }, first[1]]));
  assert.notEqual(hash(first), hash([{ ...first[0], id: 9 }, first[1]]));
});
