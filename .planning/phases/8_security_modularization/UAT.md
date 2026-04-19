# Phase 8: Security & Modularization - UAT

## User Acceptance Criteria

### Security
- [ ] Unauthorized users cannot fetch contacts or groups.
- [ ] API key must be persistent in `sessionStorage` after login.
- [ ] Logout deletes stored API key and cleans up auth session files.

### Modularization
- [ ] The app looks exactly as it did before the split.
- [ ] All interactive elements (Tabs, Buttons, QR scanner) remain functional.
- [ ] `index.html` file size is reduced by >90%.

### Performance & Reliability
- [ ] Contacts are saved to disk with a delay (`isDirty` logic) to prevent corruption.
- [ ] Batch size and message delay can be modified in `.env` without server restarts.
- [ ] server.js no longer exits silently on session expiration.
