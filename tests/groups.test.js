import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.API_KEY || 'broadcast_secret_key_2026';

describe('Custom Groups API', () => {
    
    // ==========================================
    // 1. HAPPY PATH
    // ==========================================
    describe('Happy Path', () => {
        it('should create a custom group successfully with API key', async () => {
            const payload = {
                name: 'Test Group',
                members: ['911234567890@s.whatsapp.net', '919876543210@s.whatsapp.net']
            };

            const response = await request(app)
                .post('/api/groups')
                .set('x-api-key', API_KEY)
                .send(payload);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.group.name).toBe('Test Group');
        });

        it('should retrieve the list of custom groups with API key', async () => {
            const response = await request(app)
                .get('/api/groups')
                .set('x-api-key', API_KEY);
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });
    });

    // ==========================================
    // 2. AUTHENTICATION (New/Restored)
    // ==========================================
    describe('Authentication', () => {
        it('should return 401 if x-api-key header is missing', async () => {
            const response = await request(app).get('/api/groups');
            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Unauthorized');
        });

        it('should return 401 if x-api-key header is incorrect', async () => {
            const response = await request(app)
                .get('/api/groups')
                .set('x-api-key', 'wrong-key');
            expect(response.status).toBe(401);
        });
    });

    // ==========================================
    // 3. EDGE CASES & RECENT FIXES
    // ==========================================
    describe('Edge Cases & Fixes', () => {
        it('should correctly handle group titles with special characters and spaces', async () => {
            const nameWithSpaces = 'My Special Group @ 2026';
            const payload = {
                name: nameWithSpaces,
                members: ['911234567890@s.whatsapp.net']
            };

            await request(app)
                .post('/api/groups')
                .set('x-api-key', API_KEY)
                .send(payload);

            const response = await request(app)
                .delete(`/api/groups/${encodeURIComponent(nameWithSpaces)}`)
                .set('x-api-key', API_KEY);
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });
    });

    // ==========================================
    // 4. ERROR CASES
    // ==========================================
    describe('Error Cases', () => {
        it('should return 400 when name is missing during group creation', async () => {
            const response = await request(app)
                .post('/api/groups')
                .set('x-api-key', API_KEY)
                .send({ members: ['123@s.whatsapp.net'] });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Name and members array required');
        });
    });
});
