# Watsaap Broadcast - Free WhatsApp Bulk Messaging

A free, self-hosted WhatsApp bulk messaging application that lets you send messages to up to 100 people without any paid WhatsApp Business API.

## Features

- **100% Free** - No WhatsApp Business API costs
- **Anti-Block Protection** - Smart delays to prevent WhatsApp bans
- **QR Code Login** - Connect using your existing WhatsApp
- **Contact Import** - Load contacts directly from your WhatsApp
- **Manual Entry** - Add phone numbers manually
- **File Upload** - Import from .txt or .csv files
- **Media Support** - Send images and videos
- **Progress Tracking** - Real-time sending progress
- **Clean Interface** - Modern, WhatsApp-style design

## Anti-Block Protection

This app includes smart anti-blocking measures to keep your WhatsApp account safe:

| Feature | Value |
|---------|-------|
| Delay between messages | 8-15 seconds (random) |
| Batch size | 20 messages |
| Break between batches | 60 seconds |
| Daily recommended limit | 100 messages |

The app automatically:
- Adds random delays between messages (8-15 seconds)
- Pauses every 20 messages for 60 seconds
- Shows real-time countdown timers
- Skips failed numbers to avoid spam

## Requirements

- Node.js 18+ installed
- WhatsApp account (personal or business)

## Installation

```bash
cd "E:\watsaap broadcast"
npm install
```

## Running the Application

```bash
npm start
```

Then open your browser to: **http://localhost:3000**

## How to Use

### 1. Connect WhatsApp
- Open the web interface
- Open WhatsApp on your phone
- Go to Settings → Linked Devices → Link a Device
- Scan the QR code displayed on screen

### 2. Import Recipients
Choose one of three methods:
- **From WhatsApp**: Click "Import from WhatsApp" to load your contacts
- **Manual Entry**: Type phone numbers (one per line)
- **Upload File**: Upload a .txt or .csv file with numbers

### 3. Compose Message
- Enter your message text
- Optionally attach an image or video

### 4. Send
- Click "Send" and watch the progress
- Maximum 100 recipients per broadcast

## Important Notes

- **Rate Limiting**: WhatsApp may temporarily block if you send too many messages quickly. The app adds delays between messages.
- **Privacy**: Your data stays on your device/server. No messages are stored externally.
- **Session Persistence**: The WhatsApp session persists after restart. If you need to change accounts, click "Logout".

## Free Hosting Options

You can host this application for free:

### Railway (Recommended)
1. Create account at railway.app
2. Connect your GitHub repo
3. Deploy - Railway auto-detects Node.js

### Render
1. Create account at render.com
2. Create new "Web Service"
3. Connect repo and deploy

### Replit
1. Create new Repl
2. Upload files
3. Use Replit's built-in hosting

## Troubleshooting

**Q: QR code not showing?**
- Make sure WhatsApp is connected to the internet
- Try refreshing the page

**Q: Messages not sending?**
- Check if you've been rate-limited by WhatsApp
- Wait a few hours and try again
- Make sure recipients have your number saved (or you've messaged them before)

**Q: Session expired?**
- Click "Logout" and scan QR code again

## License

MIT License - Free for personal and business use.
