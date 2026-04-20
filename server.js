import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Contact, Group, BroadcastList } from './models.js';
import { useMongoAuthState } from './mongoAuthState.js';
import archiver from 'archiver';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 16 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ── LOGIN CREDENTIALS (local only, no DB needed) ─────────────────
const LOGIN_USER = process.env.LOGIN_USERNAME || 'suraj';
const LOGIN_PASS = process.env.LOGIN_PASSWORD || '0809';
const API_KEY    = process.env.API_KEY || 'admin123';

app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    console.log(`[Auth] Login attempt: ${username}`);

    // Simple check — allow any alphanumeric username/password that matches env
    if (
        typeof username === 'string' &&
        typeof password === 'string' &&
        /^[a-zA-Z0-9_]+$/.test(username) &&
        /^[a-zA-Z0-9_]+$/.test(password) &&
        username === LOGIN_USER &&
        password === LOGIN_PASS
    ) {
        console.log(`[Auth] ✅ Login OK for: ${username}`);
        return res.json({ success: true, apiKey: API_KEY });
    }

    console.warn(`[Auth] ❌ Login failed for: ${username}`);
    res.status(401).json({ success: false, error: 'Invalid username or password' });
});

// Serve the current QR code on demand (so the Connect page can load it immediately)
app.get('/api/qr', async (req, res) => {
    if (connectionStatus === 'connected') {
        return res.json({ status: 'connected', qr: null });
    }
    if (!qrCodeData) {
        return res.json({ status: 'waiting', qr: null });
    }
    try {
        const qrImage = await qrcode.toDataURL(qrCodeData);
        res.json({ status: 'pending', qr: qrImage });
    } catch (e) {
        res.status(500).json({ error: 'Failed to generate QR' });
    }
});

// Auth Middleware
const authMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.use('/api', authMiddleware);

