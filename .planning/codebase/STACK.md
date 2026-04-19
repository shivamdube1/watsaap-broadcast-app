# Technology Stack

## Core
- **Node.js**: v24+ (ESM modules)
- **Express**: Primary web framework for REST APIs.
- **Socket.io**: Real-time bidirectional communication.
- **Mongoose**: MongoDB object modeling.

## Messaging Interface
- **@whiskeysockets/baileys**: Core WhatsApp engine (socket and event management).
- **qrcode / qrcode-terminal**: QR code generation for login.

## Data Persistence
- **MongoDB Atlas**: Primary database for contacts, groups, and sessions.
- **auth_info/**: Backup local file system storage for session credentials.
- **Local JSON**: Legacy storage for groups (`groups.json`) and contacts (`contacts.json`) - *Transitioning to DB*.

## Utilities
- **multer**: Media upload processing.
- **pino**: High-speed JSON logging.
- **dotenv**: Environment variable management.

## Frontend
- **Vanilla JavaScript**: Real-time UI updates (non-framework).
- **CSS3**: Custom design system with glassmorphism and motion.
- **Font**: Inter (Google Fonts).
