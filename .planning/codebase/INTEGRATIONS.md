# Integrations

## External Services

### 1. WhatsApp (via Baileys)
- **Purpose**: Core messaging, contact fetching, and group management.
- **Type**: Socket-based event stream.
- **State**: Persistent session managed via `mongoAuthState.js`.
- **Security**: QR-code based authentication; no direct credential access.

### 2. MongoDB Atlas
- **Purpose**: Global persistence for sessions, contacts, and broadcast lists.
- **Type**: Mongoose/ODM.
- **Connection**: URI-based with SRV support.
- **Persistence**: Ensures session survives Render restarts.

### 3. Render (Cloud Platform)
- **Purpose**: Hosting the Node.js server.
- **Keep-Alive**: Integrated pinger (`RENDER_EXTERNAL_URL`) prevents free-tier spin-down.
- **Environment**: Managed secrets and ephemeral storage (relying on MongoDB for state).

## Internal APIs

### 1. Contact API (`/api/contacts/*`)
- **Import**: Triggers re-population of `contactsMap` from WhatsApp and DB.
- **Clear**: Purges contact data from DB and memory.

### 2. Messaging API (`/api/send/bulk`)
- **Broadcast**: Coordinates between Socket.io progress and Baileys socket sending.
- **Validation**: Basic JID formatting and media path checks.

### 3. Group API (`/api/groups`)
- **Custom Groups**: High-level abstractions over multiple JIDs for easy targeting.