app.get('/api/ping', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Download app as ZIP
app.get('/api/download', (req, res) => {
    res.attachment('watsaap-broadcast.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.directory('public/', 'public/');
    archive.file('server.js', { name: 'server.js' });
    archive.file('package.json', { name: 'package.json' });
    archive.file('README.md', { name: 'README.md' });
    archive.finalize();
});

// (Moved above auth middleware)

let sock = null;
let qrCodeData = null;
let connectionStatus = 'disconnected';
let contactList = [];
let lastRestartTime = 0; // Cooldown tracker for safeRestart
let isHistorySyncing = false; // Background sync status

const logger = pino({ level: 'silent' });

const contactsMap = new Map();

// Initialize data from MongoDB
async function initializeData() {
    const isMongoConnected = mongoose.connection.readyState === 1;
    if (!process.env.MONGODB_URI || !isMongoConnected) {
        console.log('⚠️ Skipping MongoDB data initialization (Offline — local mode)');
        return;
    }
    try {
        const contacts = await Contact.find({});
        contacts.forEach(c => contactsMap.set(c.jid, c));
        console.log(`[DB] Loaded ${contacts.size || contacts.length} contacts`);

        customGroups = await Group.find({});
        console.log(`[DB] Loaded ${customGroups.length} groups`);

        broadcastLists = await BroadcastList.find({});
        console.log(`[DB] Loaded ${broadcastLists.length} broadcast lists`);
        
        // Ensure UI is updated with loaded DB data immediately
        if (contactsMap.size > 0) {
            loadContacts();
        }
    } catch (e) {
        console.error('Failed to initialize data from MongoDB:', e);
    }
}
initializeData();

let isContactsDirty = false;
let isWritingContacts = false;
setInterval(async () => {
    if (!isContactsDirty || isWritingContacts || !process.env.MONGODB_URI) return;

    isWritingContacts = true;
    isContactsDirty = false;

    try {
        const contactsArray = Array.from(contactsMap.values());
        // Bulk update/upsert contacts
        const operations = contactsArray.map(c => {
            const jid = c.jid || c.id;
            return {
                updateOne: {
                    filter: { jid },
                    update: { $set: { ...c, jid } },
                    upsert: true
                }
            };
        });

        if (operations.length > 0) {
            await Contact.bulkWrite(operations);
        }
        isWritingContacts = false;
    } catch (err) {
        console.error('Failed to save contacts to MongoDB:', err);
        isWritingContacts = false;
        isContactsDirty = true; // Retry
    }
}, 30000); // 30s interval for DB writes

const groupsFile = path.join(__dirname, 'groups.json');
let customGroups = [];
if (fs.existsSync(groupsFile)) {
    try {
        customGroups = JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
        console.log(`[Groups] Loaded ${customGroups.length} custom groups from file`);
    } catch (e) {
        customGroups = [];
    }
}

// Save groups — prefers MongoDB if connected, falls back to local JSON file
const saveGroups = async () => {
    // Always write to local file first (fast, reliable)
    try {
        fs.writeFileSync(groupsFile, JSON.stringify(customGroups, null, 2), 'utf8');
    } catch (e) {
        console.error('[Groups] Failed to write groups.json:', e.message);
    }
    // Also sync to MongoDB if available
    if (process.env.MONGODB_URI && mongoose.connection.readyState === 1) {
        try {
            await Group.deleteMany({});
            if (customGroups.length) await Group.insertMany(customGroups);
        } catch (e) {
            console.warn('[Groups] MongoDB sync failed (non-fatal):', e.message);
        }
    }
};

// Broadcast Lists Persistence
const saveBroadcastLists = async () => {
    // We'll update lists individually in the API usually, but this is a sync helper
    for (const list of broadcastLists) {
        await BroadcastList.findOneAndUpdate({ id: list.id }, list, { upsert: true });
    }
};

async function safeRestart() {
    const now = Date.now();
    const cooldown = 120000; // 2 minutes
    
    if (now - lastRestartTime < cooldown) {
        const remaining = Math.ceil((cooldown - (now - lastRestartTime)) / 1000);
        console.warn(`[WA] Safe restart ignored. Cooldown active (${remaining}s remaining).`);
        return { success: false, error: `Please wait ${remaining}s before restarting again.` };
    }

    lastRestartTime = now;
    console.log('[WA] Triggering safe restart...');
    if (sock) {
        try {
            console.log('[WA] Closing existing socket to prevent conflict (440)...');
            sock.ev.removeAllListeners();
            sock.end();
        } catch (e) {
            console.error('[WA] Error closing socket:', e.message);
        }
        sock = null;
    }
    // Small delay to ensure the OS releases the port/connection
    await new Promise(resolve => setTimeout(resolve, 2000));
    connectToWhatsApp();
    return { success: true };
}

// Removed redundant isHistorySyncing let declaration here as it moved to global scope
async function connectToWhatsApp() {
    try {
        console.log('Initializing WhatsApp connection...');
        
        // MongoDB Auth State Fallback Logic
        let state, saveCreds;
        const isMongoConnected = mongoose.connection.readyState === 1;

        if (process.env.MONGODB_URI && isMongoConnected) {
            try {
                const mongoAuth = await useMongoAuthState('production-session');
                state = mongoAuth.state;
                saveCreds = mongoAuth.saveCreds;
                console.log('✅ Using MongoDB Auth state');
            } catch (authErr) {
                console.error('❌ Failed to load MongoDB Auth state, falling back to local:', authErr.message);
                const fileAuth = await useMultiFileAuthState('auth_info');
                state = fileAuth.state;
                saveCreds = fileAuth.saveCreds;
            }
        } else {
            const fileAuth = await useMultiFileAuthState('auth_info');
            state = fileAuth.state;
            saveCreds = fileAuth.saveCreds;
            console.log(isMongoConnected ? '⚠️ process.env.MONGODB_URI not provided. Using local file Auth.' : '⚠️ MongoDB not connected. Falling back to local file Auth.');
        }

        const { version } = await fetchLatestBaileysVersion();
        console.log('Latest Baileys version:', version);

        sock = makeWASocket({
            version,
            auth: state,
            logger: logger,
            browser: ["Watsaap Broadcast", "Chrome", "1.0.0"],
            getMessage: async (key) => {
                return { conversation: 'Hello' };
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('[WA] QR Code received');
                qrCodeData = qr;
                try {
                    const qrImage = await qrcode.toDataURL(qr);
                    io.emit('qr', qrImage);
                } catch (qrErr) {
                    console.error('[WA] Failed to emit QR image:', qrErr);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || 'Unknown reason';
                console.log(`[WA] Connection closed: ${reason} (Code: ${statusCode})`);
                
                qrCodeData = null;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    console.log('[WA] Reconnecting in 5s...');
                    connectionStatus = 'reconnecting';
                    io.emit('status', { status: 'reconnecting', message: 'Reconnecting...' });
                    
                    if (sock) {
                        sock.ev.removeAllListeners();
                    }
                    setTimeout(() => connectToWhatsApp(), 5000);
                } else {
                    console.log('[WA] Logged out or Unauthorized. Clearing session and regenerating QR...');
                    connectionStatus = 'disconnected';
                    qrCodeData = null; // Clear old QR 
                    
                    // Attempt to clear local session data to ensure fresh QR
                    if (fs.existsSync('auth_info')) {
                        try { fs.rmSync('auth_info', { recursive: true, force: true }); } catch (e) {}
                    }
                    
                    io.emit('status', { status: 'disconnected', message: 'Session expired. Resetting...' });
                    
                    // Force a restart of the connection to get a NEW QR
                    setTimeout(() => connectToWhatsApp(), 2000);
                }
            } else if (connection === 'connecting') {
                console.log('[WA] Connecting...');
                connectionStatus = 'connecting';
                io.emit('status', { status: 'connecting' });
            } else if (connection === 'open') {
                console.log('[WA] Connection opened successfully');
                connectionStatus = 'connected';
                qrCodeData = null;
                io.emit('status', { status: 'connected', message: 'WhatsApp Connected!' });
                loadContacts();
            }
        });

        sock.ev.on('creds.update', saveCreds);
        
        const upsertContact = (id, data) => {
            if (!id) return;
            const existing = contactsMap.get(id) || {};
            // Prefer name from contact list, then chat subject/name
            const merged = {
                ...existing,
                ...data,
                id: id,
                name: data.name || existing.name || data.pushName || existing.pushName || data.verifiedName || existing.verifiedName || data.subject || existing.subject
            };
            contactsMap.set(id, merged);
            isContactsDirty = true;
        };

        sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
            console.log(`[WA] History Sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts (Latest: ${isLatest})`);
            isHistorySyncing = !isLatest;
            if (contacts) contacts.forEach(c => upsertContact(c.id, c));
            if (chats) chats.forEach(c => upsertContact(c.id, c));
            loadContacts();
        });

        sock.ev.on('contacts.set', ({ contacts }) => {
            console.log(`[WA] Contacts Set: ${contacts?.length || 0} contacts received`);
            if (contacts) contacts.forEach(c => upsertContact(c.id, c));
            loadContacts();
        });

        sock.ev.on('contacts.upsert', (contacts) => {
            contacts.forEach(c => upsertContact(c.id, c));
            loadContacts();
        });

        sock.ev.on('chats.set', ({ chats }) => {
            console.log(`[WA] Chats Set: ${chats?.length || 0} chats received`);
            if (chats) chats.forEach(c => upsertContact(c.id, c));
            loadContacts();
        });

        sock.ev.on('chats.upsert', (chats) => {
            chats.forEach(c => upsertContact(c.id, c));
            loadContacts();
        });

        sock.ev.on('chats.update', (updates) => {
            updates.forEach(u => upsertContact(u.id, u));
            loadContacts();
        });

        sock.ev.on('contacts.update', (updates) => {
            updates.forEach(u => upsertContact(u.id, u));
            console.log('[WA] Contacts updated:', updates.length);
            loadContacts();
        });

        sock.ev.on('messages.update', async (updates) => {
            for (const { key, update } of updates) {
                if (update.status) {
                    const statusMap = { 1: 'PENDING', 2: 'SENT', 3: 'DELIVERED', 4: 'READ', 5: 'PLAYED' };
                    console.log(`Message Update [${key.id}]: Status ${statusMap[update.status] || update.status} for ${key.remoteJid}`);
                }
            }
        });

    } catch (err) {
        console.error('Connection error:', err.message);
        setTimeout(() => connectToWhatsApp(), 5000);
    }
}

