require('dotenv').config();
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidDecode
} = require('@whiskeysockets/baileys');
const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Logger
const logger = pino({ level: 'info' });

// App & Service Configuration
const app = express();
app.use(express.json());

const PORT = 4000;
const SESSION_PATH = './auth_info';

// Database Pool
const pool = new Pool({
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    host: 'localhost', // Changed from 'postgres' for non-docker run
    port: 5432
});

let sock;
let qrCode = null;
let connectionStatus = 'initializing';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    logger.info(`Starting WhatsApp with version v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Drip Engine', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCode = await QRCode.toDataURL(qr);
            connectionStatus = 'waiting_qr';
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.info('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            connectionStatus = 'disconnected';
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            logger.info('Opened WhatsApp connection');
            qrCode = null;
            connectionStatus = 'connected';
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Contacts Sync Logic
async function syncContacts() {
    try {
        const contacts = Object.values(sock.contacts || {});
        logger.info(`Syncing ${contacts.length} contacts to database...`);

        for (const contact of contacts) {
            if (!contact.id.endsWith('@s.whatsapp.net')) continue;

            const name = contact.name || contact.verifiedName || contact.notify || 'Unknown';
            const jid = contact.id;
            const number = jid.split('@')[0];

            await pool.query(`
                INSERT INTO contacts (email, tags, metadata, status)
                VALUES ($1, $2, $3, 'active')
                ON CONFLICT (email) DO UPDATE 
                SET metadata = contacts.metadata || $3, 
                    updated_at = NOW()
            `, [
                jid, // Using JID as the unique identifier in the email column for this project
                ['WhatsApp'], // Automatic tag
                JSON.stringify({ 
                    first_name: name,
                    whatsapp_number: number,
                    source: 'WhatsApp Import'
                })
            ]);
        }
        return contacts.length;
    } catch (err) {
        logger.error('Failed to sync contacts:', err);
        throw err;
    }
}

// API Routes
app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, qr: qrCode });
});

app.post('/import', async (req, res) => {
    if (connectionStatus !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    try {
        const count = await syncContacts();
        res.json({ success: true, count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/send', async (req, res) => {
    const { jid, message } = req.body;
    if (connectionStatus !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    try {
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/logout', async (req, res) => {
    try {
        await sock.logout();
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        res.json({ success: true });
        connectToWhatsApp(); // Restart to get new QR
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    logger.info(`WhatsApp API listening on port ${PORT}`);
    connectToWhatsApp();
});
