const express = require('express');
const router = express.Router();
const Registration = require('../models/Registration');

router.post('/', async (req, res) => {
    try {
        const { teamDetails, players, coaches } = req.body;
        
        const mobileRegex = /^[6-9]\d{9}$/;
        const numberRegex = /[0-9]/;

        if (!teamDetails?.universityName || numberRegex.test(teamDetails.universityName)) {
            return res.status(400).json({ error: 'University name cannot contain numbers' });
        }

        if (!teamDetails?.universityContact || !mobileRegex.test(teamDetails.universityContact)) {
            return res.status(400).json({ error: 'University contact must be exactly 10 digits starting with 6, 7, 8, or 9' });
        }

        if (Array.isArray(players)) {
            for (let i = 0; i < players.length; i++) {
                const p = players[i];
                if (!p.playerName || numberRegex.test(p.playerName)) {
                    return res.status(400).json({ error: `Player ${i + 1}: Name cannot contain numbers` });
                }
                if (!p.mobileNo || !mobileRegex.test(p.mobileNo)) {
                    return res.status(400).json({ error: `Player ${i + 1}: Mobile number must be exactly 10 digits starting with 6, 7, 8, or 9` });
                }
            }
        }

        if (Array.isArray(coaches)) {
            for (let i = 0; i < coaches.length; i++) {
                const c = coaches[i];
                if (!c.name || numberRegex.test(c.name)) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Name cannot contain numbers` });
                }
                if (!c.mobileNo || !mobileRegex.test(c.mobileNo)) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Mobile number must be exactly 10 digits starting with 6, 7, 8, or 9` });
                }
                if (!c.mailId || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(c.mailId)) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Valid email address is required` });
                }
            }
        }

        // --- DUPLICATE PREVENTION CHECKS ---
        // 1. Check for duplicates within the current submission
        const seenMobilesInForm = new Map();
        const seenEmailsInForm = new Map();

        if (Array.isArray(players)) {
            for (let i = 0; i < players.length; i++) {
                const mob = players[i].mobileNo?.trim();
                if (mob) {
                    if (seenMobilesInForm.has(mob)) {
                        return res.status(400).json({
                            error: `Duplicate mobile number '${mob}' in form (Player ${i + 1} and ${seenMobilesInForm.get(mob)}). Each participant must have a unique mobile number.`
                        });
                    }
                    seenMobilesInForm.set(mob, `Player ${i + 1}`);
                }
            }
        }

        if (Array.isArray(coaches)) {
            for (let i = 0; i < coaches.length; i++) {
                const mob = coaches[i].mobileNo?.trim();
                const email = coaches[i].mailId?.trim().toLowerCase();

                if (mob) {
                    if (seenMobilesInForm.has(mob)) {
                        return res.status(400).json({
                            error: `Duplicate mobile number '${mob}' in form (Coach/Manager ${i + 1} and ${seenMobilesInForm.get(mob)}). Each participant must have a unique mobile number.`
                        });
                    }
                    seenMobilesInForm.set(mob, `Coach/Manager ${i + 1}`);
                }

                if (email) {
                    if (seenEmailsInForm.has(email)) {
                        return res.status(400).json({
                            error: `Duplicate email '${email}' in form (Coach/Manager ${i + 1} and Coach/Manager ${seenEmailsInForm.get(email)}). Each coach must have a unique email address.`
                        });
                    }
                    seenEmailsInForm.set(email, i + 1);
                }
            }
        }

        // 2. Check for duplicate mobile numbers against existing registrations in DB
        const allSubmittedMobiles = Array.from(seenMobilesInForm.keys());
        if (allSubmittedMobiles.length > 0) {
            const existingWithMobile = await Registration.findOne({
                $or: [
                    { 'players.mobileNo': { $in: allSubmittedMobiles } },
                    { 'coaches.mobileNo': { $in: allSubmittedMobiles } }
                ]
            });

            if (existingWithMobile) {
                for (const mob of allSubmittedMobiles) {
                    const existingPlayer = existingWithMobile.players?.find(p => p.mobileNo === mob);
                    if (existingPlayer) {
                        return res.status(400).json({
                            error: `Mobile number '${mob}' is already registered for player '${existingPlayer.playerName}' (${existingWithMobile.universityName}). Duplicate entries are not allowed.`
                        });
                    }
                    const existingCoach = existingWithMobile.coaches?.find(c => c.mobileNo === mob);
                    if (existingCoach) {
                        return res.status(400).json({
                            error: `Mobile number '${mob}' is already registered for coach '${existingCoach.name}' (${existingWithMobile.universityName}). Duplicate entries are not allowed.`
                        });
                    }
                }
            }
        }

        // 3. Check for duplicate coach email IDs against existing registrations in DB
        const allSubmittedEmails = Array.from(seenEmailsInForm.keys());
        if (allSubmittedEmails.length > 0) {
            const emailRegexList = allSubmittedEmails.map(e => new RegExp(`^${e}$`, 'i'));
            const existingWithEmail = await Registration.findOne({
                'coaches.mailId': { $in: emailRegexList }
            });

            if (existingWithEmail) {
                for (const email of allSubmittedEmails) {
                    const existingCoach = existingWithEmail.coaches?.find(c => (c.mailId || '').toLowerCase() === email);
                    if (existingCoach) {
                        return res.status(400).json({
                            error: `Email address '${existingCoach.mailId}' is already registered for coach '${existingCoach.name}' (${existingWithEmail.universityName}). Duplicate entries are not allowed.`
                        });
                    }
                }
            }
        }

        const newRegistration = new Registration({
            universityName: teamDetails.universityName,
            universityContact: teamDetails.universityContact,
            address: teamDetails.address,
            players,
            coaches
        });

        const savedRegistration = await newRegistration.save();
        
        // Emit event for real-time update
        require('../socket').getIO().emit('dataUpdated');

        res.status(201).json({ message: 'Registration successful', data: savedRegistration });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ message: 'Server error during registration', error: error.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const registrations = await Registration.find().sort({ createdAt: -1 });
        res.status(200).json(registrations);
    } catch (error) {
        console.error('Error fetching registrations:', error);
        res.status(500).json({ message: 'Failed to fetch registrations', error: error.message });
    }
});

router.put('/assign-room', async (req, res) => {
    try {
        const { registrationId, personId, role, building, floor, roomNumber } = req.body;

        if (!registrationId || !personId || !role || !building || !floor || !roomNumber) {
            return res.status(400).json({ message: 'Missing required fields for room allocation' });
        }

        // Verify capacity across all registrations (max 4 per room)
        const allRegistrations = await Registration.find({});
        let currentOccupants = 0;

        allRegistrations.forEach(reg => {
            if (reg.players) {
                reg.players.forEach(p => {
                    if (p.roomAllocation &&
                        p.roomAllocation.building === building &&
                        p.roomAllocation.floor === floor &&
                        p.roomAllocation.roomNumber === roomNumber &&
                        p._id.toString() !== personId.toString()) {
                        currentOccupants++;
                    }
                });
            }
            if (reg.coaches) {
                reg.coaches.forEach(c => {
                    if (c.roomAllocation &&
                        c.roomAllocation.building === building &&
                        c.roomAllocation.floor === floor &&
                        c.roomAllocation.roomNumber === roomNumber &&
                        c._id.toString() !== personId.toString()) {
                        currentOccupants++;
                    }
                });
            }
        });

        if (currentOccupants >= 4) {
            return res.status(400).json({ message: 'This room has reached maximum capacity of 4 members.' });
        }

        const allocationData = {
            building,
            floor,
            roomNumber,
            allocatedAt: new Date()
        };

        if (role === 'Player') {
            await Registration.updateOne(
                { _id: registrationId, 'players._id': personId },
                { $set: { 'players.$.roomAllocation': allocationData } }
            );
        } else {
            await Registration.updateOne(
                { _id: registrationId, 'coaches._id': personId },
                { $set: { 'coaches.$.roomAllocation': allocationData } }
            );
        }

        // Emit real-time socket event
        try {
            require('../socket').getIO().emit('dataUpdated');
        } catch (socketErr) {
            console.error('Socket emit error:', socketErr);
        }

        res.status(200).json({ message: 'Room allocated successfully', allocation: allocationData });
    } catch (error) {
        console.error('Error assigning room:', error);
        res.status(500).json({ message: 'Failed to assign room', error: error.message });
    }
});

router.put('/unassign-room', async (req, res) => {
    try {
        const { registrationId, personId, role } = req.body;

        if (!registrationId || !personId || !role) {
            return res.status(400).json({ message: 'Missing registrationId, personId, or role' });
        }

        if (role === 'Player') {
            await Registration.updateOne(
                { _id: registrationId, 'players._id': personId },
                { $unset: { 'players.$.roomAllocation': 1 } }
            );
        } else {
            await Registration.updateOne(
                { _id: registrationId, 'coaches._id': personId },
                { $unset: { 'coaches.$.roomAllocation': 1 } }
            );
        }

        try {
            require('../socket').getIO().emit('dataUpdated');
        } catch (socketErr) {
            console.error('Socket emit error:', socketErr);
        }

        res.status(200).json({ message: 'Room unassigned successfully' });
    } catch (error) {
        console.error('Error unassigning room:', error);
        res.status(500).json({ message: 'Failed to unassign room', error: error.message });
    }
});

module.exports = router;
