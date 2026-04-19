# Structure

## Directory Overview

- **`/`**: Root directory containing core logic and configuration.
- **`public/`**: Frontend assets (HTML, CSS, JS).
- **`auth_info/`**: Local backup storage for multi-file authentication state.
- **`tests/`**: Unit and integration test suites.
- **`uploads/`**: Temporary storage for media files before broadcasting.
- **`.planning/`**: GSD metadata and codebase audit documents.

## Key Files

### Backend
- **`server.js`**: The monolithic core. Handles Express routing, Socket.io, and WhatsApp lifecycle.
- **`mongoAuthState.js`**: Custom Baileys authentication provider for MongoDB storage.
- **`models.js`**: Mongoose schemas for Contacts, Groups, Broadcast Lists, and Sessions.

### Frontend
- **`public/index.html`**: SPA dashboard structure.
- **`public/app.js`**: Frontend logic (Socket.io listeners, API calls, DOM manipulation).
- **`public/style.css`**: Premium glassmorphism UI styles.

### Configuration
- **`.env`**: Private environment variables (Credentials, Delays).
- **`package.json`**: Dependencies and startup scripts.
- **`render.yaml`**: Infrastructure-as-Code for Render deployment.
