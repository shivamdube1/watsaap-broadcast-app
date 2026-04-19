## Code Review: `server.js`

**Verdict:** 🚫 Needs rework
**Summary:** The project has systemic security gaps (no auth), significant architectural debt (giant single-file frontend, swallowed errors), and poor maintainability.

---

### 🔴 Critical
- **Security**: No Auth Middleware | `server.js` — All `/api/*` endpoints are publicly accessible. A malicious actor on the network can trigger bulk message sends or manipulate the database. → Add a simple API key or JWT middleware.
- **Security**: Exposed Client Logic | `public/index.html` — Sensitive business logic and API endpoints are exposed in a single, unminified file.

### 🔴 High
- **Security**: Missing Input Validation | `app.post('/api/send/bulk')` — The `message` and `recipients` fields are trusted blindly. → Use a validation library like `zod` or `joi` to sanitize inputs.
- **Security**: Unprotected Session Data | `auth_info/` — Sensitive WhatsApp credentials are stored unencrypted in the file system. → Use environment-based encryption for the session state if possible.
- **Architectural Debt**: Monolithic Frontend | `public/index.html` — 1200+ lines of HTML, CSS, and JS in one file. → Separate into `style.css` and `app.js`.

### 🟡 Medium
- **Error Handling**: Swallowed Exceptions | Lines 47, 60, 433 — `catch(e) {}` blocks hide potential file system or session-teardown failures. → Add `console.error` at minimum, or trigger a proper cleanup/retry cycle.
- **Performance**: Inefficient IO | Line 49 — The entire `contacts.json` is re-written every 10 seconds. → Implement a "dirty check" or debounce the save operation only when data actually changes.
- **UX**: Imperative State Management | `public/index.html` — UI updates are scattered across manual DOM manipulations. → Consider a lightweight state manager or refactoring into smaller functions.

### 🟢 Low
- **Readability**: File Bloat | `server.js` — Core WhatsApp logic is tightly coupled with Express routes. → Separate messaging logic into a `services/` directory and routes into `routes/`.
- **Nitpick**: Hardcoded Config | Lines 359-362 — Message delays and batch sizes are hardcoded. → Move these constant values to an `.env` file or a `config.js`.

---

### ✅ What's Good
- **Reliability**: The bulk-sending logic includes smart delays and batching to avoid WhatsApp bans.
- **Real-time UX**: Good use of Socket.io for streaming progress and QR codes.

---

### Revised Code Snippets (Partial Fixes)

#### Performance & IO Optimization (Line 49)
```javascript
let isDirty = false;
sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
        contactsMap.set(c.id, { ...(contactsMap.get(c.id) || {}), ...c });
    }
    isDirty = true; // Only save when changed
});

setInterval(() => {
    if (!isDirty) return;
    fs.writeFile('./contacts.json', JSON.stringify(Array.from(contactsMap.values())), (err) => {
        if (!err) isDirty = false;
        else console.error('Failed to save contacts.json:', err);
    });
}, 10000);
```

#### Improved Error Handling (Line 60)
```javascript
if (fs.existsSync(groupsFile)) {
    try {
        customGroups = JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
    } catch(e) {
        console.error(`Critically failed to load groups from ${groupsFile}:`, e);
        customGroups = []; // Reset but log it
    }
}
```
