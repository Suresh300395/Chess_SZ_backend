const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Registration = require('../models/Registration');
const User = require('../models/User');
const HostelBlock = require('../models/HostelBlock');
const { verifyToken, requireAdmin } = require('../Modules/authMiddleware');

const registrationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many registration requests. Please try again later.' }
});

const searchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many search requests. Please try again later.' }
});

/**
 * Helper: Escapes special regex characters in a query string
 */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/registration/search-universities
 * Public debounced search for existing universities with sanitized records
 */
router.get('/search-universities', searchLimiter, async (req, res) => {
    try {
        const query = (req.query.q || req.query.query || '').trim();
        if (!query || query.length < 2) {
            return res.json([]);
        }

        const escaped = escapeRegex(query);
        const universities = await Registration.find(
            { universityName: { $regex: escaped, $options: 'i' } }
        ).sort({ createdAt: -1 }).limit(15).lean();

        const results = universities.map(uni => ({
            _id: uni._id,
            universityName: uni.universityName,
            universityContact: uni.universityContact,
            address: uni.address,
            players: (uni.players || []).map(p => ({
                _id: p._id,
                playerName: p.playerName,
                mobileNo: p.mobileNo,
                gender: p.gender,
                dob: p.dob,
                transportMode: p.transportMode,
                transportNumber: p.transportNumber || '',
                arrivalDate: p.arrivalDate,
                arrivalTime: p.arrivalTime,
                departureDate: p.departureDate,
                departureTime: p.departureTime,
                accommodation: p.accommodation,
                photo: p.photo || '',
                roomAllocation: p.roomAllocation
            })),
            coaches: (uni.coaches || []).map(c => ({
                _id: c._id,
                role: c.role,
                name: c.name,
                mobileNo: c.mobileNo,
                mailId: c.mailId,
                gender: c.gender,
                foodType: c.foodType,
                accommodation: c.accommodation,
                photo: c.photo || '',
                roomAllocation: c.roomAllocation
            }))
        }));

        res.json(results);
    } catch (error) {
        console.error('Error searching universities:', error);
        res.status(500).json({ error: 'Failed to search universities' });
    }
});

/**
 * GET /api/registration/university/:id
 * Public endpoint to fetch full registration record of an existing university
 */
router.get('/university/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid university ID' });
        }

        const university = await Registration.findById(id).lean();
        if (!university) {
            return res.status(404).json({ error: 'University not found' });
        }

        res.json({
            _id: university._id,
            universityName: university.universityName,
            universityContact: university.universityContact,
            address: university.address,
            players: (university.players || []).map(p => ({
                _id: p._id,
                playerName: p.playerName,
                mobileNo: p.mobileNo,
                gender: p.gender,
                dob: p.dob,
                transportMode: p.transportMode,
                transportNumber: p.transportNumber || '',
                arrivalDate: p.arrivalDate,
                arrivalTime: p.arrivalTime,
                departureDate: p.departureDate,
                departureTime: p.departureTime,
                accommodation: p.accommodation,
                photo: p.photo || '',
                roomAllocation: p.roomAllocation
            })),
            coaches: (university.coaches || []).map(c => ({
                _id: c._id,
                role: c.role,
                name: c.name,
                mobileNo: c.mobileNo,
                mailId: c.mailId,
                gender: c.gender,
                foodType: c.foodType,
                accommodation: c.accommodation,
                photo: c.photo || '',
                roomAllocation: c.roomAllocation
            }))
        });
    } catch (error) {
        console.error('Error fetching university:', error);
        res.status(500).json({ error: 'Failed to fetch university details' });
    }
});

/**
 * POST /api/registration
 * Handles new university registration as well as adding new members to an existing university
 */
