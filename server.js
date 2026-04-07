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

// Auth Middleware
const authMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.API_KEY || 'admin123';
    
    if (apiKey === validKey) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
};

// Login endpoint — not protected by authMiddleware
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const validUser = process.env.LOGIN_USERNAME || 'suraj';
    const validPass = process.env.LOGIN_PASSWORD || 'ssd0809';
    if (username === validUser && password === validPass) {
        return res.json({ success: true, apiKey: process.env.API_KEY || 'admin123' });
    }
    res.status(401).json({ error: 'Invalid username or password' });
});

// Ping endpoint for keep-awake cron jobs (unauthenticated)
app.get('/api/ping', (req, res) => res.json({ status: 'ok', time: new Date() }));

// Apply auth to all other API routes
app.use('/api', authMiddleware);

let sock = null;
let qrCodeData = null;
let connectionStatus = 'disconnected';
let contactList = [];

const logger = pino({ level: 'silent' });

const contactsMap = new Map();
if (fs.existsSync('./contacts.json')) {
    try {
        const raw = JSON.parse(fs.readFileSync('./contacts.json', 'utf8'));
        raw.forEach(c => contactsMap.set(c.id, c));
    } catch(e) {
        console.error('Failed to parse contacts.json:', e);
    }
}

let isContactsDirty = false;
setInterval(() => {
    if (!isContactsDirty) return;
    
    fs.writeFile('./contacts.json', JSON.stringify(Array.from(contactsMap.values())), (err) => {
        if (err) {
            console.error('Failed to save contacts.json:', err);
        } else {
            isContactsDirty = false;
        }
    });
}, 10000);

const groupsFile = './groups.json';
let customGroups = [];
if (fs.existsSync(groupsFile)) {
    try {
        customGroups = JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
    } catch(e) {
        customGroups = [];
    }
}
const saveGroups = () => {
    fs.writeFileSync(groupsFile, JSON.stringify(customGroups, null, 2));
};

// Broadcast Lists
const broadcastListsFile = './broadcast_lists.json';
let broadcastLists = [];
if (fs.existsSync(broadcastListsFile)) {
    try {
        broadcastLists = JSON.parse(fs.readFileSync(broadcastListsFile, 'utf8'));
    } catch(e) {
        broadcastLists = [];
    }
}
const saveBroadcastLists = () => {
    fs.writeFileSync(broadcastListsFile, JSON.stringify(broadcastLists, null, 2));
};

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

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
            console.log('Connection state:', connection);
            console.log('Has QR:', !!qr);

            if (qr) {
                console.log('\n=================================\nQR Code received! Scan it to login to WhatsApp:\n=================================\n');
                qrcodeTerminal.generate(qr, { small: true });
                qrCodeData = qr;
                const qrImage = await qrcode.toDataURL(qr);
                io.emit('qr', qrImage);
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.error('Connection closed. Error:', lastDisconnect?.error);
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    console.log('Reconnecting...');
                    connectionStatus = 'reconnecting';
                    io.emit('status', { status: 'reconnecting', message: 'Reconnecting...' });
                    setTimeout(() => connectToWhatsApp(), 5000);
                } else {
                    connectionStatus = 'disconnected';
                    io.emit('status', { status: 'disconnected', message: 'Disconnected' });
                }
            } else if (connection === 'open') {
                console.log('WhatsApp Connected!');
                connectionStatus = 'connected';
                qrCodeData = null;
                io.emit('status', { status: 'connected', message: 'WhatsApp Connected!' });
                loadContacts();
            }
        });

        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
            console.log(`History Sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts`);
        });

        sock.ev.on('contacts.upsert', (contacts) => {
            for (const c of contacts) {
                contactsMap.set(c.id, { ...(contactsMap.get(c.id) || {}), ...c });
            }
            isContactsDirty = true;
        });

        sock.ev.on('chats.update', (updates) => {
            for (const update of updates) {
                if (update.id) {
                    contactsMap.set(update.id, { ...(contactsMap.get(update.id) || {}), ...update });
                }
            }
        });

        sock.ev.on('contacts.update', (updates) => {
            for (const update of updates) {
                contactsMap.set(update.id, { ...(contactsMap.get(update.id) || {}), ...update });
            }
            console.log('Contacts updated:', updates.length);
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

async function loadContacts() {
    try {
        if (contactsMap.size > 0) {
            const contactsArray = Array.from(contactsMap.values());
            contactList = contactsArray
                .filter(c => c && (c.name || c.pushName || c.verifiedName || c.id.endsWith('@broadcast')))
                .map(c => ({
                    jid: c.id,
                    name: c.name || c.pushName || c.verifiedName || (c.id.endsWith('@broadcast') ? 'Broadcast List' : 'Unknown'),
                    number: c.id.endsWith('@broadcast') ? 'Broadcast Group' : (c.id?.replace('@s.whatsapp.net', '').replace('@c.us', '') || '')
                }));
            
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
            console.log(`Loaded ${contactList.length} contacts`);
        }
    } catch (err) {
        console.log('Could not load contacts:', err.message);
    }
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

    if (!contactList.length) {
        return res.json({ contacts: [], message: 'No contacts loaded yet' });
    }
    res.json({ contacts: contactList });
});

app.get('/api/groups', (req, res) => {
    res.json(customGroups);
});

app.post('/api/groups', (req, res) => {
    const { name, members } = req.body;
    if (!name || !members || !Array.isArray(members)) {
        return res.status(400).json({ error: 'Name and members array required' });
    }
    
    // Basic JID validation for members
    const validMembers = members.filter(m => m && typeof m === 'string' && m.includes('@'));
    if (validMembers.length === 0) {
        return res.status(400).json({ error: 'At least one valid member JID required' });
    }

    const index = customGroups.findIndex(g => g.name === name);
    if (index >= 0) {
        customGroups[index].members = validMembers;
    } else {
        customGroups.push({ name, members: validMembers });
    }
    saveGroups();
    res.json({ success: true, group: customGroups[index >=0 ? index : customGroups.length-1] });
});

app.delete('/api/groups/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name);
    console.log(`[Groups API] Deleting group: ${name}`);
    customGroups = customGroups.filter(g => g.name !== name);
    saveGroups();
    res.json({ success: true });
});

