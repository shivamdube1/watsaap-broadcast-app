# Technical Concerns & Risks

## High Priority

### 1. Monolithic Bloat (`server.js`)
- **Risk**: `server.js` is over 800 lines and contains conflicting logic (Socket.io, Express, WhatsApp Engine).
- **Impact**: Difficult to debug and prone to syntax errors (as seen in recent `PORT` duplication).
- **Mitigation**: Refactor into `services/` (WhatsApp logic) and `routes/` (Express controllers).

### 2. Job Persistence
- **Risk**: Broadcast progress is memory-resident. Re-deploying or crashing during a long broadcast loses progress.
- **Impact**: Inaccurate reporting to users.
- **Mitigation**: Implement a persistent job queue (e.g., Bull or a MongoDB-based task table).

## Medium Priority

### 3. Rate Limiting Conflicts
- **Risk**: WhatsApp's internal rate limits are dynamic.
- **Impact**: Potential account bans if too many messages are sent too quickly despite random delays.
- **Mitigation**: Implement a "Safety Switch" that pauses all broadcasts if too many "Rate limit" errors are received.

### 4. Media Storage Leak
- **Risk**: `uploads/` directory can grow indefinitely on local environments.
- **Impact**: Disk space depletion.
- **Mitigation**: Implement a cleanup job after broadcast completion.

## Low Priority / Debt

### 5. Vanilla JS State
- **Risk**: Frontend state management is imperative and scattered across `app.js`.
- **Impact**: Difficult to add complex UIs like real-time analytics.
- **Mitigation**: Consider a lightweight reactive framework (e.g., Alpine.js or Preact) if complexity scales.
