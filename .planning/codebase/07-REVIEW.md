# Phase 7 Code Review: Sync Hardening & MongoDB Integration

This review covers the changes implemented during Phase 7, focusing on the socket lifecycle, data persistence, and system stability.

## Verdict: 🟡 Warning (Needs minor fixes)

| Severity | Count | Summary |
| :--- | :--- | :--- |
| 🔴 **Critical** | 1 | Potential crash vector in API input processing. |
| 🟡 **Warning** | 2 | Partial error handling and file system management issues. |
| 🔵 **Info** | 1 | Architectural technical debt. |

---

## 🔴 Critical Findings

### 1. Missing Strict Schema Validation | `app.post('/api/groups')` & `app.post('/api/send/bulk')`
- **Issue**: The `members` and `recipients` arrays are validated only for presence and basic string types. Malformed objects passed as JIDs could crash the Baileys socket when it attempts to process them for sending.
- **Risk**: Remote Denial of Service (DoS) if a user passes a complex object instead of a string.
- **Recommendation**: Implement `zod` or `joi` to strictly enforce string arrays for all JID inputs.

---

## 🟡 Warning Findings

### 2. Swallowed Exceptions | `loadContacts()` (Line 411)
- **Issue**: The `catch` block for contact loading only logs the error message. It doesn't attempt a recovery or notify the UI that the list is stale.
- **Impact**: UI might show "Syncing..." forever if a broadcast fail occurs silently.
- **Recommendation**: Emit a specialized `error` event to Socket.io so the UI can show a "Retry" prompt.

### 3. Missing Media Cleanup | `uploads/` Management
- **Issue**: While dummy files are unlinked in `/api/contacts/import`, actual broadcast media in `uploads/` stay on disk until manual deletion.
- **Impact**: Disk saturation on long-running local or server instances.
- **Recommendation**: Implement an `fs.unlink` call in the `sendMessage` callback or a periodic cleanup task.

---

## 🔵 Info Findings

### 4. Monolithic Bloat | `server.js`
- **Issue**: The file is approaching 900 lines. Route definitions are mixed with socket lifecycle and business logic.
- **Impact**: Increasing risk of regression errors during refactoring.
- **Recommendation**: Set as a priority for Milestone 3 to split logic into `services/` and `controllers/`.

---

## ✅ What's Good
- **Restart Safety**: The 120s cooldown on `safeRestart` successfully prevents infinite loops.
- **Persistence**: MongoDB auth state is working reliably with local fallbacks.
- **Lifecycle Cleanliness**: Listeners are properly removed before socket destruction.
