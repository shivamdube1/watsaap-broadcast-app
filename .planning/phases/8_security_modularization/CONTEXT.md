# Phase 8: Security & Modularization - CONTEXT

## Background
The application grew quickly, resulting in a monolithic `index.html` file that combined template, styles, and logic. This made the codebase hard to maintain and debug. Additionally, the API lacked an authentication layer, posing a security risk for data persistence (`contacts.json`, `groups.json`).

## Goals
1. **Modularization**: Extract embedded CSS and JS from `index.html` into separate files (`public/style.css`, `public/app.js`) to improve separation of concerns.
2. **Security**: Implement an API key-based authentication middleware to protect all sensitive endpoints.
3. **Reliability**: Optimize file I/O for `contacts.json` and fix swallowed exceptions in the logout sequence.

## Constraints
- Must remain compatible with current Socket.io logic.
- Must not break the PWA installation flow.
- Must use existing dependencies (`express`, `socket.io`, `vitest`).
