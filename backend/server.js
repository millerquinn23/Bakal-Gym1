require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const path = require('path');
const { pool } = require('./db');
const OpenAI = require('openai');

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;
const PAYMONGO_MODE = (process.env.PAYMONGO_MODE || 'test').toLowerCase();
const PAYMONGO_PAYMENT_METHODS = (process.env.PAYMONGO_PAYMENT_METHODS || 'gcash,card')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const PLANS = {
  '1 Month Plan': { amount: 100, days: 30, label: '30 days membership' },
  '2 Months Plan': { amount: 89900, days: 60, label: '60 days membership' },
  '3 Months Plan': { amount: 129900, days: 90, label: '90 days membership' },
  '1 Year Plan': { amount: 499900, days: 365, label: '12 months membership' },
};

const publicPath = path.join(__dirname, 'public');

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('tiny'));
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function basicAuth(req, res, next) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const auth = req.headers.authorization || '';

  if (!auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bakal Gym Admin"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8');
  const [inputUser, inputPass] = decoded.split(':');

  if (inputUser === username && inputPass === password) return next();

  res.setHeader('WWW-Authenticate', 'Basic realm="Bakal Gym Admin"');
  return res.status(401).send('Invalid admin login');
}

function getAuthHeader() {
  if (!PAYMONGO_SECRET_KEY) throw new Error('PAYMONGO_SECRET_KEY is missing');
  return `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`;
}

async function paymongoRequest(paymongoPath, payload) {
  const response = await fetch(`https://api.paymongo.com/v1${paymongoPath}`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('PayMongo POST error:', JSON.stringify(data, null, 2));
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.code ||
      'PayMongo request failed';
    throw new Error(detail);
  }

  return data;
}

