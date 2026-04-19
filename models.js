import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true },
    name: String,
    number: String,
    updatedAt: { type: Date, default: Date.now }
});

const groupSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    members: [String], // Array of JIDs
    updatedAt: { type: Date, default: Date.now }
});

const broadcastListSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    members: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, // e.g. 'auth_creds' or 'auth_key_123'
    data: { type: String, required: true } // Serialized with BufferJSON
});

export const Contact = mongoose.model('Contact', contactSchema);
export const Group = mongoose.model('Group', groupSchema);
export const BroadcastList = mongoose.model('BroadcastList', broadcastListSchema);
export const Session = mongoose.model('Session', sessionSchema);