router.post('/', registrationLimiter, async (req, res) => {
    try {
        const { universityId, teamDetails, players = [], coaches = [] } = req.body;

        const mobileRegex = /^[6-9]\d{9}$/;
        const numberRegex = /[0-9]/;

        if (!teamDetails?.universityName || numberRegex.test(teamDetails.universityName)) {
            return res.status(400).json({ error: 'University name cannot contain numbers' });
        }

        const trimmedUniName = teamDetails.universityName.trim();
        const escapedUniName = escapeRegex(trimmedUniName);

        // Check if an existing university was selected by ID or matches by exact name
        let existingUniversity = null;

        if (universityId) {
            if (!mongoose.Types.ObjectId.isValid(universityId)) {
                return res.status(400).json({ error: 'Invalid university ID provided' });
            }
            existingUniversity = await Registration.findById(universityId);
            if (!existingUniversity) {
                return res.status(404).json({ error: 'Selected university was not found' });
            }
        } else {
            // Case-insensitive exact name match to detect existing university
            existingUniversity = await Registration.findOne({
                universityName: new RegExp(`^${escapedUniName}$`, 'i')
            });
        }

        const defaultPassword = process.env.DEFAULT_USER_PASSWORD || 'Aditya@123';

        // =========================================================================
        // CASE A: EXISTING UNIVERSITY DETECTED (REUSE & APPEND)
        // =========================================================================
        if (existingUniversity) {
            const authoritativePlayerIds = new Set(existingUniversity.players.map(p => p._id.toString()));
            const authoritativeCoachIds = new Set(existingUniversity.coaches.map(c => c._id.toString()));

            const submittedExistingPlayers = [];
            const genuinelyNewPlayers = [];

            if (Array.isArray(players)) {
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if (p._id) {
                        const pid = String(p._id);
                        if (!authoritativePlayerIds.has(pid)) {
                            return res.status(400).json({
                                error: `Invalid player ID: '${p._id}' does not belong to the selected university.`
                            });
                        }
                        submittedExistingPlayers.push(p);
                    } else {
                        genuinelyNewPlayers.push(p);
                    }
                }
            }

            const submittedExistingCoaches = [];
            const genuinelyNewCoaches = [];

            if (Array.isArray(coaches)) {
                for (let i = 0; i < coaches.length; i++) {
                    const c = coaches[i];
                    if (c._id) {
                        const cid = String(c._id);
                        if (!authoritativeCoachIds.has(cid)) {
                            return res.status(400).json({
                                error: `Invalid coach ID: '${c._id}' does not belong to the selected university.`
                            });
                        }
                        submittedExistingCoaches.push(c);
                    } else {
                        genuinelyNewCoaches.push(c);
                    }
                }
            }

            if (genuinelyNewPlayers.length === 0 && genuinelyNewCoaches.length === 0) {
                return res.status(400).json({
                    error: 'No new players or coaches were added to register for this university.'
                });
            }

            // Validate genuinely new players
            for (let i = 0; i < genuinelyNewPlayers.length; i++) {
                const p = genuinelyNewPlayers[i];
                if (!p.playerName || numberRegex.test(p.playerName)) {
                    return res.status(400).json({ error: `New Player ${i + 1}: Name cannot contain numbers` });
                }
                if (!p.mobileNo || !mobileRegex.test(p.mobileNo)) {
                    return res.status(400).json({ error: `New Player ${i + 1}: Mobile number must be exactly 10 digits starting with 6, 7, 8, or 9` });
                }
                if (!p.gender) {
                    return res.status(400).json({ error: `New Player ${i + 1}: Gender is required` });
                }
                if (!p.dob) {
                    return res.status(400).json({ error: `New Player ${i + 1}: DOB is required` });
                }
                if (!p.transportMode) {
                    return res.status(400).json({ error: `New Player ${i + 1}: Transport mode is required` });
                }
                if ((p.transportMode === 'Train' || p.transportMode === 'Flight') && !p.transportNumber) {
                    return res.status(400).json({ error: `New Player ${i + 1}: ${p.transportMode} number is required` });
                }
                if (!p.arrivalDate || !p.arrivalTime || !p.departureDate || !p.departureTime) {
                    return res.status(400).json({ error: `New Player ${i + 1}: Arrival and departure dates and times are required` });
                }
            }

            // Validate genuinely new coaches
            for (let i = 0; i < genuinelyNewCoaches.length; i++) {
                const c = genuinelyNewCoaches[i];
                if (!c.role) {
                    return res.status(400).json({ error: `New Coach/Manager ${i + 1}: Role is required` });
                }
                if (!c.name || numberRegex.test(c.name)) {
                    return res.status(400).json({ error: `New Coach/Manager ${i + 1}: Name cannot contain numbers` });
                }
                if (!c.mobileNo || !mobileRegex.test(c.mobileNo)) {
                    return res.status(400).json({ error: `New Coach/Manager ${i + 1}: Mobile number must be exactly 10 digits starting with 6, 7, 8, or 9` });
                }
                if (!c.mailId || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(c.mailId)) {
                    return res.status(400).json({ error: `New Coach/Manager ${i + 1}: Valid email address is required` });
                }
                if (!c.gender) {
                    return res.status(400).json({ error: `New Coach/Manager ${i + 1}: Gender is required` });
                }
            }

            // Duplicate checks in the submitted new entries
            const seenMobilesInForm = new Map();
            const seenEmailsInForm = new Map();

            for (let i = 0; i < genuinelyNewPlayers.length; i++) {
                const mob = genuinelyNewPlayers[i].mobileNo?.trim();
                if (mob) {
                    if (seenMobilesInForm.has(mob)) {
                        return res.status(400).json({
                            error: `Duplicate mobile number '${mob}' in form (New Player ${i + 1} and ${seenMobilesInForm.get(mob)}). Each participant must have a unique mobile number.`
                        });
                    }
                    seenMobilesInForm.set(mob, `New Player ${i + 1}`);
                }
            }

            for (let i = 0; i < genuinelyNewCoaches.length; i++) {
                const mob = genuinelyNewCoaches[i].mobileNo?.trim();
                const email = genuinelyNewCoaches[i].mailId?.trim().toLowerCase();

                if (mob) {
                    if (seenMobilesInForm.has(mob)) {
                        return res.status(400).json({
                            error: `Duplicate mobile number '${mob}' in form (New Coach/Manager ${i + 1} and ${seenMobilesInForm.get(mob)}). Each participant must have a unique mobile number.`
                        });
                    }
                    seenMobilesInForm.set(mob, `New Coach/Manager ${i + 1}`);
                }

                if (email) {
                    if (seenEmailsInForm.has(email)) {
                        return res.status(400).json({
                            error: `Duplicate email '${email}' in form (New Coach/Manager ${i + 1} and Coach/Manager ${seenEmailsInForm.get(email)}). Each coach must have a unique email address.`
                        });
                    }
                    seenEmailsInForm.set(email, i + 1);
                }
            }

            // Check for duplicate mobile numbers against existing registrations in DB
            const allSubmittedNewMobiles = Array.from(seenMobilesInForm.keys());
            if (allSubmittedNewMobiles.length > 0) {
                const existingWithMobile = await Registration.findOne({
                    $or: [
                        { 'players.mobileNo': { $in: allSubmittedNewMobiles } },
                        { 'coaches.mobileNo': { $in: allSubmittedNewMobiles } }
                    ]
                });

                if (existingWithMobile) {
                    for (const mob of allSubmittedNewMobiles) {
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

            // Check for duplicate coach email IDs against existing registrations in DB
            const allSubmittedNewEmails = Array.from(seenEmailsInForm.keys());
            if (allSubmittedNewEmails.length > 0) {
                const emailRegexList = allSubmittedNewEmails.map(e => new RegExp(`^${escapeRegex(e)}$`, 'i'));
                const existingWithEmail = await Registration.findOne({
                    'coaches.mailId': { $in: emailRegexList }
                });

                if (existingWithEmail) {
                    for (const email of allSubmittedNewEmails) {
                        const existingCoach = existingWithEmail.coaches?.find(c => (c.mailId || '').toLowerCase() === email);
                        if (existingCoach) {
                            return res.status(400).json({
                                error: `Email address '${existingCoach.mailId}' is already registered for coach '${existingCoach.name}' (${existingWithEmail.universityName}). Duplicate entries are not allowed.`
                            });
                        }
                    }
                }
            }

            // Build new subdocuments to append
            const playersToPush = genuinelyNewPlayers.map(p => ({
                _id: new mongoose.Types.ObjectId(),
                playerName: p.playerName.trim(),
                mobileNo: p.mobileNo.trim(),
                gender: p.gender,
                dob: p.dob,
                transportMode: p.transportMode,
                transportNumber: p.transportNumber || '',
                arrivalDate: p.arrivalDate,
                arrivalTime: p.arrivalTime,
                departureDate: p.departureDate,
                departureTime: p.departureTime,
                accommodation: p.accommodation || 'Yes',
                photo: p.photo || ''
            }));

            const coachesToPush = genuinelyNewCoaches.map(c => ({
                _id: new mongoose.Types.ObjectId(),
                role: c.role,
                name: c.name.trim(),
                mobileNo: c.mobileNo.trim(),
                mailId: c.mailId.trim().toLowerCase(),
                gender: c.gender,
                foodType: c.foodType || 'Veg',
                accommodation: c.accommodation || 'Yes',
                photo: c.photo || ''
            }));

            const updateOps = {};
            if (playersToPush.length > 0) updateOps.players = { $each: playersToPush };
            if (coachesToPush.length > 0) updateOps.coaches = { $each: coachesToPush };

            // Atomically append new players and coaches into the SAME university document
            const updatedRegistration = await Registration.findByIdAndUpdate(
                existingUniversity._id,
                { $push: updateOps },
                { new: true, runValidators: true }
            );

            // Create accounts ONLY for new participants (with rollback on failure)
            const createdUserIds = [];
            const pushedPlayerIds = playersToPush.map(p => p._id);
            const pushedCoachIds = coachesToPush.map(c => c._id);
            let accountsCreated = 0;
            const sampleCredentials = [];

            try {
                for (const p of playersToPush) {
                    const mobile = p.mobileNo;
                    let existingUser = await User.findOne({ username: mobile });
                    if (!existingUser) {
                        const newUser = await User.create({
                            username: mobile,
                            name: p.playerName,
                            password: defaultPassword,
                            mobile: mobile,
                            role: 'player',
                            registrationId: existingUniversity._id,
                            participantId: p._id,
                            participantType: 'player'
                        });
                        createdUserIds.push(newUser._id);
                        accountsCreated++;
                        if (sampleCredentials.length === 0) {
                            sampleCredentials.push({
                                name: p.playerName,
                                mobile: mobile,
                                password: defaultPassword,
                                role: 'player'
                            });
                        }
                    } else {
                        if (['admin', 'superadmin'].includes(existingUser.role)) {
                            continue;
                        }
                        existingUser.registrationId = existingUniversity._id;
                        existingUser.participantId = p._id;
                        existingUser.participantType = 'player';
                        await existingUser.save();
                        accountsCreated++;
                    }
                }

                for (const c of coachesToPush) {
                    const mobile = c.mobileNo;
                    let existingUser = await User.findOne({ username: mobile });
                    if (!existingUser) {
                        const newUser = await User.create({
                            username: mobile,
                            name: c.name,
                            password: defaultPassword,
                            mobile: mobile,
                            role: 'coach',
                            registrationId: existingUniversity._id,
                            participantId: c._id,
                            participantType: 'coach'
                        });
                        createdUserIds.push(newUser._id);
                        accountsCreated++;
                        if (sampleCredentials.length === 0) {
                            sampleCredentials.push({
                                name: c.name,
                                mobile: mobile,
                                password: defaultPassword,
                                role: 'coach'
                            });
                        }
                    } else {
                        if (['admin', 'superadmin'].includes(existingUser.role)) {
                            continue;
                        }
                        existingUser.registrationId = existingUniversity._id;
                        existingUser.participantId = c._id;
                        existingUser.participantType = 'coach';
                        await existingUser.save();
                        accountsCreated++;
                    }
                }
            } catch (creationErr) {
                console.error('Account creation failed during existing university update. Rolling back:', creationErr);
                if (createdUserIds.length > 0) {
                    await User.deleteMany({ _id: { $in: createdUserIds } });
                }
                await Registration.findByIdAndUpdate(existingUniversity._id, {
                    $pull: {
                        players: { _id: { $in: pushedPlayerIds } },
                        coaches: { _id: { $in: pushedCoachIds } }
                    }
                });
                throw creationErr;
            }

            try {
                require('../socket').getIO().emit('dataUpdated');
            } catch (socketErr) {
                console.error('Socket emit error:', socketErr);
            }

            return res.status(200).json({
                message: 'Registration updated successfully',
                data: updatedRegistration,
                summary: {
                    totalPlayers: updatedRegistration.players?.length || 0,
                    totalCoaches: updatedRegistration.coaches?.length || 0,
                    newPlayersAdded: playersToPush.length,
                    newCoachesAdded: coachesToPush.length,
                    accountsCreated,
                    sampleCredentials: sampleCredentials[0] || null,
                    isExistingUniversity: true
                }
            });
        }

        // =========================================================================
        // CASE C: NEW UNIVERSITY REGISTRATION
        // =========================================================================
        if (!teamDetails?.universityContact || !mobileRegex.test(teamDetails.universityContact)) {
            return res.status(400).json({ error: 'University contact must be exactly 10 digits starting with 6, 7, 8, or 9' });
        }

        if (!teamDetails?.address || !teamDetails.address.trim()) {
            return res.status(400).json({ error: 'University address is required' });
        }

        // Check for duplicate university name
        const conflictCheck = await Registration.findOne({
            universityName: new RegExp(`^${escapedUniName}$`, 'i')
        });
        if (conflictCheck) {
            return res.status(409).json({
                error: `University '${teamDetails.universityName}' is already registered. Please select it from the search list to add new members.`
            });
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
                if (!p.gender) {
                    return res.status(400).json({ error: `Player ${i + 1}: Gender is required` });
                }
                if (!p.dob) {
                    return res.status(400).json({ error: `Player ${i + 1}: DOB is required` });
                }
                if (!p.transportMode) {
                    return res.status(400).json({ error: `Player ${i + 1}: Transport mode is required` });
                }
                if ((p.transportMode === 'Train' || p.transportMode === 'Flight') && !p.transportNumber) {
                    return res.status(400).json({ error: `Player ${i + 1}: ${p.transportMode} number is required` });
                }
                if (!p.arrivalDate || !p.arrivalTime || !p.departureDate || !p.departureTime) {
                    return res.status(400).json({ error: `Player ${i + 1}: Arrival and departure dates and times are required` });
                }
            }
        }

        if (Array.isArray(coaches)) {
            for (let i = 0; i < coaches.length; i++) {
                const c = coaches[i];
                if (!c.role) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Role is required` });
                }
                if (!c.name || numberRegex.test(c.name)) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Name cannot contain numbers` });
                }
                if (!c.mobileNo || !mobileRegex.test(c.mobileNo)) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Mobile number must be exactly 10 digits starting with 6, 7, 8, or 9` });
                }
                if (!c.mailId || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(c.mailId)) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Valid email address is required` });
                }
                if (!c.gender) {
                    return res.status(400).json({ error: `Coach/Manager ${i + 1}: Gender is required` });
                }
            }
        }

        // Duplicate checks within submission
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

        // Duplicate checks against existing registrations in DB
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

        const allSubmittedEmails = Array.from(seenEmailsInForm.keys());
        if (allSubmittedEmails.length > 0) {
            const emailRegexList = allSubmittedEmails.map(e => new RegExp(`^${escapeRegex(e)}$`, 'i'));
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
            universityName: teamDetails.universityName.trim(),
            universityContact: teamDetails.universityContact.trim(),
            address: teamDetails.address.trim(),
            players: (players || []).map(p => ({
                playerName: p.playerName.trim(),
                mobileNo: p.mobileNo.trim(),
                gender: p.gender,
                dob: p.dob,
                transportMode: p.transportMode,
                transportNumber: p.transportNumber || '',
                arrivalDate: p.arrivalDate,
                arrivalTime: p.arrivalTime,
                departureDate: p.departureDate,
                departureTime: p.departureTime,
                accommodation: p.accommodation || 'Yes',
                photo: p.photo || ''
            })),
            coaches: (coaches || []).map(c => ({
                role: c.role,
                name: c.name.trim(),
                mobileNo: c.mobileNo.trim(),
                mailId: c.mailId.trim().toLowerCase(),
                gender: c.gender,
                foodType: c.foodType || 'Veg',
                accommodation: c.accommodation || 'Yes',
                photo: c.photo || ''
            }))
        });

        const savedRegistration = await newRegistration.save();

        let accountsCreated = 0;
        const sampleCredentials = [];
        const createdUserIds = [];

        try {
            // 1. Create or link user accounts for each player
            if (Array.isArray(savedRegistration.players)) {
                for (const player of savedRegistration.players) {
                    const mobile = String(player.mobileNo).trim();
                    let existingUser = await User.findOne({ username: mobile });

                    if (!existingUser) {
                        const newUser = await User.create({
                            username: mobile,
                            name: player.playerName,
                            password: defaultPassword,
                            mobile: mobile,
                            role: 'player',
                            registrationId: savedRegistration._id,
                            participantId: player._id,
                            participantType: 'player'
                        });
                        createdUserIds.push(newUser._id);
                        accountsCreated++;
                        if (sampleCredentials.length === 0) {
                            sampleCredentials.push({
                                name: player.playerName,
                                mobile: mobile,
                                password: defaultPassword,
                                role: 'player'
                            });
                        }
                    } else {
                        if (['admin', 'superadmin'].includes(existingUser.role)) {
                            console.warn(`Participant registration skipped overriding admin account ${mobile}`);
                            continue;
                        }
                        existingUser.registrationId = savedRegistration._id;
                        existingUser.participantId = player._id;
                        existingUser.participantType = 'player';
                        await existingUser.save();
                        accountsCreated++;
                    }
                }
            }

            // 2. Create or link user accounts for each coach/manager
            if (Array.isArray(savedRegistration.coaches)) {
                for (const coach of savedRegistration.coaches) {
                    const mobile = String(coach.mobileNo).trim();
                    let existingUser = await User.findOne({ username: mobile });

                    if (!existingUser) {
                        const newUser = await User.create({
                            username: mobile,
                            name: coach.name,
                            password: defaultPassword,
                            mobile: mobile,
                            role: 'coach',
                            registrationId: savedRegistration._id,
                            participantId: coach._id,
                            participantType: 'coach'
                        });
                        createdUserIds.push(newUser._id);
                        accountsCreated++;
                        if (sampleCredentials.length === 0) {
                            sampleCredentials.push({
                                name: coach.name,
                                mobile: mobile,
                                password: defaultPassword,
                                role: 'coach'
                            });
                        }
                    } else {
                        if (['admin', 'superadmin'].includes(existingUser.role)) {
                            console.warn(`Participant registration skipped overriding admin account ${mobile}`);
                            continue;
                        }
                        existingUser.registrationId = savedRegistration._id;
                        existingUser.participantId = coach._id;
                        existingUser.participantType = 'coach';
                        await existingUser.save();
                        accountsCreated++;
                    }
                }
            }
        } catch (creationErr) {
            console.error('Account creation failed during new university registration. Rolling back:', creationErr);
            if (createdUserIds.length > 0) {
                await User.deleteMany({ _id: { $in: createdUserIds } });
            }
            await Registration.findByIdAndDelete(savedRegistration._id);
            throw creationErr;
        }

        // Emit event for real-time update
        try {
            require('../socket').getIO().emit('dataUpdated');
        } catch (socketErr) {
            console.error('Socket emit error:', socketErr);
        }

        res.status(201).json({
            message: 'Registration successful',
            data: savedRegistration,
            summary: {
                totalPlayers: savedRegistration.players?.length || 0,
                totalCoaches: savedRegistration.coaches?.length || 0,
                accountsCreated,
                sampleCredentials: sampleCredentials[0] || null,
                isExistingUniversity: false
            }
        });
    } catch (error) {
        console.error('Registration Error:', error);
        // Handle MongoDB duplicate key error (code 11000) for concurrent university creation
        if (error.code === 11000) {
            return res.status(409).json({
                error: 'A university with this name already exists. Please select it from the search list to add members.'
            });
        }
        res.status(500).json({ message: 'Server error during registration' });
    }
});

