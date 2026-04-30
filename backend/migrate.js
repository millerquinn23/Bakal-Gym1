// SSL Bypass for Render
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { Client } = require('pg');
require('dotenv').config();

// The real Render connection string
const connectionString = 'postgresql://bakal_gym_db_user:DZ6wJcj2avhcdwca6a0A5xytTFVN73jt@dpg-d7n7p33eo5us73f68br0-a/bakal_gym_db';

async function migrate() {
  console.log('🚀 Starting Render Database Setup (SSL Bypass Active)...');
  const client = new Client({ 
    connectionString,
    ssl: { rejectUnauthorized: false } 
  });

  try {
    await client.connect();
    console.log('✅ Connected to Render Database.');

    // Create memberships table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS memberships (
        id UUID PRIMARY KEY,
        customer_name TEXT NOT NULL,
        email TEXT NOT NULL,
        contact TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT DEFAULT 'PHP',
        status TEXT DEFAULT 'pending',
        paymongo_checkout_session_id TEXT,
        checkout_url TEXT,
        paymongo_payment_id TEXT,
        paymongo_payment_intent_id TEXT,
        paymongo_reference_number TEXT,
        paid_at TIMESTAMP WITH TIME ZONE,
        starts_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('✅ Memberships table verified.');

    // Add missing AI columns
    const columns = [
      ['fitness_goal', 'TEXT'],
      ['custom_goal', 'TEXT'],
      ['sex', 'TEXT'],
      ['age', 'INTEGER'],
      ['current_weight', 'NUMERIC'],
      ['height', 'NUMERIC'],
      ['bmi', 'NUMERIC'],
      ['body_fat_percentage', 'NUMERIC'],
      ['ai_fitness_suggestion', 'TEXT']
    ];

    for (const [name, type] of columns) {
      try {
        await client.query(`ALTER TABLE memberships ADD COLUMN ${name} ${type}`);
        console.log(`✅ Added column: ${name}`);
      } catch (err) {
        if (err.code === '42701') {
          // Already exists
        } else {
          console.error(`❌ Error adding column ${name}:`, err.message);
        }
      }
    }

    await client.end();
    console.log('✅ Setup complete on Render!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  }
}

migrate();
