import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { Session } from './models.js';

/**
 * MongoDB Auth State Provider for Baileys
 * Based on useMultiFileAuthState but using MongoDB
 */
export const useMongoAuthState = async (sessionId) => {
    const writeData = async (data, id) => {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await Session.findOneAndUpdate(
            { id: `${sessionId}-${id}` },
            { data: serialized },
            { upsert: true }
        );
    };

    const readData = async (id) => {
        try {
            const doc = await Session.findOne({ id: `${sessionId}-${id}` });
            if (doc) {
                return JSON.parse(doc.data, BufferJSON.reviver);
            }
        } catch (error) {
            console.error('MongoAuthState Read Error:', error);
        }
        return null;
    };

    const removeData = async (id) => {
        await Session.deleteOne({ id: `${sessionId}-${id}` });
    };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = value; // Type adjustment
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const sId = `${category}-${id}`;
                            tasks.push(value ? writeData(value, sId) : removeData(sId));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};