router.get('/', verifyToken, requireAdmin, async (req, res) => {
    try {
        const registrations = await Registration.find().sort({ createdAt: -1 });
        res.status(200).json(registrations);
    } catch (error) {
        console.error('Error fetching registrations:', error);
        res.status(500).json({ message: 'Failed to fetch registrations' });
    }
});

router.put('/assign-room', verifyToken, requireAdmin, async (req, res) => {
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
        res.status(500).json({ message: 'Failed to assign room' });
    }
});

router.put('/bulk-assign-room', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { allocations, building, floor, roomNumber } = req.body;

        if (!Array.isArray(allocations) || allocations.length === 0 || !building || !floor || !roomNumber) {
            return res.status(400).json({ message: 'Missing required fields or allocations array' });
        }

        // Determine capacity of this block
        let capacity = 4;
        try {
            const blockObj = await HostelBlock.findOne({ name: building });
            if (blockObj && blockObj.capacityPerRoom) {
                capacity = blockObj.capacityPerRoom;
            }
        } catch (e) {
            console.error('Error fetching block capacity:', e);
        }

        // Count current occupants in this room (excluding any participant that is in allocations)
        const allocationPersonIds = new Set(allocations.map(a => a.personId.toString()));
        const allRegistrations = await Registration.find({});
        let currentOccupants = 0;

        allRegistrations.forEach(reg => {
            if (reg.players) {
                reg.players.forEach(p => {
                    if (p.roomAllocation &&
                        p.roomAllocation.building === building &&
                        p.roomAllocation.floor === floor &&
                        p.roomAllocation.roomNumber === roomNumber &&
                        !allocationPersonIds.has(p._id.toString())) {
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
                        !allocationPersonIds.has(c._id.toString())) {
                        currentOccupants++;
                    }
                });
            }
        });

        const availableSlots = capacity - currentOccupants;
        if (allocations.length > availableSlots) {
            return res.status(400).json({
                message: `Room ${roomNumber} can only fit ${availableSlots} more member(s) (Capacity: ${capacity}, Already Occupied: ${currentOccupants}). You attempted to allot ${allocations.length}.`
            });
        }

        const allocationData = {
            building,
            floor,
            roomNumber,
            allocatedAt: new Date()
        };

        // Update each participant's room allocation
        for (const item of allocations) {
            if (item.role === 'Player') {
                await Registration.updateOne(
                    { _id: item.registrationId, 'players._id': item.personId },
                    { $set: { 'players.$.roomAllocation': allocationData } }
                );
            } else {
                await Registration.updateOne(
                    { _id: item.registrationId, 'coaches._id': item.personId },
                    { $set: { 'coaches.$.roomAllocation': allocationData } }
                );
            }
        }

        // Emit real-time socket event
        try {
            require('../socket').getIO().emit('dataUpdated');
        } catch (socketErr) {
            console.error('Socket emit error:', socketErr);
        }

        res.status(200).json({
            message: `Room ${roomNumber} successfully allotted to ${allocations.length} member(s)!`,
            allocation: allocationData,
            count: allocations.length
        });
    } catch (error) {
        console.error('Error in bulk room assignment:', error);
        res.status(500).json({ message: 'Failed to complete bulk room assignment' });
    }
});

