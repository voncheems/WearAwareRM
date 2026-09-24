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
async function createWorkerProfile(fullName) {
  const nextNum = await data.nextId('employee_id');
  const employee_id = `WA-${String(nextNum).padStart(4, '0')}`;
  const worker = (await data.insert('workers', {
    employee_id,
    full_name: fullName.trim(),
    status: 'active',
  }, 'id employee_id full_name status')).rows[0];
  return worker;
}

// A User account is always a worker-portal account. If the administrator does
// not select a pre-existing worker, create one and link it in the same request.
async function resolveWorkerLink(role, workerId, userId, fullName, existingWorkerId = null) {
  if (role !== 'user') return { workerId: null, createdWorker: null };
  if (workerId !== null && workerId !== undefined && workerId !== '') {
    return { workerId: await validateWorkerLink(role, workerId, userId), createdWorker: null };
  }
  if (existingWorkerId != null) {
    return { workerId: await validateWorkerLink(role, existingWorkerId, userId), createdWorker: null };
  }
  const createdWorker = await createWorkerProfile(fullName);
  return { workerId: createdWorker.id, createdWorker };
}

async function removeCreatedWorker(worker) {
  if (worker?.id) await data.remove('workers', { id: worker.id });
}

module.exports = { validateWorkerLink, resolveWorkerLink, removeCreatedWorker };