async function paymongoGet(paymongoPath) {
  const response = await fetch(`https://api.paymongo.com/v1${paymongoPath}`, {
    method: 'GET',
    headers: {
      Authorization: getAuthHeader(),
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('PayMongo GET error:', JSON.stringify(data, null, 2));
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.code ||
      'PayMongo GET request failed';
    throw new Error(detail);
  }

  return data;
}

function parsePaymongoSignature(signatureHeader) {
  return Object.fromEntries(
    (signatureHeader || '')
      .split(',')
      .map((part) => part.trim().split('='))
      .filter(([k, v]) => k && v)
  );
}

function safeCompareHex(a, b) {
  if (!a || !b) return false;

  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');

  if (aBuf.length !== bBuf.length) return false;

  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyPaymongoSignature(req) {
  if (!PAYMONGO_WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === 'production') return false;

    console.warn('⚠️ PAYMONGO_WEBHOOK_SECRET not set. Skipping webhook verification in local development only.');
    return true;
  }

  const header = req.headers['paymongo-signature'];
  const parts = parsePaymongoSignature(header);

  const timestamp = parts.t;
  const signature = PAYMONGO_MODE === 'live' ? parts.li : parts.te;
  const rawBody = req.body.toString('utf8');

  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', PAYMONGO_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  return safeCompareHex(expected, signature);
}

async function getMembershipByIdentifiers({ membershipId, checkoutSessionId, paymentIntentId, paymentId }) {
  if (membershipId) {
    const result = await pool.query(
      `SELECT * FROM memberships WHERE id = $1 LIMIT 1`,
      [membershipId]
    );
    if (result.rows[0]) return result.rows[0];
  }

  if (checkoutSessionId) {
    const result = await pool.query(
      `SELECT * FROM memberships WHERE paymongo_checkout_session_id = $1 LIMIT 1`,
      [checkoutSessionId]
    );
    if (result.rows[0]) return result.rows[0];
  }

  if (paymentIntentId) {
    const result = await pool.query(
      `SELECT * FROM memberships WHERE paymongo_payment_intent_id = $1 LIMIT 1`,
      [paymentIntentId]
    );
    if (result.rows[0]) return result.rows[0];
  }

  if (paymentId) {
    const result = await pool.query(
      `SELECT * FROM memberships WHERE paymongo_payment_id = $1 LIMIT 1`,
      [paymentId]
    );
    if (result.rows[0]) return result.rows[0];
  }

  return null;
}

async function markMembershipPaid({
  membershipId,
  checkoutSessionId,
  paymentId,
  paymentIntentId,
  referenceNumber,
}) {
  const membership = await getMembershipByIdentifiers({
    membershipId,
    checkoutSessionId,
    paymentIntentId,
    paymentId,
  });

  if (!membership) {
    console.warn('No membership found to mark as paid.', {
      membershipId,
      checkoutSessionId,
      paymentId,
      paymentIntentId,
    });
    return;
  }

  const days = PLANS[membership.plan_name]?.days || 30;

  await pool.query(
    `UPDATE memberships
     SET status = 'paid',
         paid_at = COALESCE(paid_at, NOW()),
         starts_at = COALESCE(starts_at, NOW()),
         expires_at = COALESCE(expires_at, NOW() + ($2 || ' days')::interval),
         paymongo_checkout_session_id = COALESCE($3, paymongo_checkout_session_id),
         paymongo_payment_id = COALESCE($4, paymongo_payment_id),
         paymongo_payment_intent_id = COALESCE($5, paymongo_payment_intent_id),
         paymongo_reference_number = COALESCE($6, paymongo_reference_number),
         updated_at = NOW()
     WHERE id = $1`,
    [
      membership.id,
      String(days),
      checkoutSessionId || null,
      paymentId || null,
      paymentIntentId || null,
      referenceNumber || null,
    ]
  );
}

async function markMembershipFailed({
  membershipId,
  checkoutSessionId,
  paymentId,
  paymentIntentId,
}) {
  const membership = await getMembershipByIdentifiers({
    membershipId,
    checkoutSessionId,
    paymentIntentId,
    paymentId,
  });

  if (!membership) {
    console.warn('No membership found to mark as failed.', {
      membershipId,
      checkoutSessionId,
      paymentId,
      paymentIntentId,
    });
    return;
  }

  await pool.query(
    `UPDATE memberships
     SET status = 'failed',
         paymongo_checkout_session_id = COALESCE($2, paymongo_checkout_session_id),
         paymongo_payment_id = COALESCE($3, paymongo_payment_id),
         paymongo_payment_intent_id = COALESCE($4, paymongo_payment_intent_id),
         updated_at = NOW()
     WHERE id = $1 AND status <> 'paid'`,
    [
      membership.id,
      checkoutSessionId || null,
      paymentId || null,
      paymentIntentId || null,
    ]
  );
}

async function markMembershipCancelled(membershipId) {
  if (!membershipId) return;

  await pool.query(
    `UPDATE memberships
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [membershipId]
  );
}

// Webhook must use raw body before express.json()
app.post('/api/paymongo/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifyPaymongoSignature(req)) {
    return jsonError(res, 401, 'Invalid PayMongo webhook signature');
  }

  let event;

  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return jsonError(res, 400, 'Invalid JSON payload');
  }

  const eventId = event?.data?.id;
  const eventType = event?.data?.attributes?.type;
  const resource = event?.data?.attributes?.data;

  if (!eventId || !eventType) {
    return jsonError(res, 400, 'Invalid PayMongo event');
  }

  const localEventId = crypto.randomUUID();

  try {
    await pool.query(
      `INSERT INTO webhook_events (id, paymongo_event_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [localEventId, eventId, eventType, event]
    );
  } catch (err) {
    if (err.code === '23505') {
      return res.status(200).json({ received: true, duplicate: true });
    }

    throw err;
  }

  try {
    const attrs = resource?.attributes || {};
    const metadata = attrs.metadata || {};

    const membershipId = metadata.membership_id || null;
    const checkoutSessionId = resource?.id || null;
    const paymentId = resource?.id || null;
    const paymentIntentId =
      attrs.payment_intent_id ||
      attrs.payment_intent?.id ||
      attrs.payment_intent ||
      null;

    if (eventType === 'checkout_session.payment.paid') {
      const firstPayment = attrs.payments?.[0];

      await markMembershipPaid({
        membershipId,
        checkoutSessionId: resource?.id || null,
        paymentId: firstPayment?.id || null,
        paymentIntentId:
          firstPayment?.attributes?.payment_intent_id ||
          attrs.payment_intent?.id ||
          attrs.payment_intent ||
          null,
        referenceNumber: attrs.reference_number || null,
      });
    } else if (eventType === 'payment.paid') {
      await markMembershipPaid({
        membershipId,
        checkoutSessionId: null,
        paymentId: resource?.id || null,
        paymentIntentId,
        referenceNumber:
          attrs.external_reference_number ||
          attrs.reference_number ||
          null,
      });
    } else if (
      eventType === 'payment.failed' ||
      eventType === 'checkout_session.payment.failed' ||
      eventType === 'qrph.expired'
    ) {
      await markMembershipFailed({
        membershipId,
        checkoutSessionId,
        paymentId,
        paymentIntentId,
      });
    }

    await pool.query(
      `UPDATE webhook_events
       SET processed = TRUE
       WHERE paymongo_event_id = $1`,
      [eventId]
    );

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);

    await pool.query(
      `UPDATE webhook_events
       SET error = $2
       WHERE paymongo_event_id = $1`,
      [eventId, err.message]
    );

    return res.status(200).json({ received: true, processed: false });
  }
});

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Bakal Gym Backend' });
});