router.put('/unassign-room', verifyToken, requireAdmin, async (req, res) => {
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

        // Check if registration still has any allotted members left
        const updatedReg = await Registration.findById(registrationId);
        if (updatedReg) {
            const hasAnyAllocated = (updatedReg.players || []).some(p => p.roomAllocation && p.roomAllocation.roomNumber) ||
                                    (updatedReg.coaches || []).some(c => c.roomAllocation && c.roomAllocation.roomNumber);
            if (!hasAnyAllocated && updatedReg.cautionDeposit && updatedReg.cautionDeposit.paid) {
                updatedReg.cautionDeposit = {
                    paid: false,
                    amount: 2000,
                    paidBy: { personId: '', name: '', role: '', phone: '', roomNumber: '' },
                    paymentMode: 'Cash',
                    receiptNo: '',
                    notes: '',
                    refundStatus: 'N/A',
                    refundedAmount: 0
                };
                await updatedReg.save();
            }
        }

        try {
            require('../socket').getIO().emit('dataUpdated');
        } catch (socketErr) {
            console.error('Socket emit error:', socketErr);
        }

        res.status(200).json({ message: 'Room unassigned successfully' });
    } catch (error) {
        console.error('Error unassigning room:', error);
        res.status(500).json({ message: 'Failed to unassign room' });
    }
});