let loadContactsTimeout = null;
async function loadContacts() {
    // Debounce contact loading to prevent high-frequency Socket.io broadcasts
    if (loadContactsTimeout) clearTimeout(loadContactsTimeout);
    
    loadContactsTimeout = setTimeout(async () => {
        try {
            if (contactsMap.size > 0) {
                const contactsArray = Array.from(contactsMap.values());
                contactList = contactsArray
                    .filter(c => c && (c.jid || c.id)) 
                    .map(c => {
                        const jid = c.jid || c.id;
                        const name = c.name || c.pushName || c.verifiedName || c.subject || (jid.endsWith('@broadcast') ? 'Broadcast List' : (jid.split('@')[0]));
                        return {
                            jid: jid,
                            name: name,
                            number: jid.endsWith('@broadcast') ? 'Broadcast Group' : (jid.replace('@s.whatsapp.net', '').replace('@c.us', '') || '')
                        };
                    });

                const uniqueContacts = [];
                const seen = new Set();
                for (const c of contactList) {
                    if (!seen.has(c.jid)) {
                        seen.add(c.jid);
                        uniqueContacts.push(c);
                    }
                }
                contactList = uniqueContacts;

                io.emit('contacts', contactList);
                console.log(`[Contacts] Broadcasted ${contactList.length} unique contacts`);
            }
        } catch (err) {
            console.error('Could not load contacts:', err.message);
            io.emit('error', { message: 'Failed to refresh contact list. Please try manual reload.' });
        }
    }, 2000); // 2s debounce
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

function formatJid(num) {
    if (!num) return '';
    if (num.toString().endsWith('@broadcast')) return num;
    let clean = num.toString().split('@')[0].replace(/\D/g, '');
    if (clean.length === 10) clean = '91' + clean;
    return clean + '@s.whatsapp.net';
}

async function sendMessage(jid, message, mediaPath = null) {
    try {
        if (!sock) throw new Error('WhatsApp socket is not initialized');
        const cleanJid = formatJid(jid);
        console.log(`Sending to ${cleanJid}...`);

        let response;

        if (mediaPath) {
            const mediaType = mediaPath.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? 'image' :
                mediaPath.match(/\.(mp4|mov|avi)$/i) ? 'video' : 'document';
            response = await sock.sendMessage(cleanJid, {
                [mediaType]: { url: mediaPath },
                caption: message
            });
        } else {
            response = await sock.sendMessage(cleanJid, { text: message });
        }
        console.log(`Message sent successfully: ${response.key.id}`);
        return { success: true, jid: cleanJid, messageId: response.key.id };
    } catch (err) {
        console.log(`Failed to send to ${jid}:`, err.message);
        return { success: false, jid, error: err.message };
    }
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.emit('status', {
        status: connectionStatus,
        message: connectionStatus === 'connected' ? 'WhatsApp Connected!' : 'Waiting for QR scan...'
    });

    if (qrCodeData) {
        qrcode.toDataURL(qrCodeData).then(img => {
            socket.emit('qr', img);
        });
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

app.post('/api/contacts/import', upload.single('file'), async (req, res) => {
    // Clean up uploaded dummy file to prevent disk leak
    if (req.file && fs.existsSync(req.file.path)) {
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Failed to cleanup imported file:', err);
        });
    }

    // Always fetch latest from DB if list is empty
    if (!contactList.length && contactsMap.size > 0) {
        loadContacts(); // Trigger re-generation of contactList from map
    }

    if (!contactList.length) {
        if (sock && connectionStatus === 'connected') {
            return res.json({ 
                contacts: [], 
                message: isHistorySyncing 
                    ? 'WhatsApp is still syncing history. Please wait a few moments...' 
                    : 'No contacts found. If your session is new, wait 1-2 minutes for sync to complete.'
            });
        }
        return res.json({ contacts: [], message: 'WhatsApp not connected. Please connect first.' });
    }
    res.json({ contacts: contactList });
});

app.get('/api/contacts', (req, res) => {
    res.json({ success: true, items: contactList });
});

app.post('/api/contacts', (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });

    let cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) return res.status(400).json({ error: 'Invalid phone number' });
    
    const jid = `${cleanPhone}@s.whatsapp.net`;

    const newContact = { 
        id: jid, 
        jid: jid, 
        name: name,
        notify: name,
        isCustom: true,
        updatedAt: new Date().toISOString()
    };

    contactsMap.set(jid, newContact);
    isContactsDirty = true;
    
    // Refresh the flat list used by the UI
    contactList = Array.from(contactsMap.values())
        .map(c => ({
            id: c.id || c.jid,
            jid: c.jid || c.id,
            name: c.name || c.notify || 'Unknown',
            pushname: c.notify || c.name || '',
            isCustom: c.isCustom || false
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, contact: newContact });
});

