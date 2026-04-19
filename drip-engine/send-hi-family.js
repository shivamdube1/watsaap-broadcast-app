const { Pool } = require('pg');
const fetch = require('node-fetch'); // Ensure node-fetch is available or use global fetch if Node 18+

async function sendGREETINGS() {
  const pool = new Pool({
    user: process.env.POSTGRES_USER || 'drip_user',
    password: process.env.POSTGRES_PASSWORD || 'DripEngine2026!',
    database: process.env.POSTGRES_DB || 'drip_engine',
    host: 'localhost',
    port: 5432
  });

  try {
    console.log('--- Family Greeting Automation ---');
    
    // 1. Find contacts from WhatsApp import
    const res = await pool.query(`
      SELECT email, metadata->>'first_name' as name 
      FROM contacts 
      WHERE tags @> ARRAY['WhatsApp']
    `);

    const family = res.rows.filter(c => 
      ['maa', 'jay', 'dadi'].some(name => c.name?.toLowerCase().includes(name))
    );

    if (family.length === 0) {
      console.log('No family contacts found! Make sure you have clicked "Import Contacts" in the WhatsApp dashboard.');
      return;
    }

    console.log(`Found ${family.length} family members. Sending greetings...`);

    for (const member of family) {
      console.log(`Sending Hi to ${member.name} (${member.email})...`);
      
      const response = await fetch('http://localhost:4000/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jid: member.email,
          message: `Hi ${member.name}! This is an automated greeting from my new Drip Engine system. 🚀`
        })
      });

      const result = await response.json();
      if (result.success) {
        console.log(`✅ Message sent to ${member.name}`);
      } else {
        console.log(`❌ Failed to send to ${member.name}: ${result.error}`);
      }
    }

    console.log('--- Done ---');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

sendGREETINGS();
