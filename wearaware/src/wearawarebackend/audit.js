const { getDatabase } = require('./database');

function clean(value, max = 240) {
  if (typeof value !== 'string') return '';
  return value.split('').map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? ' ' : character;
  }).join('').trim().slice(0, max);
}

// Audit logging must never change the outcome of the action being recorded.
async function recordAudit({ category, action, actor, actorEmail, target = '', details = '' }) {
  try {
    const db = getDatabase();
    const counter = await db.collection('_counters').findOneAndUpdate(
      { _id: 'audit_logs' }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' },
    );
    await db.collection('audit_logs').insertOne({
      id: counter.value,
      category: clean(category, 40),
      action: clean(action, 160),
      actor_id: Number.isSafeInteger(actor?.id) ? actor.id : null,
      actor_name: clean(actor?.full_name || '', 120),
      actor_role: clean(actor?.role || '', 40),
      actor_email: clean(actorEmail || actor?.email || '', 254).toLowerCase(),
      target: clean(target, 240),
      details: clean(details, 500),
      occurred_at: new Date(),
    });
  } catch {
    // Deliberately ignore audit storage failures so authentication and safety checks stay available.
  }
}

module.exports = { recordAudit };
