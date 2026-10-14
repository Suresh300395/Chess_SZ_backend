const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const Registration = require('../models/Registration');
const HostelBlock = require('../models/HostelBlock');
const connectDB = require('../config/dbconnect');

const API_BASE = 'http://localhost:3003/api/registration';

describe('Bulk University Room Allotment API', () => {
    let testUniId = null;
    let playerIds = [];
    let adminToken = null;
    const testUniName = 'Test Bulk Allotment University ' + Math.floor(Math.random() * 10000);
    const testBuilding = 'Test Bulk Block ' + Math.floor(Math.random() * 10000);
    const testFloor = 'Floor 1';
    const testRoom = '101';

    before(async () => {
        if (mongoose.connection.readyState === 0) {
            await connectDB();
        }

        const secret = process.env.JWT_SECRET || 'fallback_secret_chess_2026';
        adminToken = jwt.sign({ id: 'admin_test_1', role: 'admin' }, secret, { algorithm: 'HS256' });

        // Create a test block with capacity 4
        await HostelBlock.create({
            name: testBuilding,
            block: 'Block T',
            capacityPerRoom: 4,
            floors: [{
                floorName: testFloor,
                roomCount: 1,
                rooms: [testRoom]
            }]
        });

        // Create a university with 6 players requesting accommodation
        const players = [];
        for (let i = 1; i <= 6; i++) {
            players.push({
                playerName: `Player ${i}`,
                gender: 'Male',
                dob: '2000-01-01',
                mobileNo: '99' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8),
                transportMode: 'Bus',
                arrivalDate: '2026-10-15',
                arrivalTime: '10:00',
                departureDate: '2026-10-20',
                departureTime: '17:00',
                accommodation: 'Yes'
            });
        }

        const uni = await Registration.create({
            universityName: testUniName,
            universityContact: '9876543210',
            address: 'Campus 1',
            players: players,
            coaches: []
        });

        testUniId = uni._id;
        playerIds = uni.players.map(p => p._id);
    });

    after(async () => {
        try {
            if (testUniId) {
                await Registration.findByIdAndDelete(testUniId);
            }
            await HostelBlock.deleteOne({ name: testBuilding });
        } catch (err) {
            console.error('Cleanup error:', err);
        } finally {
            await mongoose.disconnect();
        }
    });

    test('Rejects bulk allocation exceeding room capacity (trying 5 into room with capacity 4)', async () => {
        const allocations = playerIds.slice(0, 5).map(id => ({
            registrationId: testUniId.toString(),
            personId: id.toString(),
            role: 'Player'
        }));

        const res = await fetch(`${API_BASE}/bulk-assign-room`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                allocations,
                building: testBuilding,
                floor: testFloor,
                roomNumber: testRoom
            })
        });

        const data = await res.json();
        assert.equal(res.status, 400);
        assert.match(data.message, /capacity/i);
    });

    test('Successfully allots 4 members to room within capacity', async () => {
        const allocations = playerIds.slice(0, 4).map(id => ({
            registrationId: testUniId.toString(),
            personId: id.toString(),
            role: 'Player'
        }));

        const res = await fetch(`${API_BASE}/bulk-assign-room`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                allocations,
                building: testBuilding,
                floor: testFloor,
                roomNumber: testRoom
            })
        });

        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.count, 4);

        // Verify in DB that the 4 players now have roomAllocation
        const updated = await Registration.findById(testUniId);
        const allotted = updated.players.filter(p => p.roomAllocation && p.roomAllocation.roomNumber);
        const unallotted = updated.players.filter(p => !p.roomAllocation || !p.roomAllocation.roomNumber);

        assert.equal(allotted.length, 4, '4 players should be allotted');
        assert.equal(unallotted.length, 2, '2 players should remain unallotted');
        assert.equal(allotted[0].roomAllocation.roomNumber, testRoom);
    });

    test('Rejects allocating further members to the now full room (0 slots remaining)', async () => {
        const allocations = playerIds.slice(4, 6).map(id => ({
            registrationId: testUniId.toString(),
            personId: id.toString(),
            role: 'Player'
        }));

        const res = await fetch(`${API_BASE}/bulk-assign-room`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            },
            body: JSON.stringify({
                allocations,
                building: testBuilding,
                floor: testFloor,
                roomNumber: testRoom
            })
        });

        const data = await res.json();
        assert.equal(res.status, 400);
        assert.match(data.message, /only fit 0 more/i);
    });
});
