const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Registration = require('../models/Registration');
const User = require('../models/User');
const connectDB = require('../config/dbconnect');

const API_BASE = 'http://localhost:3003/api/registration';

describe('Intelligent University Registration & Data Reuse Workflow', () => {
    let testUniId = null;
    let existingPlayerId = null;
    let existingCoachId = null;
    const randomLetters = () => Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    const testUniName = 'Test Intelligence University ' + randomLetters();
    const testContact = '9876543210';
    const testAddress = 'Campus Road 1';

    const p1Mobile = '98' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
    const c1Mobile = '97' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
    const c1Email = `coach_${Date.now()}@testuni.com`;

    const p2Mobile = '96' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
    const p3Mobile = '95' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
    const c2Mobile = '94' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
    const c2Email = `coach2_${Date.now()}@testuni.com`;

    before(async () => {
        if (mongoose.connection.readyState === 0) {
            await connectDB();
        }
    });

    after(async () => {
        // Clean up test records
        try {
            if (testUniId) {
                await Registration.findByIdAndDelete(testUniId);
            }
            const allMobiles = [p1Mobile, c1Mobile, p2Mobile, p3Mobile, c2Mobile];
            await User.deleteMany({ username: { $in: allMobiles } });
        } catch (err) {
            console.error('Cleanup error:', err);
        } finally {
            await mongoose.disconnect();
        }
    });

    // =========================================================================
    // TEST 4: Create new university
    // =========================================================================
    test('TEST 4: Register a new university with initial player and coach', async () => {
        const payload = {
            teamDetails: {
                universityName: testUniName,
                universityContact: testContact,
                address: testAddress
            },
            players: [{
                playerName: 'Player One',
                mobileNo: p1Mobile,
                gender: 'Male',
                dob: '2001-01-01',
                transportMode: 'Bus',
                arrivalDate: '2026-10-20',
                arrivalTime: '10:00',
                departureDate: '2026-10-25',
                departureTime: '18:00',
                accommodation: 'Yes'
            }],
            coaches: [{
                role: 'Coach',
                name: 'Coach One',
                mobileNo: c1Mobile,
                mailId: c1Email,
                gender: 'Male',
                foodType: 'Veg',
                accommodation: 'Yes'
            }]
        };

        const res = await fetch(`${API_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 201, 'Should create new registration with 201 status');
        const json = await res.json();
        assert.ok(json.data?._id, 'Response should contain registered university ID');
        testUniId = json.data._id;
        assert.equal(json.data.universityName, testUniName);
        assert.equal(json.data.players.length, 1);
        assert.equal(json.data.coaches.length, 1);

        existingPlayerId = json.data.players[0]._id;
        existingCoachId = json.data.coaches[0]._id;

        // Verify accounts created in User collection
        const p1User = await User.findOne({ username: p1Mobile });
        assert.ok(p1User, 'User account should be created for Player One');
        assert.equal(p1User.role, 'player');
        assert.equal(p1User.registrationId.toString(), testUniId.toString());

        const c1User = await User.findOne({ username: c1Mobile });
        assert.ok(c1User, 'User account should be created for Coach One');
        assert.equal(c1User.role, 'coach');
    });

    // =========================================================================
    // Search API Verification
    // =========================================================================
    test('Search API: Case-insensitive search returns matching university with sanitized fields', async () => {
        const query = testUniName.slice(0, 15).toLowerCase();
        const res = await fetch(`${API_BASE}/search-universities?q=${encodeURIComponent(query)}`);
        assert.equal(res.status, 200);

        const list = await res.json();
        assert.ok(Array.isArray(list));
        const found = list.find(u => u._id === testUniId);
        assert.ok(found, 'Should find the created test university via case-insensitive search');
        assert.equal(found.players.length, 1);
        assert.equal(found.coaches.length, 1);
        assert.ok(!found.password, 'Must not return passwords or sensitive fields');
    });

    test('Fetch by ID API: Returns full university record', async () => {
        const res = await fetch(`${API_BASE}/university/${testUniId}`);
        assert.equal(res.status, 200);
        const uni = await res.json();
        assert.equal(uni._id, testUniId);
        assert.equal(uni.universityName, testUniName);
        assert.equal(uni.players[0]._id, existingPlayerId);
        assert.equal(uni.coaches[0]._id, existingCoachId);
    });

    // =========================================================================
    // TEST 8: Reject forged player or coach ID
    // =========================================================================
    test('TEST 8: Rejects forged existing player ID or coach ID that does not belong to university', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();

        const payload = {
            universityId: testUniId,
            teamDetails: {
                universityName: testUniName,
                universityContact: testContact,
                address: testAddress
            },
            players: [
                { _id: existingPlayerId, playerName: 'Player One', mobileNo: p1Mobile },
                { _id: fakeId, playerName: 'Forged Player', mobileNo: p2Mobile }
            ],
            coaches: [
                { _id: existingCoachId, role: 'Coach', name: 'Coach One', mobileNo: c1Mobile, mailId: c1Email }
            ]
        };

        const res = await fetch(`${API_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 400, 'Should reject with status 400');
        const json = await res.json();
        assert.match(json.error, /Invalid player ID/i);
    });

    // =========================================================================
    // TEST 2 & TEST 3: Add new players and coach to existing university
    // =========================================================================
    test('TEST 2 & 3: Append new players and coach to existing university document (_id unchanged, existing intact)', async () => {
        // Record existing user account passwords/hashes to verify they are unchanged
        const origP1User = await User.findOne({ username: p1Mobile });
        const origP1PasswordHash = origP1User.password;

        const payload = {
            universityId: testUniId,
            teamDetails: {
                universityName: testUniName,
                universityContact: testContact,
                address: testAddress
            },
            players: [
                // Existing player (retained unchanged)
                {
                    _id: existingPlayerId,
                    playerName: 'Player One',
                    mobileNo: p1Mobile,
                    gender: 'Male',
                    dob: '2001-01-01',
                    transportMode: 'Bus',
                    arrivalDate: '2026-10-20',
                    arrivalTime: '10:00',
                    departureDate: '2026-10-25',
                    departureTime: '18:00',
                    accommodation: 'Yes'
                },
                // Newly added Player 2
                {
                    playerName: 'Player Two',
                    mobileNo: p2Mobile,
                    gender: 'Female',
                    dob: '2002-02-02',
                    transportMode: 'Train',
                    transportNumber: '12727',
                    arrivalDate: '2026-10-20',
                    arrivalTime: '11:00',
                    departureDate: '2026-10-25',
                    departureTime: '19:00',
                    accommodation: 'Yes'
                },
                // Newly added Player 3
                {
                    playerName: 'Player Three',
                    mobileNo: p3Mobile,
                    gender: 'Male',
                    dob: '2003-03-03',
                    transportMode: 'Flight',
                    transportNumber: '6E-456',
                    arrivalDate: '2026-10-20',
                    arrivalTime: '12:00',
                    departureDate: '2026-10-25',
                    departureTime: '20:00',
                    accommodation: 'Yes'
                }
            ],
            coaches: [
                // Existing coach (retained unchanged)
                {
                    _id: existingCoachId,
                    role: 'Coach',
                    name: 'Coach One',
                    mobileNo: c1Mobile,
                    mailId: c1Email,
                    gender: 'Male',
                    foodType: 'Veg',
                    accommodation: 'Yes'
                },
                // Newly added Coach 2
                {
                    role: 'Manager',
                    name: 'Manager Two',
                    mobileNo: c2Mobile,
                    mailId: c2Email,
                    gender: 'Female',
                    foodType: 'Non-Veg',
                    accommodation: 'Yes'
                }
            ]
        };

        const res = await fetch(`${API_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 200, 'Should return 200 for existing university update');
        const json = await res.json();
        assert.equal(json.data._id, testUniId, 'Original university _id MUST remain unchanged');
        assert.equal(json.data.players.length, 3, 'Total players should now be 3 (1 existing + 2 new)');
        assert.equal(json.data.coaches.length, 2, 'Total coaches should now be 2 (1 existing + 1 new)');

        // Verify existing player & coach remain intact in DB
        const updatedDoc = await Registration.findById(testUniId);
        assert.equal(updatedDoc.players[0]._id.toString(), existingPlayerId.toString());
        assert.equal(updatedDoc.players[0].playerName, 'Player One');
        assert.equal(updatedDoc.coaches[0]._id.toString(), existingCoachId.toString());
        assert.equal(updatedDoc.coaches[0].name, 'Coach One');

        // Verify accounts created ONLY for new participants
        const p2User = await User.findOne({ username: p2Mobile });
        assert.ok(p2User, 'User account should be created for newly added Player Two');

        const p3User = await User.findOne({ username: p3Mobile });
        assert.ok(p3User, 'User account should be created for newly added Player Three');

        const c2User = await User.findOne({ username: c2Mobile });
        assert.ok(c2User, 'User account should be created for newly added Manager Two');

        // Verify existing player's password was NOT regenerated or overwritten
        const postP1User = await User.findOne({ username: p1Mobile });
        assert.equal(postP1User.password, origP1PasswordHash, 'Existing user password hash must be preserved unchanged');
    });

    // =========================================================================
    // TEST 7: Duplicate submission prevention
    // =========================================================================
    test('TEST 7: Prevent duplicate accounts and participants upon duplicate submission', async () => {
        // Submitting p2Mobile again as a new player should be rejected
        const payload = {
            universityId: testUniId,
            teamDetails: {
                universityName: testUniName,
                universityContact: testContact,
                address: testAddress
            },
            players: [
                { _id: existingPlayerId, playerName: 'Player One', mobileNo: p1Mobile },
                { playerName: 'Duplicate Player', mobileNo: p2Mobile, gender: 'Male', dob: '2000-01-01', transportMode: 'Bus', arrivalDate: '2026-10-20', arrivalTime: '10:00', departureDate: '2026-10-25', departureTime: '18:00' }
            ],
            coaches: [
                { _id: existingCoachId, role: 'Coach', name: 'Coach One', mobileNo: c1Mobile, mailId: c1Email }
            ]
        };

        const res = await fetch(`${API_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 400, 'Duplicate mobile number should be rejected with 400');
        const json = await res.json();
        assert.match(json.error, /already registered/i);
    });

    // =========================================================================
    // Duplicate University Name Prevention
    // =========================================================================
    test('Duplicate University Name: Concurrent/case-insensitive submission is rejected', async () => {
        const payload = {
            teamDetails: {
                universityName: testUniName.toUpperCase(), // Same name with different case
                universityContact: '9111222333',
                address: 'Different address'
            },
            players: [{
                playerName: 'Another Player',
                mobileNo: '99' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8),
                gender: 'Male',
                dob: '2000-01-01',
                transportMode: 'Bus',
                arrivalDate: '2026-10-20',
                arrivalTime: '10:00',
                departureDate: '2026-10-25',
                departureTime: '18:00',
                accommodation: 'Yes'
            }],
            coaches: [{
                role: 'Coach',
                name: 'Another Coach',
                mobileNo: '98' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8),
                mailId: `unique_${Date.now()}@uni.com`,
                gender: 'Male',
                foodType: 'Veg',
                accommodation: 'Yes'
            }]
        };

        // When universityId is not sent, submitting with same name matches the existing university
        // or prevents creating a duplicate document
        const countBefore = await Registration.countDocuments({
            universityName: new RegExp(`^${testUniName}$`, 'i')
        });
        assert.equal(countBefore, 1);

        const res = await fetch(`${API_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // It appends to the existing university instead of creating a second document!
        assert.ok(res.status === 200 || res.status === 409, `Expected 200 (appended) or 409 (conflict), got ${res.status}`);

        const countAfter = await Registration.countDocuments({
            universityName: new RegExp(`^${testUniName}$`, 'i')
        });
        assert.equal(countAfter, 1, 'Never creates a duplicate university document');
    });

    // =========================================================================
    // TEST 9: Safe handling and rollback during failure
    // =========================================================================
    test('TEST 9: Safe handling and rollback during failure prevents orphaned accounts', async () => {
        const orphanedMobile = '91' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
        const badMobile = '912'; // Invalid mobile that fails validation

        const payload = {
            universityId: testUniId,
            teamDetails: {
                universityName: testUniName,
                universityContact: testContact,
                address: testAddress
            },
            players: [
                { _id: existingPlayerId, playerName: 'Player One', mobileNo: p1Mobile },
                { playerName: 'Candidate Player', mobileNo: orphanedMobile, gender: 'Male', dob: '2000-01-01', transportMode: 'Bus', arrivalDate: '2026-10-20', arrivalTime: '10:00', departureDate: '2026-10-25', departureTime: '18:00' },
                { playerName: 'Bad Player', mobileNo: badMobile, gender: 'Male', dob: '2000-01-01', transportMode: 'Bus', arrivalDate: '2026-10-20', arrivalTime: '10:00', departureDate: '2026-10-25', departureTime: '18:00' }
            ],
            coaches: [
                { _id: existingCoachId, role: 'Coach', name: 'Coach One', mobileNo: c1Mobile, mailId: c1Email }
            ]
        };

        const res = await fetch(`${API_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 400, 'Must reject invalid submission with 400');
        const userCheck = await User.findOne({ username: orphanedMobile });
        assert.equal(userCheck, null, 'No orphaned user accounts should be created when submission fails');
    });
});
