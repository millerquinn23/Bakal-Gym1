require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('✅ Database migration finished.');
  await pool.end();
}

migrate().catch(async (err) => {
  console.error('❌ Migration failed:', err);
  await pool.end();
  process.exit(1);
});