app.post('/api/contacts/force-sync', async (req, res) => {
    if (!sock || connectionStatus !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected. Please connect first.' });
    }

    console.log('[WA] Force Sync requested...');
    
    // We can't really "fetch all contacts" from a single Baileys call,
    // but we can ensure everything in contactsMap is broadcasted
    // and potentially trigger metadata updates for those without names.
    
    try {
        // Broadcast what we have immediately
        loadContacts();
        
        // Small subset of contacts to check for status/existence to trigger metadata events
        const contacts = Array.from(contactsMap.keys()).slice(0, 50); // limit to avoid rate limiting
        if (contacts.length > 0) {
            console.log(`[WA] Re-pinging metadata for ${contacts.length} contacts...`);
            // Intentionally silent - Baileys events will trigger upserts if details change
            await sock.onWhatsApp(...contacts).catch(() => {});
        }

        res.json({ 
            success: true, 
            message: 'Deep sync initiated. Contacts will populate as they arrive from WhatsApp.' 
        });
    } catch (err) {
        console.error('[WA] Force Sync error:', err);
        res.status(500).json({ error: 'Failed to initiate sync' });
    }
});

app.post('/api/admin/reset-connection', authMiddleware, async (req, res) => {
    console.log('[Admin] Manual connection reset requested');
    const result = await safeRestart();
    if (result.success) {
        res.json({ success: true, message: 'Connection restart initiated.' });
    } else {
        res.status(429).json({ success: false, error: result.error });
    }
});

