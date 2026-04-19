import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, server, contactsMap } from '../server.js';

const API_KEY = 'admin123';

describe('Watsaap Broadcast API Integration Tests', () => {
    
    // Reset global state if any before each test
    beforeEach(() => {
        vi.clearAllMocks();
        contactsMap.clear();
    });

    // Teardown the http server binding after vitest finishes
    afterAll(() => {
        server.close();
    });

    // ==========================================
    // 1. HAPPY PATH
    // ==========================================
    describe('Happy Path', () => {
        it('should return 200 and add contacts successfully when valid numbers are provided', async () => {
            // Arrange & Act
            const response = await request(app)
                .post('/api/contacts/add')
                .set('x-api-key', API_KEY)
                .send({ numbers: ['1234567890', '9876543210'] });

            // Assert
            expect(response.status).toBe(200);
            expect(response.body.contacts).toBeInstanceOf(Array);
            expect(response.body.contacts).toHaveLength(2);
            expect(response.body.contacts[0]).toHaveProperty('jid', '911234567890@s.whatsapp.net');
            expect(response.body.contacts[0]).toHaveProperty('number', '911234567890');
        });

        it('should return 200 status overview when requested', async () => {
            const response = await request(app)
                .get('/api/status')
                .set('x-api-key', API_KEY);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status');
            expect(response.body).toHaveProperty('contactCount');
        });
    });

    // ==========================================
    // 2. EDGE CASES
    // ==========================================
    describe('Edge Cases', () => {
        it('should parse numbers containing spaces and special characters appropriately', async () => {
            // Arrange
            const dirtyNumbers = ['+1 (234) 567-890', '123 456 7890'];
            
            // Act
            const response = await request(app)
                .post('/api/contacts/add')
                .set('x-api-key', API_KEY)
                .send({ numbers: dirtyNumbers });

            // Assert
            expect(response.status).toBe(200);
            expect(response.body.contacts[0].jid).toBe('911234567890@s.whatsapp.net');
            expect(response.body.contacts[1].jid).toBe('911234567890@s.whatsapp.net');
        });

        it('should gracefully return empty contacts list when importing and no contacts exist', async () => {
            const response = await request(app)
                .post('/api/contacts/import')
                .set('x-api-key', API_KEY);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('No contacts loaded yet');
            expect(response.body.contacts).toEqual([]);
        });
    });

    // ==========================================
    // 3. ERROR CASES
    // ==========================================
    describe('Error Cases', () => {
        it('should return 400 error when numbers parameter is missing in add contacts payload', async () => {
            // Act
            const response = await request(app)
                .post('/api/contacts/add')
                .set('x-api-key', API_KEY)
                .send({ missingKey: 'abc' });

            // Assert
            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid numbers array');
        });

        it('should return 400 error when attempting to send bulk message without an active WhatsApp connection', async () => {
            // Since the server boots without an active valid WA connection, this acts as the error condition
            const payload = {
                recipients: JSON.stringify([{ number: '1234567890' }]),
                message: 'Hello World'
            };

            const response = await request(app)
                .post('/api/send/bulk')
                .set('x-api-key', API_KEY)
                .send(payload);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('WhatsApp not connected');
        });
    });
});