// Record manual caution deposit payment
router.put('/caution-deposit', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { registrationId, universityName, paidBy, amount, paymentMode, notes, receiptNo } = req.body;

        let query = {};
        if (registrationId && mongoose.Types.ObjectId.isValid(registrationId)) {
            query._id = registrationId;
        } else if (universityName) {
            query.universityName = universityName;
        } else {
            return res.status(400).json({ message: 'Missing registrationId or universityName' });
        }

        const registration = await Registration.findOne(query);
        if (!registration) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        const generatedReceiptNo = receiptNo || `CD-${Date.now().toString().slice(-6)}`;
        const depositData = {
            paid: true,
            amount: Number(amount) || 2000,
            paidBy: {
                personId: paidBy?.personId || '',
                name: paidBy?.name || 'Representative',
                role: paidBy?.role || 'Player',
                phone: paidBy?.phone || '',
                roomNumber: paidBy?.roomNumber || ''
            },
            paymentMode: paymentMode || 'Cash',
            receiptNo: generatedReceiptNo,
            paidAt: new Date(),
            collectedBy: req.user?.username || req.user?.name || 'Hostel Admin',
            notes: notes || 'Cash collected manually at hostel counter',
            refundStatus: 'Refund Pending',
            refundedAmount: 0
        };

        registration.cautionDeposit = depositData;
        await registration.save();

        try {
            require('../socket').getIO().emit('dataUpdated');
            require('../socket').getIO().emit('caution_deposit_updated', {
                universityName: registration.universityName,
                cautionDeposit: depositData
            });
        } catch (socketErr) {
            console.error('Socket error in caution deposit update:', socketErr);
        }

        res.status(200).json({
            message: `Caution deposit of ₹${depositData.amount} successfully recorded for ${registration.universityName}!`,
            cautionDeposit: depositData
        });
    } catch (error) {
        console.error('Error recording caution deposit:', error);
        res.status(500).json({ message: 'Failed to record caution deposit payment' });
    }
});

