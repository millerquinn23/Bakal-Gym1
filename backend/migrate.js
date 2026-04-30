const { Client } = require('pg');
require('dotenv').config();

// Connect to the default 'postgres' database first to create the target DB
const connectionString = 'postgresql://postgres:12345@localhost:5432/postgres';

async function migrate() {
  console.log('🚀 Starting Database Setup...');
  const client = new Client({ connectionString });

  try {
    await client.connect();
    
    // 1. Create the database if it doesn't exist
    try {
      await client.query('CREATE DATABASE bakal_gym');
      console.log('✅ Created database: bakal_gym');
    } catch (err) {
      if (err.code === '42P04') {
        console.log('ℹ️ Database bakal_gym already exists.');
      } else {
        throw err;
      }
    }
    await client.end();

    // 2. Connect to the new database to create/update tables
    const gymClient = new Client({ connectionString: 'postgresql://postgres:12345@localhost:5432/bakal_gym' });
    await gymClient.connect();

    // Create memberships table if it doesn't exist
    await gymClient.query(`
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
        await gymClient.query(`ALTER TABLE memberships ADD COLUMN ${name} ${type}`);
        console.log(`✅ Added column: ${name}`);
      } catch (err) {
        if (err.code === '42701') {
          // Already exists
        } else {
          console.error(`❌ Error adding column ${name}:`, err.message);
        }
      }
    }

    await gymClient.end();
    console.log('✅ Setup complete! You can now proceed to payment.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  }
}

migrate();