app.get('/api/debug/contacts', (req, res) => {
    const raw = Array.from(contactsMap.entries());
    res.json({
        total: raw.length,
        items: raw.map(([id, c]) => ({ id, ...c }))
    });
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

        const DELAY_BETWEEN_MESSAGES_MIN = 8;
        const DELAY_BETWEEN_MESSAGES_MAX = 15;
        const DELAY_BETWEEN_BATCHES = 60;
        const BATCH_SIZE = 20;

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

app.post('/api/broadcast-lists', (req, res) => {
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
        saveBroadcastLists();
        return res.json({ success: true, list: broadcastLists[existing] });
    }
    const newList = { id: Date.now().toString(), name, description: description || '', members: validMembers, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    broadcastLists.push(newList);
    saveBroadcastLists();
    res.json({ success: true, list: newList });
});

app.put('/api/broadcast-lists/:id', (req, res) => {
    const { id } = req.params;
    const { name, description, members } = req.body;
    const idx = broadcastLists.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Broadcast list not found' });
    const validMembers = Array.isArray(members) ? members.filter(m => m && typeof m === 'string' && m.includes('@')) : broadcastLists[idx].members;
    broadcastLists[idx] = { ...broadcastLists[idx], name: name || broadcastLists[idx].name, description: description !== undefined ? description : broadcastLists[idx].description, members: validMembers, updatedAt: new Date().toISOString() };
    saveBroadcastLists();
    res.json({ success: true, list: broadcastLists[idx] });
});

app.delete('/api/broadcast-lists/:id', (req, res) => {
    const { id } = req.params;
    const before = broadcastLists.length;
    broadcastLists = broadcastLists.filter(l => l.id !== id);
    if (broadcastLists.length === before) return res.status(404).json({ error: 'Broadcast list not found' });
    saveBroadcastLists();
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        contactCount: contactList.length
    });
});

app.post('/api/logout', async (req, res) => {
    if (sock) {
        try {
            await sock.logout();
        } catch (e) {}
        sock = null;
    }
    connectionStatus = 'disconnected';
    qrCodeData = null;
    contactList = [];
    if (fs.existsSync('auth_info')) {
        try {
            fs.rmSync('auth_info', { recursive: true, force: true });
        } catch(rmErr) {
            console.error('Failed to cleanup auth_info:', rmErr);
        }
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
    server.listen(PORT, () => {
        console.log(`\n🚀 Watsaap Broadcast Server running on http://localhost:${PORT}\n`);
        connectToWhatsApp();
    });
}

export { app, server, sendMessage, randomDelay, contactsMap };
