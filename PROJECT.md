# Watsaap Broadcast

A lightweight, localized WhatsApp bulk messaging and contact management tool.

## Goals
- **Bulk Messaging**: Send messages at scale with randomized delays to mimic human behavior.
- **Group Management**: Create and manage custom contact lists (groups) that persist locally.
- **Contact Syncing**: Automatically import and sync WhatsApp contacts for targeted outreach.
- **Media Support**: Send images, videos, and documents alongside text messages.

## Tech Stack
- **Backend**: Node.js (Express), Socket.io (Real-time updates).
- **Messaging Engine**: @whiskeysockets/baileys.
- **Frontend**: Vanilla HTML5, CSS, and JavaScript.
- **Persistence**: Local JSON file storage (`contacts.json`, `groups.json`).

## Current Status: Building Phase
The core messaging engine and group management APIs are implemented. The next steps focus on visual excellence, performance audits, and robust testing.
