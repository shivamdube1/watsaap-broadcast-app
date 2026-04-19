# Drip Engine — n8n-Based Outbound Email Drip System

A production-grade email drip automation system built on **n8n** workflows and **PostgreSQL**.
Replaces a FastAPI + Celery + Redis + PostgreSQL stack with zero-Redis, schema-identical architecture.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Inbound API                                                  │
│  POST /webhook/campaigns/:id/enroll  ──► Workflow 1           │
│  POST /webhook/webhooks/esp          ──► Workflow 5           │
├───────────────────────────────────────────────────────────────┤
│  Scheduled Workflows                                          │
│  Every 30 min ──► Queue Scanner (WF2)                         │
│  Every 15 min ──► Reply-Stop / IMAP (WF3)                     │
├───────────────────────────────────────────────────────────────┤
│  Sub-Workflow                                                 │
│  WF2 calls ──► Send Email (WF4) for each queue item          │
│               • Suppression check                            │
│               • Hourly rate limit (n8n static data)          │
│               • Template personalisation                      │
│               • HMAC-signed unsubscribe tokens               │
│               • Send via Brevo HTTP API                      │
│               • Post-send DB updates + next-step queuing     │
├───────────────────────────────────────────────────────────────┤
│  PostgreSQL (7 tables, indexes, auto updated_at triggers)    │
└───────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Docker Desktop | ≥ 4.x |
| Docker Compose | v2 (bundled with Docker Desktop) |
| Public URL or ngrok | For webhooks |
| Brevo account | Free tier works |
| IMAP-enabled inbox | For reply detection (optional) |

---

## Quick Start

### Step 1 — Clone & Configure

```bash
# 1a. Clone or download this folder
git clone <your-repo-url> drip-engine
cd drip-engine

# 1b. Copy the environment template
cp .env.example .env
```

Open `.env` in your editor and fill **every value**:

| Variable | Description |
|---|---|
| `POSTGRES_USER` | DB username (e.g. `drip_user`) |
| `POSTGRES_PASSWORD` | Strong DB password |
| `POSTGRES_DB` | DB name (leave as `drip_engine`) |
| `N8N_BASIC_AUTH_USER` | n8n UI login username |
| `N8N_BASIC_AUTH_PASSWORD` | n8n UI login password |
| `N8N_ENCRYPTION_KEY` | Run `openssl rand -hex 32` |
| `WEBHOOK_URL` | Your public n8n URL (e.g. `https://n8n.example.com`) |
| `BREVO_API_KEY` | From Brevo → SMTP & API → API Keys |
| `IMAP_HOST` | IMAP server hostname |
| `IMAP_USER` | IMAP email address |
| `IMAP_PASSWORD` | IMAP app password |
| `UNSUB_HMAC_SECRET` | Run `openssl rand -hex 32` |

> **Generating secrets (Windows PowerShell alternative):**
> ```powershell
> -join ((0..31) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
> ```

---

### Step 2 — Start the Stack

```bash
docker compose up -d
```

Wait ~30 seconds. Verify services:
```bash
docker compose ps
# Both n8n and postgres should show "Up / healthy"
```

Logs:
```bash
docker compose logs -f n8n
docker compose logs -f postgres
```

---

### Step 3 — Apply the Database Schema

The schema is automatically applied on first start via the Docker entrypoint mount.
If you need to re-apply manually:

```bash
docker exec -i drip_engine_postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < schema.sql
```

Verify tables exist:
```bash
docker exec -it drip_engine_postgres \
  psql -U drip_user -d drip_engine -c "\dt"
```

Expected output — 7 tables:
```
 contacts | campaigns | drip_steps | subscriber_sequences
 email_queue | email_logs | suppression_list
```

---

### Step 4 — Import Workflow JSON Files

1. Open n8n UI at `http://localhost:5678`
2. Login with `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD`
3. Click **"+"** → **"Import from file"**
4. Import each file from the `workflows/` folder in this order:

| Order | File | Purpose |
|---|---|---|
| 1 | `send-email.json` | Sub-workflow (must exist before WF2 references it) |
| 2 | `enroll-contacts.json` | Enrollment webhook |
| 3 | `drip-queue-scanner.json` | 30-min queue scanner |
| 4 | `reply-stop.json` | 15-min reply detector |
| 5 | `esp-webhook-handler.json` | ESP event receiver |

