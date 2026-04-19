require('dotenv').config();
const { Pool } = require('pg');

async function run() {
  const pool = new Pool({
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    host: 'localhost',
    port: 5432
  });

  try {
    console.log('1. Connecting to DB...');
    // Create Campaign
    const campRes = await pool.query(`
      INSERT INTO campaigns (name, hourly_limit, from_email, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING id
    `, ['Demo Campaign', 100, process.env.DEFAULT_FROM_EMAIL]);
    const campaignId = campRes.rows[0].id;
    console.log('Campaign created:', campaignId);

    // Create Drip Step
    const stepRes = await pool.query(`
      INSERT INTO drip_steps (campaign_id, step_order, subject, template_body, delay_days)
      VALUES ($1, 1, 'Demo Message', '<p>This is a demo message.</p>', 0)
      RETURNING id
    `, [campaignId]);
    console.log('Step created:', stepRes.rows[0].id);

    // Create Contacts
    const emails = ['shivam.suraj.dube@gmail.com', 'ssd16102003@gmail.com'];
    for (const email of emails) {
      const contactRes = await pool.query(`
        INSERT INTO contacts (email, metadata, status)
        VALUES ($1, '{"first_name": "Demo User"}', 'active')
        ON CONFLICT (email) DO UPDATE SET status = 'active'
        RETURNING id
      `, [email]);
      const contactId = contactRes.rows[0].id;
      console.log('Contact created:', email, contactId);

      // Create Subscriber Sequence
      const seqRes = await pool.query(`
        INSERT INTO subscriber_sequences (contact_id, campaign_id, current_step_order, status)
        VALUES ($1, $2, 0, 'active')
        RETURNING id
      `, [contactId, campaignId]);
      const seqId = seqRes.rows[0].id;

      // Queue the email immediately
      const queueRes = await pool.query(`
        INSERT INTO email_queue (subscriber_sequence_id, campaign_id, contact_id, step_order, scheduled_for, status)
        VALUES ($1, $2, $3, 1, NOW(), 'pending')
        RETURNING id
      `, [seqId, campaignId, contactId]);
      const queueId = queueRes.rows[0].id;
      
      // Sending email directly via Brevo bypass to ensure delivery (since n8n may not have credentials configured yet)
      console.log('Sending email via Brevo API to', email);
      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sender: { 
            name: process.env.DEFAULT_FROM_NAME,
            email: process.env.DEFAULT_FROM_EMAIL
          },
          to: [{ email }],
          subject: "Demo Message",
          htmlContent: "<p>This is a demo message.</p>"
        })
      });

      const body = await resp.json();
      console.log('Brevo Response:', body);

      if (body.messageId) {
        await pool.query(`
          UPDATE email_queue SET status = 'sent', esp_message_id = $1, updated_at = NOW() WHERE id = $2
        `, [body.messageId, queueId]);

        await pool.query(`
          INSERT INTO email_logs (email_queue_id, contact_id, campaign_id, event_type, raw_payload)
          VALUES ($1, $2, $3, 'Sent', $4)
        `, [queueId, contactId, campaignId, body]);
        
        console.log(`Successfully logged sent for ${email}`);
      }
    }
  } catch (err) {
    console.error('Error in script:', err.message);
  } finally {
    await pool.end();
  }
}

run();
