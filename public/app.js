/* public/app.js - Modern Broadcast Pro Logic */

const socket = io();

// State Management
let state = {
    isConnected: false,
    contacts: [],
    waGroups: [],
    customGroups: [],
    selectedRecipients: [], // Array of {jid, name, type}
    currentSection: 'dashboard',
    currentGroupTab: 'wa',
    selectedFile: null,
    editingGroup: null, // Name of group being edited
    cache: {
        contacts: null,
        groups: null,
        waGroups: null,
        lastFetch: 0
    }
};

const CACHE_TTL = 30000; // 30 seconds

// ── HELPERS ─────────────────────────────────────────────────────
async function fetchWithAuth(url, options = {}) {
    const apiKey = sessionStorage.getItem('broadcast_api_key');
    const headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(options.headers || {})
    };
    
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 && url !== '/api/login') {
        handleLogout();
        throw new Error('Unauthorized');
    }
    return res;
}

// ── INITIALIZATION ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const apiKey = sessionStorage.getItem('broadcast_api_key');
    if (apiKey) {
        document.getElementById('loginOverlay').style.opacity = '0';
        setTimeout(() => document.getElementById('loginOverlay').style.display = 'none', 500);
        refreshData();
        fetchQR();
    }
});

// ── AUTHENTICATION ──────────────────────────────────────────────
async function handleLogin() {
    const btn = document.querySelector('#loginOverlay .btn-primary');
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const err = document.getElementById('loginError');

    if (!username || !password) {
        err.textContent = 'Please enter both username and password';
        err.style.display = 'block';
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
    btn.disabled = true;
    err.style.display = 'none';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (res.ok) {
            const data = await res.json();
            sessionStorage.setItem('broadcast_api_key', data.apiKey);
            document.getElementById('loginOverlay').style.opacity = '0';
            setTimeout(() => document.getElementById('loginOverlay').style.display = 'none', 500);
            refreshData();
        } else {
            const data = await res.json().catch(() => ({ error: 'Login failed' }));
            err.textContent = data.error || 'Invalid credentials';
            err.style.display = 'block';
        }
    } catch (e) {
        console.error('Login request failed:', e);
        err.textContent = 'Server is currently offline. Please wait 10s and try again.';
        err.style.display = 'block';
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function handleLogout() {
    try {
        await fetchWithAuth('/api/logout', { method: 'POST' });
    } catch (e) {}
    sessionStorage.removeItem('broadcast_api_key');
    window.location.reload();
}

// ── NAVIGATION ──────────────────────────────────────────────────
function showSection(sectionId, element) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    
    state.currentSection = sectionId;

    if (sectionId === 'contacts') renderContacts();
    if (sectionId === 'groups') refreshGroups();
}

function switchGroupTab(tab, element) {
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    state.currentGroupTab = tab;
    document.getElementById('waGroupsList').style.display = tab === 'wa' ? 'block' : 'none';
    document.getElementById('customGroupsList').style.display = tab === 'custom' ? 'block' : 'none';
    
    renderGroups();
}

// ── CORE DATA FETCHING ──────────────────────────────────────────
async function refreshData() {
    try {
        const [statusRes, contactsRes] = await Promise.all([
            fetchWithAuth('/api/status'),
            fetchWithAuth('/api/contacts')
        ]);

        const status = await statusRes.json();
        updateStatusDisplay(status.status);

        const contactsData = await contactsRes.json();
        // Backend now returns jid, name, number directly
        state.contacts = Array.isArray(contactsData.items) ? contactsData.items.filter(c => {
            if (!c.jid) return false;
            // Filter out broadcasts, but allow groups if they are in the contacts list (or keep it strictly to people)
            return !c.jid.includes('@broadcast');
        }) : [];

        document.getElementById('statContacts').textContent = state.contacts.length;
        renderContacts();
        updateLastSynced();
    } catch (e) {
        console.warn('Refresh failed:', e);
    }
}

async function refreshGroups(force = false) {
    const now = Date.now();
    if (!force && state.cache.lastFetch && (now - state.cache.lastFetch < CACHE_TTL)) {
        renderGroups();
        return;
    }

    try {
        const [waRes, customRes] = await Promise.all([
            fetchWithAuth('/api/wa-groups'),
            fetchWithAuth('/api/groups')
        ]);

        if (waRes.ok) state.waGroups = await waRes.json();
        if (customRes.ok) state.customGroups = await customRes.json();

        state.cache.lastFetch = now;
        document.getElementById('statGroups').textContent = state.waGroups.length + state.customGroups.length;
        renderGroups();
    } catch (e) {
        console.error('Groups refresh failed:', e);
    }
}

// ── UI RENDERING ────────────────────────────────────────────────
function updateStatusDisplay(status) {
    const badge = document.getElementById('statusBadge');
    const text = document.getElementById('statusText');
    const qrPlaceholder = document.getElementById('qrPlaceholder');
    const qrImage = document.getElementById('qrImage');

    state.isConnected = (status === 'connected');
    
    if (state.isConnected) {
        badge.className = 'status-badge connected';
        badge.innerHTML = '<i class="fas fa-circle"></i> Connected';
        text.textContent = 'WhatsApp is Active';
        qrPlaceholder.style.display = 'flex';
        qrImage.style.display = 'none';
        document.getElementById('refreshQRBtn').style.display = 'none';
    } else {
        badge.className = 'status-badge disconnected';
        badge.innerHTML = '<i class="fas fa-circle"></i> Offline';
        text.textContent = 'Scan QR to connect';
        qrPlaceholder.style.display = 'none';
        qrImage.style.display = 'block';
        document.getElementById('refreshQRBtn').style.display = 'inline-block';
        fetchQR();
    }
}

async function fetchQR() {
    if (state.isConnected) return;
    const qrImage = document.getElementById('qrImage');
    const text = document.getElementById('statusText');
    
    try {
        const res = await fetchWithAuth('/api/qr');
        const data = await res.json();
        if (data.qr) {
            qrImage.src = data.qr;
            qrImage.style.opacity = '1';
            text.textContent = 'Scan QR to connect';
        } else {
            qrImage.src = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width%3D%22200%22 height%3D%22200%22 viewBox%3D%220 0 200 200%22%3E%3Crect width%3D%22200%22 height%3D%22200%22 fill%3D%22%232a3942%22%2F%3E%3Ctext x%3D%2250%25%22 y%3D%2250%25%22 dominant-baseline%3D%22middle%22 text-anchor%3D%22middle%22 fill%3D%22%238696a0%22 font-family%3D%22Outfit%22 font-size%3D%2214%22%3EGenerating...%3C%2Ftext%3E%3C%2Fsvg%3E';
            qrImage.style.opacity = '0.5';
            text.textContent = 'Generating QR... Please wait';
        }
    } catch (e) {
        console.warn('Failed to fetch QR:', e);
    }
}

// ── AVATAR HELPERS ──────────────────────────────────────────────
const AVATAR_COLORS = ['#25D366','#00a884','#00BCD4','#9C27B0','#FF9800','#E91E63','#3F51B5','#009688'];
function getAvatarColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function getInitials(name) {
    const parts = (name || '?').trim().split(/\s+/);
    return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (parts[0][0] || '?').toUpperCase();
}

function renderContacts() {
    const container = document.getElementById('contactsListItems');
    if (!container) return;

    if (!state.contacts.length) {
        container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-dim);">
            <i class="fas fa-address-book" style="font-size:40px;margin-bottom:12px;opacity:.4;display:block;"></i>
            <p style="font-size:14px;">No contacts yet</p>
            <p style="font-size:12px;margin-top:6px;opacity:.7;">Tap <strong>Sync</strong> to import from WhatsApp</p>
        </div>`;
        return;
    }

    container.innerHTML = state.contacts.map(c => {
        const initials = getInitials(c.name);
        const color = getAvatarColor(c.jid || c.name);
        const selected = isRecipient(c.jid);
        return `
        <div class="item-row ${selected ? 'selected' : ''}" onclick="toggleRecipient('${c.jid}', '${c.name.replace(/'/g,"\\'")}', 'contact')">
            <div class="avatar-circle" style="background:${color};">${initials}</div>
            <div class="item-info">
                <h4>${c.name}</h4>
                <p>${c.number}</p>
            </div>
            <i class="fas ${selected ? 'fa-check-circle' : 'fa-circle'}" style="margin-left:auto;flex-shrink:0;font-size:18px;color:${selected ? 'var(--primary)' : 'rgba(255,255,255,.2)'}"></i>
        </div>`;
    }).join('');
}

function updateLastSynced() {
    const label = document.getElementById('lastSyncedLabel');
    const time = document.getElementById('lastSyncedTime');
    if (!label || !time) return;
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    label.style.display = 'block';
}

function renderGroups() {
    const waList    = document.getElementById('waGroupsList');
    const customList = document.getElementById('customGroupsList');

    if (waList) {
        if (!state.waGroups.length) {
            waList.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-dim);">
                <i class="fab fa-whatsapp" style="font-size:40px;margin-bottom:12px;opacity:.4;display:block;"></i>
                <p style="font-size:14px;">No WhatsApp groups found</p>
                <p style="font-size:12px;margin-top:6px;opacity:.7;">Connect WhatsApp to sync groups</p>
            </div>`;
        } else {
            waList.innerHTML = state.waGroups.map(g => {
                const color = getAvatarColor(g.jid || g.name);
                const initials = getInitials(g.name);
                const sel = isRecipient(g.jid);
                return `
                <div class="item-row ${sel ? 'selected' : ''}" onclick="toggleRecipient('${g.jid}', '${g.name.replace(/'/g,"\\'")}', 'group')">
                    <div class="avatar-circle" style="background:${color};">${initials}</div>
                    <div class="item-info">
                        <h4>${g.name}</h4>
                        <p><i class="fas fa-users" style="margin-right:4px;"></i>${g.membersCount} participants</p>
                    </div>
                    <i class="fas ${sel ? 'fa-check-circle' : 'fa-circle'}" style="margin-left:auto;flex-shrink:0;font-size:18px;color:${sel ? 'var(--primary)' : 'rgba(255,255,255,.2)'}"></i>
                </div>`;
            }).join('');
        }
    }

    if (customList) {
        if (!state.customGroups.length) {
            customList.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-dim);">
                <i class="fas fa-layer-group" style="font-size:40px;margin-bottom:12px;opacity:.4;display:block;"></i>
                <p style="font-size:14px;">No custom lists yet</p>
                <p style="font-size:12px;margin-top:6px;opacity:.7;">Select contacts &amp; tap Save Group</p>
            </div>`;
        } else {
            customList.innerHTML = state.customGroups.map(g => {
                const color = getAvatarColor(g.name);
                const initials = getInitials(g.name);
                const sel = isRecipient(g.name);
                return `
                <div class="item-row ${sel ? 'selected' : ''}" onclick="toggleRecipient('${g.name}', '${g.name.replace(/'/g,"\\'")}', 'custom')">
                    <div class="avatar-circle" style="background:${color};">${initials}</div>
                    <div class="item-info">
                        <h4>${g.name}</h4>
                        <p><i class="fas fa-user" style="margin-right:4px;"></i>${g.members.length} members</p>
                    </div>
                    <div style="margin-left:auto;display:flex;gap:14px;align-items:center;flex-shrink:0;">
                        <button style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:16px;padding:6px;" onclick="event.stopPropagation();editCustomGroup('${g.name}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:16px;padding:6px;" onclick="event.stopPropagation();deleteCustomGroup('${g.name}')" title="Delete"><i class="fas fa-trash"></i></button>
                        <i class="fas ${sel ? 'fa-check-circle' : 'fa-circle'}" style="font-size:18px;color:${sel ? 'var(--primary)' : 'rgba(255,255,255,.2)'}"></i>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

// ── RECIPIENT MANAGEMENT ───────────────────────────────────────
function toggleRecipient(jid, name, type) {
    const idx = state.selectedRecipients.findIndex(r => r.jid === jid);
    if (idx > -1) {
        state.selectedRecipients.splice(idx, 1);
    } else {
        state.selectedRecipients.push({ jid, name, type });
    }
    
    updateSelectionUI();
    if (state.currentSection === 'contacts') renderContacts();
    if (state.currentSection === 'groups') renderGroups();
}

function isRecipient(jid) {
    return state.selectedRecipients.some(r => r.jid === jid);
}

function updateSelectionUI() {
    const count = state.selectedRecipients.length;
    const text = document.getElementById('broadcastSelectionText');
    if (text) text.textContent = count > 0 ? `${count} selected` : 'None';

    // Handle Edit Mode UI
    const saveBtn = document.getElementById('saveGroupBtn');
    const cancelBtn = document.getElementById('cancelGroupEditBtn');
    
    if (state.editingGroup) {
        if (saveBtn) {
            const sp = saveBtn.querySelector('span');
            if (sp) sp.textContent = `Update: ${state.editingGroup}`;
            saveBtn.classList.remove('secondary'); saveBtn.classList.add('primary');
        }
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    } else {
        if (saveBtn) {
            const sp = saveBtn.querySelector('span');
            if (sp) sp.textContent = 'Save Group';
            saveBtn.classList.remove('primary'); saveBtn.classList.add('secondary');
        }
        if (cancelBtn) cancelBtn.style.display = 'none';
    }
}

// ── ACTIONS ───────────────────────────────────────────────────
async function deepSyncContacts() {
    const btn = document.getElementById('deepSyncBtn');
    if (!btn) return;

    if (!state.isConnected) {
        alert('WhatsApp is offline. Please scan the QR code first.');
        return;
    }

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    btn.disabled = true;
    
    try {
        // Ensure loading state is visible for at least 1s
        const [res] = await Promise.all([
            fetchWithAuth('/api/contacts/force-sync', { method: 'POST' }),
            new Promise(resolve => setTimeout(resolve, 1000))
        ]);

        const data = await res.json();
        
        if (data.success) {
            alert(data.message || 'Deep sync triggered. Contacts will populate gradually.');
            await refreshData();
        } else {
            alert(data.error || 'Failed to trigger deep sync');
        }
    } catch (e) {
        console.error('Deep sync error:', e);
        alert('Deep sync failed: ' + e.message);
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

async function importWhatsAppContacts() {
    try {
        const btn = event.currentTarget || event.target;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        btn.disabled = true;
        
        const res = await fetchWithAuth('/api/contacts/import', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Contacts sync triggered. Please wait a few moments.');
        await refreshData();
        
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    } catch (e) {
        alert('Sync failed');
    }
}

async function saveAsCustomGroup() {
    const individualContacts = state.selectedRecipients.filter(r => r.type === 'contact' || r.type === 'custom-manual');
    const jids = individualContacts.map(r => r.jid);
    
    if (jids.length === 0) {
        alert('Please select some contacts from the list first.');
        return;
    }

    const defaultName = state.editingGroup || '';
    const name = prompt(state.editingGroup ? `Update group members? You can also rename it:` : 'Enter a name for this custom group:', defaultName);
    
    if (!name) return;

    try {
        const payload = { 
            name, 
            members: jids,
            oldName: state.editingGroup 
        };

        const res = await fetchWithAuth('/api/groups', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert(state.editingGroup ? 'Group updated successfully!' : 'Group saved successfully!');
            state.editingGroup = null;
            state.selectedRecipients = []; // Clear selection after saving
            updateSelectionUI();
            refreshGroups(true);
            showSection('groups', document.querySelector('[onclick*="groups"]'));
        } else {
            const data = await res.json();
            alert('Failed to save group: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Failed to save group:', e);
        alert('Error saving group');
    }
}

function editCustomGroup(name) {
    const group = state.customGroups.find(g => g.name === name);
    if (!group) return;

    // Load group members into selection
    // Note: members in customGroups are just JIDs. We need to find their names in state.contacts if possible.
    state.selectedRecipients = group.members.map(jid => {
        const contact = state.contacts.find(c => c.jid === jid);
        return {
            jid,
            name: contact ? contact.name : jid.split('@')[0],
            type: 'contact'
        };
    });

    state.editingGroup = name;
    updateSelectionUI();
    showSection('contacts', document.querySelector('[onclick*="contacts"]'));
    renderContacts();
}

function cancelGroupEdit() {
    state.editingGroup = null;
    state.selectedRecipients = [];
    updateSelectionUI();
    renderContacts();
    alert('Edit cancelled. Selection cleared.');
}

async function deleteCustomGroup(name) {
    if (!confirm(`Delete group "${name}"?`)) return;
    try {
        await fetchWithAuth(`/api/groups/${encodeURIComponent(name)}`, { method: 'DELETE' });
        refreshGroups(true);
    } catch (e) {
        alert('Failed to delete group');
    }
}

// ── BROADCAST LOGIC ───────────────────────────────────────────
function handleMediaPreview(input) {
    const file = input.files[0];
    if (!file) return;
    state.selectedFile = file;
    
    const preview = document.getElementById('mediaPreview');
    const img = document.getElementById('previewImg');
    
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else {
        img.src = 'https://cdn-icons-png.flaticon.com/512/337/337947.png';
        preview.style.display = 'block';
    }
}

function clearMedia() {
    state.selectedFile = null;
    document.getElementById('mediaInput').value = '';
    document.getElementById('mediaPreview').style.display = 'none';
}

// ── CONTACT MANAGEMENT ───────────────────────────────────────────
function openAddContactModal() {
    const modal = document.getElementById('addContactModal');
    modal.classList.add('open');
    // Focus first input after animation
    setTimeout(() => {
        const inp = document.getElementById('newContactName');
        if (inp) inp.focus();
    }, 200);
}

function closeAddContactModal() {
    const modal = document.getElementById('addContactModal');
    modal.classList.remove('open');
    document.getElementById('newContactName').value = '';
    document.getElementById('newContactPhone').value = '';
}

async function submitNewContact() {
    const name = document.getElementById('newContactName').value;
    const phone = document.getElementById('newContactPhone').value.trim();
    const btn = document.getElementById('submitContactBtn');

    if (!name || !phone) {
        alert('Please enter both name and phone number');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
        const res = await fetchWithAuth('/api/contacts', {
            method: 'POST',
            body: JSON.stringify({ name, phone })
        });
        
        if (res.ok) {
            closeAddContactModal();
            document.getElementById('newContactName').value = '';
            document.getElementById('newContactPhone').value = '';
            await refreshData();
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to save contact');
        }
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Create';
    }
}

async function startBroadcast() {
    if (!state.isConnected) return alert('Connect WhatsApp first');
    if (state.selectedRecipients.length === 0) return alert('Select recipients');
    const message = document.getElementById('messageText').value.trim();
    if (!message) return alert('Enter a message');

    const btn = document.getElementById('broadcastBtn');
    const progress = document.getElementById('broadcastProgress');
    
    btn.disabled = true;
    progress.style.display = 'block';

    let finalRecipients = [];
    state.selectedRecipients.forEach(r => {
        if (r.type === 'custom') {
            const group = state.customGroups.find(g => g.name === r.jid);
            if (group) {
                group.members.forEach(memberJid => {
                    const contact = state.contacts.find(c => c.jid === memberJid);
                    finalRecipients.push({ 
                        jid: memberJid, 
                        name: contact ? contact.name : memberJid 
                    });
                });
            }
        } else {
            finalRecipients.push({ jid: r.jid, name: r.name });
        }
    });

    const seen = new Set();
    finalRecipients = finalRecipients.filter(r => {
        const duplicate = seen.has(r.jid);
        seen.add(r.jid);
        return !duplicate;
    });

    const formData = new FormData();
    formData.append('recipients', JSON.stringify(finalRecipients));
    formData.append('message', message);
    if (state.selectedFile) formData.append('media', state.selectedFile);

    try {
        const apiKey = sessionStorage.getItem('broadcast_api_key');
        const res = await fetch('/api/send/bulk', { 
            method: 'POST', 
            body: formData,
            headers: { 'x-api-key': apiKey }
        });
        if (!res.ok) throw new Error('Broadcast failed to start');
    } catch (e) {
        alert(e.message);
        btn.disabled = false;
        progress.style.display = 'none';
    }
}

async function resetWhatsApp(event) {
    if (!confirm('This will disconnect your current session and generate a new QR. Proceed?')) return;
    
    const btn = event ? (event.currentTarget || event.target) : null;
    let originalText = '';
    
    if (btn) {
        originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
        btn.disabled = true;
    }

    try {
        await fetchWithAuth('/api/logout', { method: 'POST' });
        // Don't alert, just refresh status or reload
        setTimeout(() => location.reload(), 1500);
    } catch (e) {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        alert('Reset failed: ' + e.message);
    }
}

// ── SOCKET.IO HANDLERS ───────────────────────────────────────
socket.on('qr', (data) => {
    const qrImage = document.getElementById('qrImage');
    if (qrImage) qrImage.src = data;
});

socket.on('status', (data) => {
    updateStatusDisplay(data.status);
    if (data.status === 'connected') refreshData();
});

socket.on('sending-progress', (data) => {
    const fill = document.getElementById('progressFill');
    const percent = document.getElementById('progressPercent');
    const subtext = document.getElementById('progressSubtext');
    
    const p = Math.round((data.current / data.total) * 100);
    fill.style.width = p + '%';
    percent.textContent = p + '%';
    subtext.textContent = `Sent to ${data.recipient} (${data.current}/${data.total})`;

    if (data.status === 'complete') {
        alert(`Broadcast Complete!\nTotal: ${data.summary.total}\nSent: ${data.summary.sent}\nFailed: ${data.summary.failed}`);
        location.reload();
    }
});

socket.on('contacts', (contacts) => {
    console.log('[Socket] Received', contacts.length, 'contacts');
    state.contacts = contacts.filter(c => !c.jid.includes('@broadcast'));
    document.getElementById('statContacts').textContent = state.contacts.length;
    renderContacts();
});

socket.on('sync-progress', (data) => {
    const btn = document.getElementById('deepSyncBtn');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Syncing (${data.progress}%)...`;
    }
});

function filterList(inputId, listId) {
    const query = event.target.value.toLowerCase();
    const items = document.getElementById(listId).getElementsByClassName('item-row');
    
    Array.from(items).forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? 'flex' : 'none';
    });
}
