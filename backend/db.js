const { Pool } = require('pg');

const isRender = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.NODE_ENV === 'production' || isRender) ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
