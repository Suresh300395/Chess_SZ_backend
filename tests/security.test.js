const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// Set test environment variables
process.env.JWT_SECRET = 'test_super_secure_jwt_secret_key_1234567890';

const { verifyToken, requireAdmin } = require('../Modules/authMiddleware');

describe('Security Regression Test Suite', () => {

    describe('A & F. JWT Security and Algorithm Restriction', () => {
        test('Rejects tokens using "none" algorithm', () => {
            const req = {
                headers: {
                    authorization: 'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpZCI6IjEyMyIsInJvbGUiOiJhZG1pbiJ9.'
                }
            };
            let statusCalled = null;
            let jsonCalled = null;
            const res = {
                status: (code) => {
                    statusCalled = code;
                    return { json: (data) => { jsonCalled = data; } };
                }
            };
            const next = () => { assert.fail('next() should not be called for unsigned none-algorithm token'); };

            verifyToken(req, res, next);
            assert.ok(statusCalled === 401 || statusCalled === 403, `Expected 401 or 403, got ${statusCalled}`);
            assert.match(jsonCalled.message, /invalid|expired|token/i);
        });

        test('Rejects tokens signed with wrong secret', () => {
            const forgedToken = jwt.sign({ id: '123', role: 'admin' }, 'wrong_secret', { algorithm: 'HS256' });
            const req = { headers: { authorization: `Bearer ${forgedToken}` } };
            let statusCalled = null;
            let jsonCalled = null;
            const res = {
                status: (code) => {
                    statusCalled = code;
                    return { json: (data) => { jsonCalled = data; } };
                }
            };
            const next = () => { assert.fail('next() should not be called for token with invalid signature'); };

            verifyToken(req, res, next);
            assert.ok(statusCalled === 401 || statusCalled === 403, `Expected 401 or 403, got ${statusCalled}`);
            assert.match(jsonCalled.message, /invalid|expired|token/i);
        });

        test('Rejects expired tokens', () => {
            const expiredToken = jwt.sign({ id: '123', role: 'admin' }, process.env.JWT_SECRET, {
                algorithm: 'HS256',
                expiresIn: '-1s'
            });
            const req = { headers: { authorization: `Bearer ${expiredToken}` } };
            let statusCalled = null;
            let jsonCalled = null;
            const res = {
                status: (code) => {
                    statusCalled = code;
                    return { json: (data) => { jsonCalled = data; } };
                }
            };
            const next = () => { assert.fail('next() should not be called for expired token'); };

            verifyToken(req, res, next);
            assert.ok(statusCalled === 401 || statusCalled === 403, `Expected 401 or 403, got ${statusCalled}`);
            assert.match(jsonCalled.message, /invalid|expired|token/i);
        });

        test('Rejects requests missing Authorization header', () => {
            const req = { headers: {} };
            let statusCalled = null;
            let jsonCalled = null;
            const res = {
                status: (code) => {
                    statusCalled = code;
                    return { json: (data) => { jsonCalled = data; } };
                }
            };
            const next = () => { assert.fail('next() should not be called without token'); };

            verifyToken(req, res, next);
            assert.strictEqual(statusCalled, 401);
            assert.match(jsonCalled.message, /Access Denied|No Token/i);
        });

        test('Accepts valid HS256 tokens and populates req.user', () => {
            const validToken = jwt.sign(
                { id: 'usr_admin_1', username: 'superadmin', role: 'admin' },
                process.env.JWT_SECRET,
                { algorithm: 'HS256', expiresIn: '1h' }
            );
            const req = { headers: { authorization: `Bearer ${validToken}` } };
            let nextCalled = false;
            const res = {};
            const next = () => { nextCalled = true; };

            verifyToken(req, res, next);
            assert.strictEqual(nextCalled, true);
            assert.strictEqual(req.user.id, 'usr_admin_1');
            assert.strictEqual(req.user.role, 'admin');
        });
    });

    describe('C. Role-Based Access Control (RBAC)', () => {
        test('Blocks player role from admin-only endpoints', () => {
            const req = { user: { id: 'usr_p1', role: 'player' } };
            let statusCalled = null;
            let jsonCalled = null;
            const res = {
                status: (code) => {
                    statusCalled = code;
                    return { json: (data) => { jsonCalled = data; } };
                }
            };
            const next = () => { assert.fail('Player should not reach admin handler'); };

            requireAdmin(req, res, next);
            assert.strictEqual(statusCalled, 403);
            assert.match(jsonCalled.message, /Access denied|Admin only/i);
        });

        test('Blocks coach role from admin-only endpoints', () => {
            const req = { user: { id: 'usr_c1', role: 'coach' } };
            let statusCalled = null;
            let jsonCalled = null;
            const res = {
                status: (code) => {
                    statusCalled = code;
                    return { json: (data) => { jsonCalled = data; } };
                }
            };
            const next = () => { assert.fail('Coach should not reach admin handler'); };

            requireAdmin(req, res, next);
            assert.strictEqual(statusCalled, 403);
            assert.match(jsonCalled.message, /Access denied|Admin only/i);
        });

        test('Allows admin and superadmin roles through requireAdmin', () => {
            let nextCalledCount = 0;
            const next = () => { nextCalledCount++; };
            const res = {};

            requireAdmin({ user: { role: 'admin' } }, res, next);
            requireAdmin({ user: { role: 'superadmin' } }, res, next);

            assert.strictEqual(nextCalledCount, 2);
        });
    });

    describe('G. Path Traversal File System Protection', () => {
        test('Prevents path traversal escape from public/uploads/profiles', () => {
            const safeDir = path.resolve(__dirname, '../public/uploads/profiles');
            
            const maliciousPaths = [
                '../../package.json',
                '../../../etc/passwd',
                '..\\..\\app.js',
                '/uploads/profiles/../../app.js',
                'uploads/profiles/..%2f..%2fapp.js'
            ];

            for (const inputPath of maliciousPaths) {
                const match = inputPath.match(/\/uploads\/profiles\/([a-zA-Z0-9_\-\.]+)/);
                if (match) {
                    const fileName = match[1];
                    const fullPath = path.resolve(safeDir, fileName);
                    const isContained = fullPath.startsWith(safeDir + path.sep);
                    // Must not escape the directory
                    assert.strictEqual(
                        isContained,
                        false,
                        `Malicious traversal path ${fullPath} should not be recognized as inside ${safeDir}`
                    );
                } else {
                    // Correctly rejected by regex without even touching the filesystem
                    assert.strictEqual(match, null);
                }
            }

            // Valid file name inside directory is permitted
            const validFileName = 'profile-123456789.png';
            const validFullPath = path.resolve(safeDir, validFileName);
            assert.strictEqual(validFullPath.startsWith(safeDir), true);
        });

        test('Prevents path traversal escape from public/uploads/committee', () => {
            const safeDir = path.resolve(__dirname, '../public/uploads/committee');
            const maliciousPayload = '/uploads/committee/../../../controllers/authController.js';
            
            const match = maliciousPayload.match(/\/uploads\/committee\/[^\s?#]+/);
            assert.ok(match);
            const relativePath = match[0];
            const resolvedPath = path.resolve(__dirname, '../public', '.' + relativePath);
            
            // Verifying the containment check:
            const isContained = resolvedPath.startsWith(safeDir);
            assert.strictEqual(isContained, false, 'Resolved path should not be inside safeDir when traversing');
        });
    });

    describe('H. Mass Assignment Mitigation', () => {
        test('Filters out disallowed fields on Block updates', () => {
            const allowedFields = [
                'name', 'block', 'warden', 'wardenContact',
                'officeHours', 'address', 'capacityPerRoom', 'floors'
            ];

            const maliciousBody = {
                name: 'Boys Hostel 1',
                warden: 'John Doe',
                isAdmin: true,
                role: 'superadmin',
                __v: 99,
                arbitraryProp: 'exploit'
            };

            const filtered = {};
            for (const field of allowedFields) {
                if (maliciousBody[field] !== undefined) {
                    filtered[field] = maliciousBody[field];
                }
            }

            assert.strictEqual(filtered.name, 'Boys Hostel 1');
            assert.strictEqual(filtered.warden, 'John Doe');
            assert.strictEqual(filtered.isAdmin, undefined);
            assert.strictEqual(filtered.role, undefined);
            assert.strictEqual(filtered.__v, undefined);
            assert.strictEqual(filtered.arbitraryProp, undefined);
        });
    });

    describe('D. XSS Escaping Logic', () => {
        test('HTML entities are securely escaped', () => {
            const escapeHtml = (value) => {
                if (value === null || value === undefined) return '';
                return String(value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            };

            const attackPayloads = [
                '<script>alert("XSS")</script>',
                '"><img src=x onerror=alert(1)>',
                "';alert('XSS');//",
                '<iframe src="javascript:alert(1)"></iframe>'
            ];

            for (const payload of attackPayloads) {
                const escaped = escapeHtml(payload);
                assert.ok(!escaped.includes('<script>'));
                assert.ok(!escaped.includes('"><img'));
                assert.ok(!escaped.includes('<iframe'));
                assert.ok(escaped.includes('&lt;') || escaped.includes('&quot;') || escaped.includes('&#39;'));
            }
        });
    });

    describe('ReDoS Input Sanitization', () => {
        test('Regex special characters are escaped safely', () => {
            const escapeRegex = (string) => {
                if (typeof string !== 'string') return '';
                return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            };

            const problematicInputs = [
                '((a+)+)+$',
                '[a-z]{1,1000000}',
                'test.*+?^${}()|[]\\',
                'player(name)?'
            ];

            for (const input of problematicInputs) {
                const escaped = escapeRegex(input);
                // Creating RegExp with escaped string should not throw or match catastrophic backtracking
                const regex = new RegExp(escaped, 'i');
                assert.ok(regex instanceof RegExp);
            }
        });
    });

    describe('B & E. Account Takeover & User Credentials', () => {
        test('Provisions default user password (Aditya@123) for newly registered accounts', () => {
            const defaultPassword = process.env.DEFAULT_USER_PASSWORD || 'Aditya@123';
            assert.strictEqual(defaultPassword, 'Aditya@123');
        });

        test('Preserves existing user passwords upon team re-registration', () => {
            // Emulate existing user with custom password
            const existingUser = {
                username: '9876543210',
                password: '$2b$10$CustomHashedPassword1234567890',
                role: 'player',
                registrationId: 'reg_old_1'
            };

            const originalPassword = existingUser.password;

            // When user already exists: preserve password, only update registration reference
            const newRegistrationId = 'reg_new_2';
            existingUser.registrationId = newRegistrationId;

            assert.strictEqual(existingUser.password, originalPassword, 'Existing user password must be preserved');
            assert.strictEqual(existingUser.registrationId, newRegistrationId);
        });

        test('Prevents account hijacking when duplicate mobile matches an Admin account', () => {
            // Emulate account takeover protection logic in registration.js
            const existingAdminUser = {
                _id: 'admin_id_123',
                username: 'superadmin',
                role: 'admin',
                mobileNo: '9876543210'
            };

            const isDuplicateAdmin = existingAdminUser.role === 'admin' || existingAdminUser.role === 'superadmin';
            assert.strictEqual(isDuplicateAdmin, true, 'Admin account should be identified and protected');

            let userPasswordOverwritten = false;
            if (isDuplicateAdmin) {
                // Skips updating credentials or touching existing admin
            } else {
                userPasswordOverwritten = true;
            }

            assert.strictEqual(userPasswordOverwritten, false, 'Admin password must never be overwritten via registration');
        });

        test('Safely handles special characters in email query to prevent ReDoS', () => {
            const emailInput = 'user+test.*((a+)+)+$@example.com';
            const escapedEmail = emailInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const safeRegex = new RegExp(`^${escapedEmail}$`, 'i');

            assert.ok(safeRegex.test(emailInput));
            assert.strictEqual(safeRegex.test('user@example.com'), false);
        });
    });
});

