CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY,
  customer_name VARCHAR(160) NOT NULL,
  email VARCHAR(160) NOT NULL,
  contact VARCHAR(30) NOT NULL,
  plan_name VARCHAR(80) NOT NULL,
  amount INTEGER NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'PHP',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  paymongo_checkout_session_id VARCHAR(120),
  paymongo_payment_id VARCHAR(120),
  paymongo_payment_intent_id VARCHAR(120),
  paymongo_reference_number VARCHAR(120),
  checkout_url TEXT,
  paid_at TIMESTAMPTZ,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memberships_status ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_created_at ON memberships(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memberships_checkout_session ON memberships(paymongo_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_memberships_email ON memberships(email);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY,
  paymongo_event_id VARCHAR(120) UNIQUE NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI Fitness Recommendation columns (safe to re-run)
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS fitness_goal VARCHAR(100);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS custom_goal VARCHAR(255);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS sex VARCHAR(20);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS current_weight NUMERIC(6,2);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS height NUMERIC(6,2);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS bmi NUMERIC(5,2);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS body_fat_percentage NUMERIC(5,2);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS ai_fitness_suggestion TEXT;
