const { data } = require('./repository');

async function validateWorkerLink(role, workerId, userId) {
  if (role !== 'user') return null;
  const id = typeof workerId === 'number' ? workerId : typeof workerId === 'string' && /^\d+$/.test(workerId) ? Number(workerId) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Select a registered worker for this User account.'), { status: 400 });
  const worker = (await data.find('workers', { id }, 'id')).rows[0];
  if (!worker) throw Object.assign(new Error('The selected worker no longer exists.'), { status: 400 });
  const existing = (await data.find('users', { worker_id: id }, 'id')).rows[0];
  if (existing && existing.id !== Number(userId)) throw Object.assign(new Error('This worker already has an account.'), { status: 409 });
  return id;
}
module.exports = { validateWorkerLink };
