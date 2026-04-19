# Phase 8: Security & Modularization - VERIFICATION

## Automation Tests
- **Unit/Integration**: Run `npm test` to execute Vitest suites.
  - `tests/auth.test.js` (NEW): Verify 401 response without key, 200 with key.
  - `tests/server.test.js`: Verify core API functionality still holds with auth headers.
- **Serving**: Verify `/style.css` and `/app.js` are served correctly by Express.

## Manual Verification
1. **App Launch**: Run `npm run dev`.
2. **Login Flow**:
   - Access the page in a browser.
   - Verify the login overlay appears correctly.
   - Authenticate and ensure the dashboard loads.
3. **Network Check**:
   - Open Developer Tools -> Network tab.
   - Refresh the page and confirm `style.css` and `app.js` are fetched successfully.
4. **Security Check**:
   - Try to call `/api/groups` via Postman/cURL without the `x-api-key` header.
   - Verify it returns `401 Unauthorized`.
5. **Session Cleanup**:
   - Logout and check server console for session cleanup logs.
