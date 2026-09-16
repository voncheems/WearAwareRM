require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const directory = path.join(__dirname, '..', 'backups');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const output = path.join(directory, `wearaware-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
const fd = fs.openSync(output, 'wx', 0o600);
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
  env: { ...process.env, PGHOST: process.env.DB_HOST, PGPORT: process.env.DB_PORT, PGDATABASE: process.env.DB_NAME, PGUSER: process.env.DB_USER, PGPASSWORD: process.env.DB_PASSWORD, PGCONNECT_TIMEOUT: '10' },
  stdio: ['ignore', fd, 'pipe'],
});
fs.closeSync(fd);
if (result.status !== 0) {
  console.error('Backup failed. Check pg_dump installation and PostgreSQL connection settings.');
  process.exitCode = 1;
} else console.log(`PostgreSQL backup saved privately: ${output}`);