> **Important:** After importing `drip-queue-scanner.json`, open it and update the **"Execute: Send Email Sub-Workflow"** node so its `workflowId` points to the actual ID of the imported `send-email` workflow (visible in the URL when you open that workflow).

---

### Step 5 — Configure Credentials in n8n

Navigate to **Settings → Credentials** and create:

#### A. PostgreSQL Credential
- **Name:** `Drip Engine Postgres` (must match exactly)
- **Type:** PostgreSQL
- Host: `postgres` (Docker service name — NOT `localhost`)
- Port: `5432`
- Database: value of `POSTGRES_DB`
- User: value of `POSTGRES_USER`
- Password: value of `POSTGRES_PASSWORD`

#### B. Brevo API Key Credential
- **Name:** `Brevo API Key`
- **Type:** HTTP Header Auth
- Header Name: `api-key`
- Header Value: your `BREVO_API_KEY`

#### C. IMAP Credential (for reply detection)
- **Name:** `Campaign IMAP`
- **Type:** IMAP
- Host: your `IMAP_HOST`
- Port: 993
- User: your `IMAP_USER`
- Password: your `IMAP_PASSWORD`
- SSL: enabled

> After creating each credential, re-open the affected workflows and assign the credential to each node that shows a credential warning.

---

### Step 6 — Set Environment Variables in n8n

For the unsubscribe token HMAC signing to work in Code nodes, set:

1. Go to **Settings → Variables** (n8n Enterprise) **OR** add to `.env`:
   ```
   N8N_ENV_VARS=UNSUB_HMAC_SECRET=your_secret,WEBHOOK_URL=https://...
   ```

   Alternatively the Code node reads `process.env.UNSUB_HMAC_SECRET` directly when n8n is started with that env var.

---

### Step 7 — Activate All Workflows

Open each workflow and toggle **Active** to ON (top-right toggle).

Order to activate:
1. `send-email` (sub-workflow — activate first)
2. All remaining 4 workflows

---

### Step 8 — Seed Test Data

#### Insert a test campaign:
```sql
INSERT INTO campaigns (name, hourly_limit, from_email, is_active)
VALUES ('Welcome Series', 100, 'hello@yourdomain.com', true);
```

#### Insert drip steps:
```sql
INSERT INTO drip_steps (campaign_id, step_order, subject, template_body, delay_days)
VALUES
  ('<campaign-uuid>', 1,
   'Welcome, {{first_name}}!',
   '<h1>Hi {{first_name}},</h1><p>Welcome aboard! We are thrilled to have you.</p>',
   0),
  ('<campaign-uuid>', 2,
   'Getting started — tips for {{first_name}}',
   '<h1>Hey {{first_name}},</h1><p>Here are 3 tips to get you started...</p>',
   3);
```

#### Insert a test contact:
```sql
INSERT INTO contacts (email, metadata)
VALUES ('test@example.com', '{"first_name": "Alice"}');
```

---

### Step 9 — Test Enrollment

```bash
curl -X POST http://localhost:5678/webhook/campaigns/<campaign-uuid>/enroll \
  -H "Content-Type: application/json" \
  -d '{"contactIds": ["<contact-uuid>"]}'
```

Expected response:
```json
{ "enrolled": 1, "campaignId": "<campaign-uuid>" }
```

---

### Step 10 — Verify Queue Row

```bash
docker exec -it drip_engine_postgres \
  psql -U drip_user -d drip_engine \
  -c "SELECT id, status, scheduled_for FROM email_queue ORDER BY created_at DESC LIMIT 5;"
```

Expected: a row with `status = 'pending'` and `scheduled_for = NOW()` (step 1 has `delay_days = 0`).

---

## Testing the Full Send Flow

1. Temporarily update the queue row's `scheduled_for` to the past:
   ```sql
   UPDATE email_queue SET scheduled_for = NOW() - INTERVAL '1 minute'
   WHERE status = 'pending';
   ```

2. Manually trigger "Queue Scanner" workflow in the n8n UI (click ▶ Run).

3. Check execution logs in n8n — the send-email sub-workflow should show as called.

