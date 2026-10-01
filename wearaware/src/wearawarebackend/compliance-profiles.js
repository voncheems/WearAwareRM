const DEFAULT_PROFILES = [
  { name: 'Construction', description: 'Standard PPE requirements for construction areas.', required_ppe: ['helmet', 'vest', 'boots', 'gloves'] },
  { name: 'Warehouse', description: 'Standard PPE requirements for warehouse operations.', required_ppe: ['vest', 'boots', 'gloves'] },
  { name: 'Laboratory', description: 'Standard PPE requirements for laboratory areas.', required_ppe: ['gloves', 'goggles', 'mask', 'lab-coat'] },
  { name: 'Manufacturing', description: 'Standard PPE requirements for manufacturing floors.', required_ppe: ['helmet', 'vest', 'gloves', 'boots', 'goggles'] },
];

function profileNameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function ensureDefaultComplianceProfiles(db) {
  const collection = db.collection('compliance_profiles');
  for (const profile of DEFAULT_PROFILES) {
    const name_key = profileNameKey(profile.name);
    if (await collection.findOne({ name_key }, { projection: { _id: 1 } })) continue;
    const counter = await db.collection('_counters').findOneAndUpdate(
      { _id: 'compliance_profiles' },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false },
    );
    const now = new Date();
    try {
      await collection.insertOne({ id: counter.value, ...profile, name_key, is_active: true, created_at: now, updated_at: now });
    } catch (error) {
      if (error.code !== 11000 || !await collection.findOne({ name_key })) throw error;
    }
  }
}

module.exports = { DEFAULT_PROFILES, profileNameKey, ensureDefaultComplianceProfiles };