app.get('/api/groups', (req, res) => {
    res.json(customGroups);
});

app.get('/api/wa-groups', async (req, res) => {
    if (!sock || connectionStatus !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    try {
        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(g => ({
            jid: g.id,
            name: g.subject,
            membersCount: g.participants.length
        }));
        res.json(groupList);
    } catch (err) {
        console.error('Failed to fetch WA groups:', err);
        res.status(500).json({ error: 'Failed to fetch WhatsApp groups' });
    }
});

app.post('/api/groups', async (req, res) => {
    const { name, members, oldName } = req.body;
    if (!name || !members || !Array.isArray(members)) {
        return res.status(400).json({ error: 'Name and members array required' });
    }

    // Strict validation for members
    if (!members.every(m => typeof m === 'string' && (m.endsWith('@s.whatsapp.net') || m.endsWith('@g.us')))) {
        return res.status(400).json({ error: 'All members must be valid WhatsApp JIDs (strings)' });
    }

    const validMembers = members.filter(m => m && m.includes('@'));
    if (validMembers.length === 0) {
        return res.status(400).json({ error: 'At least one valid member JID required' });
    }

    // Handle Rename: If oldName is provided and different, delete old entry first
    if (oldName && oldName !== name) {
        customGroups = customGroups.filter(g => g.name !== oldName);
    }

    const index = customGroups.findIndex(g => g.name === name);
    if (index >= 0) {
        customGroups[index].members = validMembers;
    } else {
        customGroups.push({ name, members: validMembers });
    }
    await saveGroups();
    res.json({ success: true, group: customGroups[index >= 0 ? index : customGroups.length - 1] });
});

app.delete('/api/groups/:name', async (req, res) => {
    const name = decodeURIComponent(req.params.name);
    console.log(`[Groups API] Deleting group: ${name}`);
    customGroups = customGroups.filter(g => g.name !== name);
    await saveGroups();
    res.json({ success: true });
});

app.get('/api/debug/contacts', (req, res) => {
    const raw = Array.from(contactsMap.entries());
    res.json({
        total: raw.length,
        items: raw.map(([id, c]) => ({ id, ...c }))
    });
});

app.post('/api/contacts/clear', async (req, res) => {
    console.log('[Contacts API] Clearing all contacts...');
    contactsMap.clear();
    contactList = [];
    isContactsDirty = false;

    try {
        if (process.env.MONGODB_URI) await Contact.deleteMany({});
        io.emit('contacts', []);
        res.json({ success: true, message: 'All contacts cleared' });
    } catch (err) {
        console.error('Failed to clear contacts.json:', err);
        res.status(500).json({ error: 'Failed to clear contacts file' });
    }
});

app.post('/api/contacts/add', async (req, res) => {
    const { numbers } = req.body;
    if (!numbers || !Array.isArray(numbers)) {
        return res.status(400).json({ error: 'Invalid numbers array' });
    }

    // Filter to ensure input parsing won't crash
    const validNumbers = numbers.filter(num => typeof num === 'string');

    const newContacts = validNumbers.map(num => {
        const jid = formatJid(num);
        return {
            jid: jid,
            name: num,
            number: jid.split('@')[0]
        };
    });
    res.json({ contacts: newContacts });
});

app.post('/api/send/bulk', upload.single('media'), async (req, res) => {
    if (!sock || connectionStatus !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    const { recipients, message } = req.body;
    let recipientsList = [];

    try {
        recipientsList = typeof recipients === 'string' ? JSON.parse(recipients) : recipients;
    } catch {
        return res.status(400).json({ error: 'Invalid recipients format' });
    }

    if (!recipientsList || recipientsList.length === 0) {
        return res.status(400).json({ error: 'No recipients provided' });
    }

    if (recipientsList.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 recipients allowed' });
    }

    const mediaPath = req.file ? req.file.path : null;

    res.json({
        success: true,
        message: 'Bulk sending job started',
        summary: { total: recipientsList.length, sent: 0, failed: 0 }
    });

    (async () => {
        const results = [];
        let success = 0;
        let failed = 0;

        const DELAY_BETWEEN_MESSAGES_MIN = parseInt(process.env.MESSAGE_DELAY_MIN) || 4;
        const DELAY_BETWEEN_MESSAGES_MAX = parseInt(process.env.MESSAGE_DELAY_MAX) || 9;
        const DELAY_BETWEEN_BATCHES = parseInt(process.env.BATCH_DELAY) || 30;
        const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 35;

        for (let i = 0; i < recipientsList.length; i++) {
            const recipient = recipientsList[i];
            const jid = recipient.jid || recipient.number;

            io.emit('sending-progress', {
                current: i + 1,
                total: recipientsList.length,
                recipient: recipient.name || recipient.number,
                status: 'sending'
            });

            const result = await sendMessage(jid, message, mediaPath);
            results.push(result);

            if (result.success) {
                success++;
                io.emit('sending-progress', {
                    current: i + 1,
                    total: recipientsList.length,
                    recipient: recipient.name || recipient.number,
                    status: 'sent'
                });
            } else {
                failed++;
            }

            if (i < recipientsList.length - 1) {
                const delay = randomDelay(DELAY_BETWEEN_MESSAGES_MIN, DELAY_BETWEEN_MESSAGES_MAX);
                await new Promise(resolve => setTimeout(resolve, delay));

                if ((i + 1) % BATCH_SIZE === 0) {
                    io.emit('sending-progress', {
                        current: i + 1,
                        total: recipientsList.length,
                        recipient: 'Taking a break...',
                        status: 'waiting'
                    });
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES * 1000));
                }
            }
        }

        io.emit('sending-progress', {
            current: recipientsList.length,
            total: recipientsList.length,
            status: 'complete',
            summary: { total: recipientsList.length, sent: success, failed }
        });

        if (mediaPath && fs.existsSync(mediaPath)) {
            try {
                fs.unlinkSync(mediaPath);
            } catch (cleanupError) {
                console.error('Failed to clear uploaded file:', cleanupError);
            }
        }
    })();
});