// ── AI FITNESS SUGGESTION ─────────────────────────────────
app.post('/api/generate-fitness-suggestion', async (req, res) => {
  try {
    const { fitness_goal, custom_goal, sex, age, current_weight, height, bmi, body_fat_percentage, selected_plan } = req.body;

    if (!fitness_goal || !sex || !age || !current_weight || !height || !bmi) {
      return jsonError(res, 400, 'Missing required fitness fields.');
    }

    const goalText = fitness_goal === 'Custom Goal' && custom_goal ? custom_goal : fitness_goal;
    const bfText = body_fat_percentage ? `${body_fat_percentage}%` : 'Not provided';

    const prompt = `You are a friendly fitness assistant for a gym enrollment system. Generate simple and general fitness suggestions based on the user's information. Do not give medical diagnosis. Keep the advice beginner-friendly, safe, and easy to understand.

IMPORTANT FORMATTING RULES:
- Do NOT use markdown formatting such as **, ##, -, or bullet symbols.
- Use numbered sections exactly as shown below.
- Write in plain text only.
- Use line breaks to separate sections.
- Keep it concise and readable.

User information:
Fitness Goal: ${goalText}
Sex: ${sex}
Age: ${age}
Current Weight: ${current_weight} kg
Height: ${height} cm
BMI: ${bmi}
Body Fat Percentage: ${bfText}
Selected Gym Plan: ${selected_plan || 'Not specified'}

Generate the response in this exact structure (plain text, no markdown):

1. Goal Summary
(Write a short summary of the user's goal here)

2. Recommended Workout Focus
(Write workout focus here)

3. Suggested Weekly Routine
(Write a simple weekly routine here)

4. Basic Nutrition Tips
(Write nutrition tips here)

5. Progress Tips
(Write progress tips here)

6. Safety Reminder
(Write safety reminder here)

7. Disclaimer
This AI-generated fitness suggestion is for general guidance only and is not a medical or professional fitness diagnosis.`;

    let suggestion = '';

    if (openaiClient) {
      try {
        const completion = await openaiClient.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
          temperature: 0.7,
        });
        suggestion = (completion.choices[0]?.message?.content || '').trim();
        // Strip any remaining markdown symbols
        suggestion = suggestion.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^[-*]\s+/gm, '');
      } catch (aiErr) {
        console.error('OpenAI API error:', aiErr.message);
      }
    }

    if (!suggestion) {
      suggestion = `1. Goal Summary\nBased on your goal of ${goalText}, this plan is designed to help you get started on your fitness journey.\n\n2. Recommended Workout Focus\nStart with a mix of cardio and light resistance training 3 to 4 times per week. Focus on full-body movements.\n\n3. Suggested Weekly Routine\nMonday: Full body workout\nWednesday: Cardio and core\nFriday: Upper and lower body split\nSaturday: Light activity or stretching\n\n4. Basic Nutrition Tips\nEat balanced meals with protein, carbs, and healthy fats. Stay hydrated and avoid skipping meals.\n\n5. Progress Tips\nTrack your workouts weekly. Take progress photos monthly. Increase intensity gradually.\n\n6. Safety Reminder\nAlways warm up before exercise and cool down after. Listen to your body and rest when needed.\n\n7. Disclaimer\nThis AI-generated fitness suggestion is for general guidance only and is not a medical or professional fitness diagnosis.`;

      return res.json({ success: true, fallback: true, suggestion });
    }

    return res.json({ success: true, suggestion });
  } catch (err) {
    console.error('Fitness suggestion error:', err);
    return jsonError(res, 500, 'Failed to generate fitness suggestion.');
  }
});

