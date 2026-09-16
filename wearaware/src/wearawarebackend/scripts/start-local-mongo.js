const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MongoClient } = require('mongodb');
const directory = path.join(__dirname, '..', '.mongodb-data');
async function main() {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const client = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true', { serverSelectionTimeoutMS: 2000 });
  try {
    try { await client.connect(); } catch {
      const started = spawnSync('mongod', ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', '27017', '--replSet', 'wearaware-rs', '--fork', '--logpath', path.join(directory, 'mongod.log')], { encoding: 'utf8' });
      if (started.status !== 0) throw new Error('Could not start mongod. Check installation and .mongodb-data/mongod.log.');
      await client.connect();
    }
    const admin = client.db('admin');
    let status;
    try { status = await admin.command({ replSetGetStatus: 1 }); } catch (error) {
      if (error.code !== 94) throw new Error('Port 27017 is occupied by a server not configured for this replica set.');
      await admin.command({ replSetInitiate: { _id: 'wearaware-rs', members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
    }
    if (status && status.set !== 'wearaware-rs') throw new Error('Port 27017 belongs to another replica set. No changes made to it.');
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await admin.command({ hello: 1 })).isWritablePrimary) {
        console.log('Local MongoDB ready: mongodb://127.0.0.1:27017/wearaware?replicaSet=wearaware-rs');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Local MongoDB has not elected a primary yet.');
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