// ── Broadcast Lists API ──────────────────────────────────────────
app.get('/api/broadcast-lists', (req, res) => {
    res.json(broadcastLists);
});

app.post('/api/broadcast-lists', async (req, res) => {
    const { name, description, members } = req.body;
    if (!name || !Array.isArray(members)) {
        return res.status(400).json({ error: 'Name and members array required' });
    }
    const validMembers = members.filter(m => m && typeof m === 'string' && m.includes('@'));
    if (validMembers.length === 0) {
        return res.status(400).json({ error: 'At least one valid member JID required' });
    }
    const existing = broadcastLists.findIndex(l => l.id === req.body.id);
    if (existing >= 0) {
        broadcastLists[existing] = { ...broadcastLists[existing], name, description: description || '', members: validMembers, updatedAt: new Date().toISOString() };
        await saveBroadcastLists();
        return res.json({ success: true, list: broadcastLists[existing] });
    }
    const newList = { id: Date.now().toString(), name, description: description || '', members: validMembers, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    broadcastLists.push(newList);
    await saveBroadcastLists();
    res.json({ success: true, list: newList });
});

app.put('/api/broadcast-lists/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, members } = req.body;
    const idx = broadcastLists.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Broadcast list not found' });
    const validMembers = Array.isArray(members) ? members.filter(m => m && typeof m === 'string' && m.includes('@')) : broadcastLists[idx].members;
    broadcastLists[idx] = { ...broadcastLists[idx], name: name || broadcastLists[idx].name, description: description !== undefined ? description : broadcastLists[idx].description, members: validMembers, updatedAt: new Date().toISOString() };
    await saveBroadcastLists();
    res.json({ success: true, list: broadcastLists[idx] });
});