app.post('/api/create-payment', async (req, res) => {
  try {
    const { plan_name, name, email, contact, fitness_goal, custom_goal, sex, age, current_weight, height, bmi, body_fat_percentage, ai_fitness_suggestion } = req.body;
    const plan = PLANS[plan_name];

    if (!plan) {
      return jsonError(res, 400, 'Invalid membership plan.');
    }

    if (!name || !email || !contact) {
      return jsonError(res, 400, 'Name, email, and contact are required.');
    }

    if (!/^09\d{9}$/.test(contact)) {
      return jsonError(res, 400, 'Invalid Philippine contact number.');
    }

    const membershipId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO memberships (id, customer_name, email, contact, plan_name, amount, currency, status, fitness_goal, custom_goal, sex, age, current_weight, height, bmi, body_fat_percentage, ai_fitness_suggestion)
       VALUES ($1, $2, $3, $4, $5, $6, 'PHP', 'pending', $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [membershipId, name, email, contact, plan_name, plan.amount, fitness_goal || null, custom_goal || null, sex || null, age ? parseInt(age) : null, current_weight ? parseFloat(current_weight) : null, height ? parseFloat(height) : null, bmi ? parseFloat(bmi) : null, body_fat_percentage ? parseFloat(body_fat_percentage) : null, ai_fitness_suggestion || null]
    );

    const checkoutPayload = {
      data: {
        attributes: {
          billing: {
            name,
            email,
            phone: contact,
          },
          description: `Bakal Gym Membership - ${plan_name}`,
          line_items: [
            {
              name: plan_name,
              description: plan.label,
              amount: plan.amount,
              currency: 'PHP',
              quantity: 1,
            },
          ],
          payment_method_types: PAYMONGO_PAYMENT_METHODS,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          success_url: `${FRONTEND_URL}/payment/success?membership_id=${membershipId}`,
          cancel_url: `${FRONTEND_URL}/payment/cancel?membership_id=${membershipId}`,
          metadata: {
            membership_id: membershipId,
            plan_name,
            customer_email: email,
          },
        },
      },
    };

    const checkout = await paymongoRequest('/checkout_sessions', checkoutPayload);

    const checkoutSessionId = checkout?.data?.id;
    const attributes = checkout?.data?.attributes || {};
    const checkoutUrl = attributes.checkout_url;

    if (!checkoutUrl) {
      throw new Error('No checkout_url returned by PayMongo.');
    }

    await pool.query(
      `UPDATE memberships
       SET paymongo_checkout_session_id = $2,
           checkout_url = $3,
           paymongo_reference_number = $4,
           paymongo_payment_intent_id = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [
        membershipId,
        checkoutSessionId,
        checkoutUrl,
        attributes.reference_number || null,
        attributes.payment_intent?.id || attributes.payment_intent || null,
      ]
    );

    return res.json({
      success: true,
      checkout_url: checkoutUrl,
      membership_id: membershipId,
    });
  } catch (err) {
    console.error('Create payment error:', err);
    return jsonError(res, 500, err.message || 'Payment could not be initiated.');
  }
});

app.get('/api/membership/:id', async (req, res) => {
  const result = await pool.query(
    `SELECT id, customer_name, email, contact, plan_name, amount, currency, status,
            paymongo_reference_number, paid_at, starts_at, expires_at, created_at
     FROM memberships
     WHERE id = $1`,
    [req.params.id]
  );

  if (!result.rows[0]) {
    return jsonError(res, 404, 'Membership not found.');
  }

  return res.json({ success: true, membership: result.rows[0] });
});

app.get('/api/admin/stats', basicAuth, async (req, res) => {
  const stats = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
      COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::int AS paid_revenue
    FROM memberships
  `);

  return res.json({ success: true, stats: stats.rows[0] });
});

app.get('/api/admin/memberships', basicAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, customer_name, email, contact, plan_name, amount, currency, status,
            paymongo_reference_number, paymongo_checkout_session_id, paid_at, starts_at,
            expires_at, created_at, updated_at,
            fitness_goal, custom_goal, sex, age, current_weight, height, bmi, body_fat_percentage, ai_fitness_suggestion
     FROM memberships
     ORDER BY created_at DESC
     LIMIT 200`
  );

  return res.json({ success: true, memberships: result.rows });
});

app.patch('/api/admin/memberships/:id/status', basicAuth, async (req, res) => {
  const allowed = ['pending', 'paid', 'failed', 'cancelled'];
  const { status } = req.body;

  if (!allowed.includes(status)) {
    return jsonError(res, 400, 'Invalid status.');
  }

  let updateSql = `
    UPDATE memberships
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;

  let values = [req.params.id, status];

  if (status === 'paid') {
    const current = await pool.query(
      `SELECT plan_name FROM memberships WHERE id = $1`,
      [req.params.id]
    );

    if (!current.rows[0]) {
      return jsonError(res, 404, 'Membership not found.');
    }

    const days = PLANS[current.rows[0].plan_name]?.days || 30;

    updateSql = `
      UPDATE memberships
      SET status = 'paid',
          paid_at = COALESCE(paid_at, NOW()),
          starts_at = COALESCE(starts_at, NOW()),
          expires_at = COALESCE(expires_at, NOW() + ($2 || ' days')::interval),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    values = [req.params.id, String(days)];
  }

  const result = await pool.query(updateSql, values);

  if (!result.rows[0]) {
    return jsonError(res, 404, 'Membership not found.');
  }

  return res.json({ success: true, membership: result.rows[0] });
});

// Success page after PayMongo redirect.
// This checks PayMongo first before marking as paid.
// Webhook is still the main source of truth.
app.get('/payment/success', async (req, res) => {
  const membershipId = req.query.membership_id;

  try {
    if (membershipId) {
      const memberResult = await pool.query(
        `SELECT id, paymongo_checkout_session_id
         FROM memberships
         WHERE id = $1`,
        [membershipId]
      );

      const member = memberResult.rows[0];

      if (member?.paymongo_checkout_session_id) {
        const checkout = await paymongoGet(`/checkout_sessions/${member.paymongo_checkout_session_id}`);
        const attrs = checkout?.data?.attributes || {};

        const firstPayment = attrs.payments?.[0] || null;
        const paymentAttrs = firstPayment?.attributes || {};

        const isPaid =
          Boolean(attrs.paid_at) ||
          paymentAttrs.status === 'paid' ||
          Boolean(paymentAttrs.paid_at);

        if (isPaid) {
          await markMembershipPaid({
            membershipId,
            checkoutSessionId: member.paymongo_checkout_session_id,
            paymentId: firstPayment?.id || null,
            paymentIntentId:
              paymentAttrs.payment_intent_id ||
              attrs.payment_intent?.id ||
              attrs.payment_intent ||
              null,
            referenceNumber:
              attrs.reference_number ||
              paymentAttrs.external_reference_number ||
              null,
          });
        } else {
          await pool.query(
            `UPDATE memberships
             SET updated_at = NOW()
             WHERE id = $1`,
            [membershipId]
          );
        }
      }
    }
  } catch (err) {
    console.error('Success verification error:', err);
  }

  return res.sendFile(path.join(publicPath, 'success.html'));
});

// Cancel/back page after PayMongo redirect.
app.get('/payment/cancel', async (req, res) => {
  const membershipId = req.query.membership_id;

  try {
    await markMembershipCancelled(membershipId);
  } catch (err) {
    console.error('Cancel update error:', err);
  }

  return res.sendFile(path.join(publicPath, 'cancel.html'));
});

// Compatibility for old PayMongo sessions using /success.html
app.get('/success.html', async (req, res) => {
  return res.sendFile(path.join(publicPath, 'success.html'));
});

// Compatibility for old PayMongo sessions using /cancel.html
app.get('/cancel.html', async (req, res) => {
  const membershipId = req.query.membership_id;

  try {
    await markMembershipCancelled(membershipId);
  } catch (err) {
    console.error('Cancel HTML update error:', err);
  }

  return res.sendFile(path.join(publicPath, 'cancel.html'));
});

app.get('/admin', basicAuth, (req, res) => {
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bakal Gym Admin</title>
<style>
:root{--red:#e32636;--red-light:#ff4d5e;--dark:#111;--card:#222;--muted:#999;--white:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--dark);color:var(--white);font-family:Inter,Arial,sans-serif}
.top{padding:22px 5%;border-bottom:2px solid var(--red);display:flex;justify-content:space-between;gap:16px;align-items:center;background:#0a0a0a}
.brand{font-size:28px;font-weight:800;letter-spacing:2px}
.wrap{width:96%;max-width:1500px;margin:28px auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-bottom:22px}
.card{background:var(--card);border:1px solid #333;border-radius:14px;padding:18px}
.card span{color:var(--muted);font-size:13px}
.card strong{display:block;font-size:28px;color:var(--red-light);margin-top:8px}
.tools{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:20px 0}
.tools input{width:min(420px,100%);padding:12px;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:8px}
.table-wrap{overflow-x:auto;background:var(--card);border:1px solid #333;border-radius:14px}
table{width:100%;border-collapse:collapse;min-width:1400px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #333;font-size:13px}
th{color:#ddd;background:#181818;white-space:nowrap}
td{color:#ccc}
.status{padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;text-transform:uppercase}
.paid{background:rgba(38,166,91,.15);color:#6ee7a8}
.pending{background:rgba(245,158,11,.15);color:#fbbf24}
.failed,.cancelled{background:rgba(239,68,68,.15);color:#ff7b7b}
button,select{padding:8px 10px;border-radius:8px;border:1px solid #444;background:#111;color:#fff}
button{background:var(--red);border-color:var(--red);cursor:pointer;font-size:12px}
button:hover{background:#b71c2c}
.btn-sm{padding:5px 10px;font-size:11px}
.ai-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px}
.ai-modal-bg.show{display:flex}
.ai-modal-box{background:#1a1a1a;border:1px solid #333;border-radius:14px;padding:30px;max-width:650px;width:100%;max-height:80vh;overflow-y:auto;position:relative}
.ai-modal-box h3{font-size:20px;margin:0 0 16px;color:var(--red-light)}
.ai-modal-box pre{white-space:pre-wrap;word-wrap:break-word;font-family:Inter,Arial,sans-serif;font-size:14px;color:#ccc;line-height:1.7;margin:0}
.ai-modal-close{position:absolute;top:12px;right:16px;background:none;border:none;color:#888;font-size:24px;cursor:pointer}
.ai-modal-close:hover{color:#fff}
@media(max-width:650px){.top{display:block}.tools{display:block}.tools input{margin-top:10px}}
</style>
</head>
<body>
<header class="top">
  <div>
    <div class="brand">BAKAL GYM ADMIN</div>
    <small>Memberships, payments, and verification dashboard</small>
  </div>
  <small>Protected admin panel</small>
</header>

<main class="wrap">
<section class="cards">
  <div class="card"><span>Total Memberships</span><strong id="total">0</strong></div>
  <div class="card"><span>Paid</span><strong id="paid">0</strong></div>
  <div class="card"><span>Pending</span><strong id="pending">0</strong></div>
  <div class="card"><span>Paid Revenue</span><strong id="revenue">₱0</strong></div>
</section>

<div class="tools">
  <h2>Recent Enrollments</h2>
  <input id="search" placeholder="Search name, email, contact, plan..." />
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Name</th>
        <th>Contact</th>
        <th>Email</th>
        <th>Plan</th>
        <th>Amount</th>
        <th>Fitness Goal</th>
        <th>Sex</th>
        <th>Age</th>
        <th>Weight</th>
        <th>Height</th>
        <th>BMI</th>
        <th>BF%</th>
        <th>AI Suggestion</th>
        <th>Status</th>
        <th>Ref</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="tbody">
      <tr><td colspan="17">Loading...</td></tr>
    </tbody>
  </table>
</div>
</main>

<div class="ai-modal-bg" id="aiModal">
  <div class="ai-modal-box">
    <button class="ai-modal-close" onclick="closeAiModal()">&times;</button>
    <h3>AI Fitness Suggestion</h3>
    <pre id="aiModalContent"></pre>
  </div>
</div>

<script>
let rows = [];

function peso(cents) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP'
  }).format((cents || 0) / 100);
}

function date(v) {
  return v ? new Date(v).toLocaleString('en-PH') : '';
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showAiSuggestion(idx) {
  var r = rows[idx];
  if (!r || !r.ai_fitness_suggestion) return;
  document.getElementById('aiModalContent').textContent = r.ai_fitness_suggestion;
  document.getElementById('aiModal').classList.add('show');
}

function closeAiModal() {
  document.getElementById('aiModal').classList.remove('show');
}

document.getElementById('aiModal').addEventListener('click', function(e) {
  if (e.target === this) closeAiModal();
});

async function load() {
  const s = await fetch('/api/admin/stats').then(r => r.json());

  document.getElementById('total').textContent = s.stats.total;
  document.getElementById('paid').textContent = s.stats.paid;
  document.getElementById('pending').textContent = s.stats.pending;
  document.getElementById('revenue').textContent = peso(s.stats.paid_revenue);

  const data = await fetch('/api/admin/memberships').then(r => r.json());
  rows = data.memberships;
  render();
}

function render() {
  const q = document.getElementById('search').value.toLowerCase();
  const filtered = rows.filter(function(r, i) { r._idx = i; return JSON.stringify(r).toLowerCase().includes(q); });

  document.getElementById('tbody').innerHTML = filtered.map(function(r) {
    var goal = r.fitness_goal || '—';
    if (r.fitness_goal === 'Custom Goal' && r.custom_goal) goal = r.custom_goal;
    return '<tr>' +
      '<td>' + date(r.created_at) + '</td>' +
      '<td>' + esc(r.customer_name) + '</td>' +
      '<td>' + esc(r.contact) + '</td>' +
      '<td>' + esc(r.email) + '</td>' +
      '<td>' + esc(r.plan_name) + '</td>' +
      '<td>' + peso(r.amount) + '</td>' +
      '<td>' + esc(goal) + '</td>' +
      '<td>' + (r.sex || '—') + '</td>' +
      '<td>' + (r.age || '—') + '</td>' +
      '<td>' + (r.current_weight ? r.current_weight + ' kg' : '—') + '</td>' +
      '<td>' + (r.height ? r.height + ' cm' : '—') + '</td>' +
      '<td>' + (r.bmi || '—') + '</td>' +
      '<td>' + (r.body_fat_percentage ? r.body_fat_percentage + '%' : '—') + '</td>' +
      '<td>' + (r.ai_fitness_suggestion ? '<button class="btn-sm" onclick="showAiSuggestion(' + r._idx + ')">View</button>' : '—') + '</td>' +
      '<td><span class="status ' + r.status + '">' + r.status + '</span></td>' +
      '<td>' + (r.paymongo_reference_number || '—') + '</td>' +
      '<td>' +
        '<select id="s-' + r.id + '">' +
          '<option ' + sel(r.status, 'pending') + '>pending</option>' +
          '<option ' + sel(r.status, 'paid') + '>paid</option>' +
          '<option ' + sel(r.status, 'failed') + '>failed</option>' +
          '<option ' + sel(r.status, 'cancelled') + '>cancelled</option>' +
        '</select> ' +
        '<button onclick="save(\\'' + r.id + '\\')">Save</button>' +
      '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="17">No records found.</td></tr>';
}

function sel(a, b) {
  return a === b ? 'selected' : '';
}

async function save(id) {
  const status = document.getElementById('s-' + id).value;

  await fetch('/api/admin/memberships/' + id + '/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });

  await load();
}

document.getElementById('search').addEventListener('input', render);
load();
</script>
</body>
</html>`);
});

// Static frontend files
app.use(express.static(publicPath));

// Frontend fallback
app.use((req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/admin') ||
    req.path.startsWith('/payment')
  ) {
    return next();
  }

  return res.sendFile(path.join(publicPath, 'index.html'));
});

// 404 handler
app.use((req, res) => {
  return res.status(404).send('Not Found');
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  return res.status(500).json({ success: false, message: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`✅ Bakal Gym backend running on port ${PORT}`);
});
