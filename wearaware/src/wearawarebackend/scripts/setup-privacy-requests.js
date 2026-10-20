// Creates only privacy-request storage/indexes; never executes db:secure or cleanup.
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { provisionPrivacyRequests } = require('../privacy-requests-schema');
async function main(args = process.argv.slice(2), env = process.env) {
  if (!args.includes('--apply')) throw Object.assign(new Error(), { code: 'APPLY_REQUIRED' });
  const uri = env.MONGODB_ADMIN_URI?.trim();
  if (!uri) throw Object.assign(new Error(), { code: 'ADMIN_URI_MISSING' });
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    await provisionPrivacyRequests(client.db(env.MONGODB_DB || 'wearaware'));
    console.log('Privacy request collection and indexes provisioned. No existing personal records were changed.');
  } finally { await client.close(); }
}
function provisioningFailureMessage(error) {
  if (error?.code === 'APPLY_REQUIRED') return 'Setup stopped: review the database target, then explicitly supply --apply.';
  if (error?.code === 'ADMIN_URI_MISSING') return 'Setup stopped: MONGODB_ADMIN_URI is missing or blank. Set it privately in src/wearawarebackend/.env and save the file.';
  if (error?.code === 18 || error?.codeName === 'AuthenticationFailed') return 'Setup stopped: Atlas rejected the provisioning account credentials. Verify them privately.';
  if (error?.code === 13 || error?.codeName === 'Unauthorized') return 'Setup stopped: the provisioning account lacks permission to create the collection, validator or indexes.';
  if (error?.name === 'MongoParseError') return 'Setup stopped: MONGODB_ADMIN_URI is not a valid MongoDB connection string.';
  if (['MongoServerSelectionError', 'MongoNetworkError'].includes(error?.name) || ['ENOTFOUND', 'ECONNREFUSED'].includes(error?.code)) return 'Setup stopped: Atlas could not be reached. Check the cluster address, network and Atlas Network Access rules.';
  if (error?.message?.startsWith('Existing privacy_requests schema differs;')) return 'Setup stopped: an existing privacy_requests validator differs. No validator or data was replaced; review the schema before proceeding.';
  return 'Privacy request provisioning stopped. Review target, privileges and existing schema privately. No raw error details were printed.';
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
  main().catch(error => { console.error(provisioningFailureMessage(error)); process.exitCode = 1; });
}
module.exports = { main, provisioningFailureMessage };