app.delete('/api/broadcast-lists/:id', async (req, res) => {
    const { id } = req.params;
    const before = broadcastLists.length;
    broadcastLists = broadcastLists.filter(l => l.id !== id);
    if (broadcastLists.length === before) return res.status(404).json({ error: 'Broadcast list not found' });
    await saveBroadcastLists();
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        contactCount: contactList.length
    });
});

app.post('/api/logout', async (req, res) => {
    try {
        if (sock) {
            try {
                await sock.logout();
            } catch (logoutErr) {
                console.error('Error during WhatsApp socket logout:', logoutErr.message);
            }
            sock = null;
        }
        connectionStatus = 'disconnected';
        qrCodeData = null;
        contactList = [];
        
        // Clear MongoDB if connected
        const isMongoConnected = mongoose.connection.readyState === 1;
        if (process.env.MONGODB_URI && isMongoConnected) {
            try {
                await Session.deleteMany({ id: { $regex: /^production-session/ } });
                console.log('✅ Successfully cleared MongoDB session data');
            } catch (mongoErr) {
                console.error('❌ Failed to clear MongoDB session:', mongoErr.message);
            }
        }
        
        // ALWAYS check for and clear local session as a fallback or parallel state
        if (fs.existsSync('auth_info')) {
            try {
                fs.rmSync('auth_info', { recursive: true, force: true });
                console.log('✅ Successfully cleared auth_info session data');
            } catch (rmErr) {
                console.error('❌ Failed to cleanup auth_info directory:', rmErr.message);
            }
        }

        // Restart connection to generate a new QR
        setTimeout(() => {
            connectToWhatsApp().catch(err => console.error('Restart failed:', err));
        }, 1000);

        res.json({ success: true, message: 'Session cleared, restarting connection...' });
    } catch (err) {
        console.error('Fatal error during logout sequence:', err);
        res.status(500).json({ success: false, error: 'Internal server error during logout' });
    }
});

const PORT = process.env.PORT || 3000;

const log = (...args) => {
    console.log(`[${new Date().toISOString()}]`, ...args);
};

const errorLog = (...args) => {
    console.error(`[${new Date().toISOString()}] ERROR:`, ...args);
};

if (process.env.NODE_ENV !== 'test') {
    server.listen(PORT, () => {
        log('========================================');
        log(`🚀 Watsaap Broadcast Server running on http://localhost:${PORT}`);
        log('========================================');
        connectToWhatsApp();
    });
}

export { app, server, sendMessage, randomDelay, contactsMap };

// ── RENDER KEEP-ALIVE PINGER ─────────────────────────────────────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
    console.log(`🚀 Keep-alive pinger active for: ${RENDER_URL}`);
    setInterval(async () => {
        try {
            const res = await fetch(`${RENDER_URL}/api/ping`);
            const data = await res.json();
            console.log(`[Pinger] Ping successful: ${data.status}`);
        } catch (e) {
            console.error('[Pinger] Ping failed:', e.message);
        }
    }, 14 * 60 * 1000); // Every 14 minutes (Render sleeps after 15)
}