4. Verify in the database:
   ```sql
   SELECT status, esp_message_id FROM email_queue ORDER BY updated_at DESC LIMIT 5;
   SELECT event_type, occurred_at  FROM email_logs   ORDER BY occurred_at  DESC LIMIT 5;
   ```

---

## ESP Webhook Setup (Brevo)

1. In Brevo: **Transactional → Settings → Webhook**
2. URL: `https://YOUR_N8N_URL/webhook/webhooks/esp`
3. Events to subscribe: `hard_bounce`, `unsubscribe`, `open`, `click`
4. Method: POST

---

## Unsubscribe Endpoint

The system generates HMAC-signed tokens. You need to add an n8n workflow (or external handler) at:

```
GET /webhook/unsubscribe?t=<token>
```

That workflow should:
1. Split the token on `.` → `[payloadB64, hmac]`
2. Decode `payloadB64` → `{ email, cid, iat }`
3. Verify HMAC with your `UNSUB_HMAC_SECRET`
4. Insert into `suppression_list` and cancel pending queue items
5. Return a "You've been unsubscribed" HTML page

---

## Monitoring & Maintenance

### View recent send activity:
```sql
SELECT el.event_type, c.email, el.occurred_at
FROM email_logs el
JOIN contacts c ON c.id = el.contact_id
ORDER BY el.occurred_at DESC
LIMIT 20;
```

### Campaign stats:
```sql
SELECT
  cam.name,
  COUNT(*) FILTER (WHERE el.event_type = 'sent')        AS sent,
  COUNT(*) FILTER (WHERE el.event_type = 'open')        AS opens,
  COUNT(*) FILTER (WHERE el.event_type = 'click')       AS clicks,
  COUNT(*) FILTER (WHERE el.event_type = 'hard_bounce') AS bounces,
  COUNT(*) FILTER (WHERE el.event_type = 'unsubscribe') AS unsubs
FROM email_logs el
JOIN campaigns cam ON cam.id = el.campaign_id
GROUP BY cam.name;
```

### Paused sequences (reply detected):
```sql
SELECT c.email, ss.paused_reason, ss.updated_at
FROM subscriber_sequences ss
JOIN contacts c ON c.id = ss.contact_id
WHERE ss.status = 'paused';
```

---

## Stopping the Stack

```bash
docker compose down          # stop containers (data preserved)
docker compose down -v       # stop AND delete all data (destructive!)
```

---

## File Structure

```
drip-engine/
├── schema.sql                      # PostgreSQL schema (7 tables + indexes)
├── docker-compose.yml              # n8n + PostgreSQL services
├── .env.example                    # Environment variable template
├── README.md                       # This file
└── workflows/
    ├── enroll-contacts.json        # WF1: Webhook enrollment
    ├── drip-queue-scanner.json     # WF2: Scheduled queue processor
    ├── reply-stop.json             # WF3: IMAP reply detection
    ├── send-email.json             # WF4: Sub-workflow email sender
    └── esp-webhook-handler.json    # WF5: Bounce/unsub/open/click handler
```

---

## Security Checklist

- [ ] Change all default passwords in `.env`
- [ ] Use HTTPS for `WEBHOOK_URL` in production
- [ ] Store `IMAP_PASSWORD` and `BREVO_API_KEY` only in n8n Credentials (not plaintext)
- [ ] Rotate `N8N_ENCRYPTION_KEY` and `UNSUB_HMAC_SECRET` regularly
- [ ] Put n8n behind a reverse proxy (nginx/Caddy) with TLS
- [ ] Restrict Postgres port 5432 — do not expose publicly

---

## Troubleshooting

| Problem | Solution |
|---|---|
| n8n can't connect to Postgres | Make sure host is `postgres` (not `localhost`) in n8n credential |
| Webhook returns 404 | Activate the workflow; check `WEBHOOK_URL` matches your public URL |
| Emails not sending | Check Brevo API key credential; view n8n execution logs |
| IMAP fetch errors | Enable "Less secure apps" or use Gmail App Passwords |
| Rate limit not resetting | Static data persists until workflow is deactivated/reactivated |
| Sub-workflow not found | Import `send-email.json` first; update the workflow ID reference in WF2 |