// Mark caution deposit as refunded
router.put('/caution-deposit/refund', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { registrationId, universityName, refundedAmount } = req.body;
        let query = {};
        if (registrationId && mongoose.Types.ObjectId.isValid(registrationId)) {
            query._id = registrationId;
        } else if (universityName) {
            query.universityName = universityName;
        } else {
            return res.status(400).json({ message: 'Missing registrationId or universityName' });
        }

        const registration = await Registration.findOne(query);
        if (!registration) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        if (!registration.cautionDeposit || !registration.cautionDeposit.paid) {
            return res.status(400).json({ message: 'Caution deposit has not been paid yet' });
        }

        registration.cautionDeposit.refundStatus = 'Refunded';
        registration.cautionDeposit.refundedAt = new Date();
        registration.cautionDeposit.refundedAmount = Number(refundedAmount) || registration.cautionDeposit.amount || 2000;
        await registration.save();

        try {
            require('../socket').getIO().emit('dataUpdated');
        } catch (sErr) {}

        res.status(200).json({
            message: `Caution deposit marked as refunded for ${registration.universityName}`,
            cautionDeposit: registration.cautionDeposit
        });
    } catch (error) {
        console.error('Error refunding caution deposit:', error);
        res.status(500).json({ message: 'Failed to process caution deposit refund' });
    }
});

// Reset / delete caution deposit payment
router.delete('/caution-deposit', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { registrationId, universityName } = req.body;
        let query = {};
        if (registrationId && mongoose.Types.ObjectId.isValid(registrationId)) {
            query._id = registrationId;
        } else if (universityName) {
            query.universityName = universityName;
        } else {
            return res.status(400).json({ message: 'Missing registrationId or universityName' });
        }

        const registration = await Registration.findOne(query);
        if (!registration) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        registration.cautionDeposit = {
            paid: false,
            amount: 2000,
            paidBy: { personId: '', name: '', role: '', phone: '', roomNumber: '' },
            paymentMode: 'Cash',
            receiptNo: '',
            notes: '',
            refundStatus: 'N/A',
            refundedAmount: 0
        };
        await registration.save();

        try {
            require('../socket').getIO().emit('dataUpdated');
        } catch (sErr) {}

        res.status(200).json({ message: 'Caution deposit reset successfully' });
    } catch (error) {
        console.error('Error resetting caution deposit:', error);
        res.status(500).json({ message: 'Failed to reset caution deposit' });
    }
});

module.exports = router;
