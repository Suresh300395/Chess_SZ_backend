const mongoose = require('mongoose');
const { FoodToken, generateSecureCode } = require('../models/FoodToken');
const Registration = require('../models/Registration');
const { MEAL_TYPES, EVENT_NAME, getTodayString } = require('../config/mealConfig');

// Helper to safely get Socket.io instance
const emitSocketUpdate = () => {
    try {
        const socket = require('../socket');
        if (socket && socket.getIO()) {
            socket.getIO().emit('foodTokenUpdated');
        }
    } catch (e) {
        // Socket may not be initialized in test environments
    }
};

// Helper to escape regex special characters to prevent ReDoS
const escapeRegex = (string) => {
    if (typeof string !== 'string') return '';
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * 1. Search people eligible for tokens (Players, Coaches, Managers)
 * GET /api/food-tokens/people?search=
 */
exports.getPeople = async (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const mealDate = getTodayString();
        const searchRegex = new RegExp(escapeRegex(search), 'i');

        const people = [];

        // 1. Search Registrations (Players & Coaches)
        const regFilter = search ? {
            $or: [
                { universityName: searchRegex },
                { 'players.playerName': searchRegex },
                { 'players.mobileNo': searchRegex },
                { 'coaches.name': searchRegex },
                { 'coaches.mobileNo': searchRegex }
            ]
        } : {};

        const registrations = await Registration.find(regFilter).lean();

        for (const reg of registrations) {
            // Determine team arrival and departure dates as fallback for coaches
            const teamArrivalDates = (reg.players || []).map(p => p.arrivalDate).filter(Boolean).sort();
            const teamDepartureDates = (reg.players || []).map(p => p.departureDate).filter(Boolean).sort();
            const fallbackArrival = teamArrivalDates[0] || '';
            const fallbackDeparture = teamDepartureDates[teamDepartureDates.length - 1] || '';

            // Process Players
            if (Array.isArray(reg.players)) {
                for (const player of reg.players) {
                    if (!search || searchRegex.test(player.playerName) || searchRegex.test(player.mobileNo) || searchRegex.test(reg.universityName)) {
                        const rawDeparture = (player.departureDate || '').trim();
                        const hasDep = Boolean(rawDeparture);
                        people.push({
                            personType: 'PLAYER',
                            personRef: player._id,
                            registrationId: reg._id,
                            name: player.playerName,
                            identifier: player.mobileNo,
                            roleLabel: 'Player',
                            teamOrSport: reg.universityName,
                            gender: player.gender || '',
                            arrivalDate: player.arrivalDate || fallbackArrival,
                            arrivalTime: player.arrivalTime || '',
                            departureDate: rawDeparture,
                            departureTime: (player.departureTime || '').trim(),
                            hasDepartureDate: hasDep,
                            block: player.roomAllocation?.building || '',
                            room: player.roomAllocation?.roomNumber || '',
                            floor: player.roomAllocation?.floor || ''
                        });
                    }
                }
            }

            // Process Coaches / Managers
            if (Array.isArray(reg.coaches)) {
                for (const coach of reg.coaches) {
                    if (!search || searchRegex.test(coach.name) || searchRegex.test(coach.mobileNo) || searchRegex.test(reg.universityName)) {
                        const roleUpper = (coach.role || '').toUpperCase();
                        const isManager = roleUpper.includes('MANAGER');
                        const hasDep = Boolean(fallbackDeparture);
                        people.push({
                            personType: isManager ? 'MANAGER' : 'COACH',
                            personRef: coach._id,
                            registrationId: reg._id,
                            name: coach.name,
                            identifier: coach.mobileNo,
                            roleLabel: coach.role || (isManager ? 'Manager' : 'Coach'),
                            teamOrSport: reg.universityName,
                            gender: coach.gender || '',
                            arrivalDate: fallbackArrival,
                            departureDate: fallbackDeparture,
                            departureTime: '',
                            hasDepartureDate: hasDep,
                            block: coach.roomAllocation?.building || '',
                            room: coach.roomAllocation?.roomNumber || '',
                            floor: coach.roomAllocation?.floor || ''
                        });
                    }
                }
            }
        }

        // Limit results to 200 for performance (allows full contingent results for university searches)
        const limitedPeople = people.slice(0, 200);

        // Fetch ALL existing active tokens for these people across their entire stay
        const personRefs = limitedPeople.map(p => p.personRef);
        const existingTokens = await FoodToken.find({
            personRef: { $in: personRefs },
            status: { $ne: 'CANCELLED' }
        }).lean();

        // Map tokens back to people grouped by date and mealType
        const tokenMapByDate = {};
        const tokenMapToday = {};
        const todayStr = getTodayString();

        for (const token of existingTokens) {
            const pKey = token.personRef.toString();
            if (!tokenMapByDate[pKey]) tokenMapByDate[pKey] = {};
            if (!tokenMapByDate[pKey][token.mealDate]) tokenMapByDate[pKey][token.mealDate] = {};

            const tokenInfo = {
                id: token._id,
                _id: token._id,
                code: token.code,
                status: token.status,
                mealType: token.mealType,
                mealDate: token.mealDate,
                issuedAt: token.issuedAt,
                printCount: token.printCount
            };

            tokenMapByDate[pKey][token.mealDate][token.mealType] = tokenInfo;

            if (token.mealDate === todayStr) {
                if (!tokenMapToday[pKey]) tokenMapToday[pKey] = {};
                tokenMapToday[pKey][token.mealType] = tokenInfo;
            }
        }

        const enrichedPeople = limitedPeople.map(p => {
            const pKey = p.personRef.toString();
            return {
                ...p,
                tokensByDate: tokenMapByDate[pKey] || {},
                tokensToday: tokenMapToday[pKey] || {}
            };
        });

        res.status(200).json({
            count: enrichedPeople.length,
            totalFound: people.length,
            mealDate,
            people: enrichedPeople
        });
    } catch (error) {
        console.error('Error in getPeople:', error);
        res.status(500).json({ message: 'Failed to search participants', error: error.message });
    }
};

/**
 * 2. Issue Token for a single person
 * POST /api/food-tokens/issue
 */
exports.issueToken = async (req, res) => {
    try {
        const { personType, personRef, mealType } = req.body;
        const mealDate = (req.body.mealDate || getTodayString()).trim();

        if (!personType || !personRef || !mealType) {
            return res.status(400).json({ message: 'personType, personRef, and mealType are required' });
        }

        if (!MEAL_TYPES.includes(mealType)) {
            return res.status(400).json({ message: `Invalid mealType. Allowed: ${MEAL_TYPES.join(', ')}` });
        }

        // Look up snapshot details from existing records
        let snapshot = null;
        let personTypeModel = 'Registration';

        if (personType === 'PLAYER' || personType === 'COACH' || personType === 'MANAGER') {
            const reg = await Registration.findOne({
                $or: [
                    { 'players._id': personRef },
                    { 'coaches._id': personRef }
                ]
            }).lean();

            if (!reg) {
                return res.status(404).json({ message: 'Participant not found in registrations' });
            }

            const player = reg.players?.find(p => p._id.toString() === personRef.toString());
            const coach = reg.coaches?.find(c => c._id.toString() === personRef.toString());
            const person = player || coach;
            if (!person) {
                return res.status(404).json({ message: 'Participant not found in registration' });
            }

            const personDeparture = player ? (player.departureDate || '').trim() : ((reg.players || []).map(p => p.departureDate).filter(Boolean).sort().pop() || '');
            if (!personDeparture) {
                return res.status(400).json({
                    message: `Cannot issue token for ${person.playerName || person.name}: Departure date is missing. Please enter departure details first.`
                });
            }

            snapshot = {
                name: person.playerName || person.name,
                identifier: person.mobileNo,
                teamOrSport: reg.universityName,
                block: person.roomAllocation?.building || '',
                room: person.roomAllocation?.roomNumber || '',
                eventName: EVENT_NAME
            };
        } else {
            return res.status(400).json({ message: 'Invalid personType. Food tokens are only eligible for Players, Coaches, and Managers.' });
        }

        // Check if token already exists to provide clean 409
        const existingToken = await FoodToken.findOne({
            personType,
            personRef,
            mealType,
            mealDate
        });

        if (existingToken) {
            return res.status(409).json({
                message: `Token already issued for ${snapshot.name} (${mealType} on ${mealDate}).`,
                existingToken,
                printPayload: {
                    code: existingToken.code,
                    name: existingToken.name,
                    identifier: existingToken.identifier,
                    teamOrSport: existingToken.teamOrSport,
                    block: existingToken.block,
                    room: existingToken.room,
                    eventName: existingToken.eventName,
                    mealType: existingToken.mealType,
                    mealDate: existingToken.mealDate,
                    issuedAt: existingToken.issuedAt
                }
            });
        }

        // Retry loop to guarantee uniqueness of generated code
        let newToken = null;
        let attempts = 0;
        const maxAttempts = 5;

        while (!newToken && attempts < maxAttempts) {
            attempts++;
            const code = generateSecureCode(10);
            try {
                newToken = await FoodToken.create({
                    code,
                    personType,
                    personRef,
                    personTypeModel,
                    name: snapshot.name,
                    identifier: snapshot.identifier,
                    teamOrSport: snapshot.teamOrSport,
                    block: snapshot.block,
                    room: snapshot.room,
                    eventName: snapshot.eventName,
                    mealType,
                    mealDate,
                    status: 'ISSUED',
                    issuedBy: req.user?.username || 'admin',
                    issuedAt: new Date(),
                    printCount: 1,
                    lastPrintedAt: new Date(),
                    auditLog: [{
                        action: 'ISSUE',
                        performedBy: req.user?.username || 'admin',
                        timestamp: new Date(),
                        details: `Issued token for ${mealType} on ${mealDate}`
                    }]
                });
            } catch (err) {
                // Duplicate code error (code 11000) -> retry with new code
                if (err.code === 11000 && err.keyPattern?.code) {
                    continue;
                }
                // Duplicate person/meal/date error -> return 409
                if (err.code === 11000) {
                    const dup = await FoodToken.findOne({ personType, personRef, mealType, mealDate });
                    return res.status(409).json({
                        message: `Token already exists for this person and meal.`,
                        existingToken: dup
                    });
                }
                throw err;
            }
        }

        if (!newToken) {
            return res.status(500).json({ message: 'Failed to generate a unique token code. Please retry.' });
        }

        emitSocketUpdate();

        const printPayload = {
            code: newToken.code,
            name: newToken.name,
            identifier: newToken.identifier,
            teamOrSport: newToken.teamOrSport,
            block: newToken.block,
            room: newToken.room,
            eventName: newToken.eventName,
            mealType: newToken.mealType,
            mealDate: newToken.mealDate,
            issuedAt: newToken.issuedAt
        };

        res.status(201).json({
            message: 'Token issued successfully',
            token: newToken,
            printPayload
        });
    } catch (error) {
        console.error('Error in issueToken:', error);
        res.status(500).json({ message: 'Failed to issue token', error: error.message });
    }
};

/**
 * 3. Issue Bulk Tokens (for whole team/university or selected participants)
 * POST /api/food-tokens/issue-bulk
 */
exports.issueBulk = async (req, res) => {
    try {
        const { registrationId, personRefs, universityName, mealType, selections } = req.body;
        const fallbackDate = (req.body.mealDate || getTodayString()).trim();

        if (!registrationId && (!Array.isArray(personRefs) || personRefs.length === 0) && !universityName) {
            return res.status(400).json({ message: 'registrationId, personRefs, or universityName is required' });
        }

        let targetItems = [];
        if (Array.isArray(selections) && selections.length > 0) {
            targetItems = selections.filter(s => s && s.mealType && MEAL_TYPES.includes(s.mealType)).map(s => ({
                mealType: s.mealType,
                mealDate: (s.mealDate || fallbackDate).trim()
            }));
        } else if (mealType && MEAL_TYPES.includes(mealType)) {
            targetItems = [{
                mealType,
                mealDate: fallbackDate
            }];
        }

        if (targetItems.length === 0) {
            return res.status(400).json({ message: 'Valid mealType or selections array is required' });
        }

        const participants = [];

        // 1. If specific personRefs are passed (multi-selection)
        if (Array.isArray(personRefs) && personRefs.length > 0) {
            const requestedRefs = new Set(personRefs.map(r => r.toString()));
            const registrations = await Registration.find({
                $or: [
                    { 'players._id': { $in: personRefs } },
                    { 'coaches._id': { $in: personRefs } }
                ]
            }).lean();

            for (const reg of registrations) {
                if (Array.isArray(reg.players)) {
                    for (const p of reg.players) {
                        if (requestedRefs.has(p._id.toString())) {
                            participants.push({
                                personType: 'PLAYER',
                                personRef: p._id,
                                registrationId: reg._id,
                                name: p.playerName,
                                identifier: p.mobileNo,
                                teamOrSport: reg.universityName,
                                block: p.roomAllocation?.building || '',
                                room: p.roomAllocation?.roomNumber || ''
                            });
                        }
                    }
                }
                if (Array.isArray(reg.coaches)) {
                    for (const c of reg.coaches) {
                        if (requestedRefs.has(c._id.toString())) {
                            const isManager = (c.role || '').toUpperCase().includes('MANAGER');
                            participants.push({
                                personType: isManager ? 'MANAGER' : 'COACH',
                                personRef: c._id,
                                registrationId: reg._id,
                                name: c.name,
                                identifier: c.mobileNo,
                                teamOrSport: reg.universityName,
                                block: c.roomAllocation?.building || '',
                                room: c.roomAllocation?.roomNumber || ''
                            });
                        }
                    }
                }
            }
        } else if (registrationId) {
            // 2. Existing registrationId based flow
            const reg = await Registration.findById(registrationId).lean();
            if (!reg) {
                return res.status(404).json({ message: 'Registration not found' });
            }

            if (Array.isArray(reg.players)) {
                reg.players.forEach(p => participants.push({
                    personType: 'PLAYER',
                    personRef: p._id,
                    registrationId: reg._id,
                    name: p.playerName,
                    identifier: p.mobileNo,
                    teamOrSport: reg.universityName,
                    block: p.roomAllocation?.building || '',
                    room: p.roomAllocation?.roomNumber || ''
                }));
            }
            if (Array.isArray(reg.coaches)) {
                reg.coaches.forEach(c => {
                    const isManager = (c.role || '').toUpperCase().includes('MANAGER');
                    participants.push({
                        personType: isManager ? 'MANAGER' : 'COACH',
                        personRef: c._id,
                        registrationId: reg._id,
                        name: c.name,
                        identifier: c.mobileNo,
                        teamOrSport: reg.universityName,
                        block: c.roomAllocation?.building || '',
                        room: c.roomAllocation?.roomNumber || ''
                    });
                });
            }
        } else if (universityName) {
            // 3. All people from a specific university
            const trimmedUniv = universityName.trim();
            const registrations = await Registration.find({
                universityName: new RegExp('^' + trimmedUniv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
            }).lean();

            for (const reg of registrations) {
                if (Array.isArray(reg.players)) {
                    reg.players.forEach(p => participants.push({
                        personType: 'PLAYER',
                        personRef: p._id,
                        registrationId: reg._id,
                        name: p.playerName,
                        identifier: p.mobileNo,
                        teamOrSport: reg.universityName,
                        block: p.roomAllocation?.building || '',
                        room: p.roomAllocation?.roomNumber || ''
                    }));
                }
                if (Array.isArray(reg.coaches)) {
                    reg.coaches.forEach(c => {
                        const isManager = (c.role || '').toUpperCase().includes('MANAGER');
                        participants.push({
                            personType: isManager ? 'MANAGER' : 'COACH',
                            personRef: c._id,
                            registrationId: reg._id,
                            name: c.name,
                            identifier: c.mobileNo,
                            teamOrSport: reg.universityName,
                            block: c.roomAllocation?.building || '',
                            room: c.roomAllocation?.roomNumber || ''
                        });
                    });
                }
            }
        }

        if (participants.length === 0) {
            return res.status(400).json({ message: 'No participants found to issue tokens' });
        }

        const newlyIssued = [];
        const printPayloads = [];
        let totalSkipped = 0;

        for (const item of targetItems) {
            const currentMeal = item.mealType;
            const currentDate = item.mealDate;

            // Find existing tokens for this group for this specific meal and date
            const existingTokens = await FoodToken.find({
                personRef: { $in: participants.map(p => p.personRef) },
                mealType: currentMeal,
                mealDate: currentDate,
                status: { $ne: 'CANCELLED' }
            }).lean();

            const existingRefMap = new Map();
            existingTokens.forEach(t => existingRefMap.set(t.personRef.toString(), t));

            for (const person of participants) {
                if (existingRefMap.has(person.personRef.toString())) {
                    totalSkipped++;
                    const existingToken = existingRefMap.get(person.personRef.toString());

                    // Update token print count & log reprint action
                    await FoodToken.updateOne(
                        { _id: existingToken._id },
                        {
                            $inc: { printCount: 1 },
                            $set: { lastPrintedAt: new Date() },
                            $push: {
                                auditLog: {
                                    action: 'REPRINT',
                                    performedBy: req.user?.username || 'admin',
                                    timestamp: new Date(),
                                    details: `Bulk reprint for ${person.teamOrSport} (${currentDate} ${currentMeal})`
                                }
                            }
                        }
                    );

                    printPayloads.push({
                        code: existingToken.code,
                        name: existingToken.name,
                        identifier: existingToken.identifier,
                        teamOrSport: existingToken.teamOrSport,
                        block: existingToken.block,
                        room: existingToken.room,
                        eventName: existingToken.eventName,
                        mealType: existingToken.mealType,
                        mealDate: existingToken.mealDate,
                        issuedAt: existingToken.issuedAt,
                        isReprint: true,
                        printCount: (existingToken.printCount || 1) + 1
                    });
                    continue; // Skip creating new, proceed with print
                }

                let codeCreated = false;
                let attempts = 0;
                while (!codeCreated && attempts < 5) {
                    attempts++;
                    const code = generateSecureCode(10);
                    try {
                        const token = await FoodToken.create({
                            code,
                            personType: person.personType,
                            personRef: person.personRef,
                            personTypeModel: 'Registration',
                            name: person.name,
                            identifier: person.identifier,
                            teamOrSport: person.teamOrSport,
                            block: person.block,
                            room: person.room,
                            eventName: EVENT_NAME,
                            mealType: currentMeal,
                            mealDate: currentDate,
                            status: 'ISSUED',
                            issuedBy: req.user?.username || 'admin',
                            issuedAt: new Date(),
                            printCount: 1,
                            lastPrintedAt: new Date(),
                            auditLog: [{
                                action: 'ISSUE',
                                performedBy: req.user?.username || 'admin',
                                timestamp: new Date(),
                                details: `Bulk issue for ${person.teamOrSport} (${currentDate} ${currentMeal})`
                            }]
                        });

                        newlyIssued.push(token);
                        printPayloads.push({
                            code: token.code,
                            name: token.name,
                            identifier: token.identifier,
                            teamOrSport: token.teamOrSport,
                            block: token.block,
                            room: token.room,
                            eventName: token.eventName,
                            mealType: token.mealType,
                            mealDate: token.mealDate,
                            issuedAt: token.issuedAt
                        });
                        codeCreated = true;
                    } catch (err) {
                        if (err.code === 11000 && err.keyPattern?.code) continue;
                        break;
                    }
                }
            }
        }

        if (newlyIssued.length > 0) {
            emitSocketUpdate();
        }

        // Sort printPayloads by participant name, then date, then mealType
        printPayloads.sort((a, b) => {
            const nameCmp = (a.name || '').localeCompare(b.name || '');
            if (nameCmp !== 0) return nameCmp;
            const dateCmp = (a.mealDate || '').localeCompare(b.mealDate || '');
            if (dateCmp !== 0) return dateCmp;
            const mealOrder = { BREAKFAST: 1, LUNCH: 2, DINNER: 3 };
            return (mealOrder[a.mealType] || 0) - (mealOrder[b.mealType] || 0);
        });

        let message = '';
        if (newlyIssued.length > 0 && totalSkipped > 0) {
            message = `Issued ${newlyIssued.length} new tokens & reprinted ${totalSkipped} existing tokens (${printPayloads.length} sent to printer)`;
        } else if (newlyIssued.length > 0) {
            message = `Issued ${newlyIssued.length} tokens (${printPayloads.length} sent to printer)`;
        } else {
            message = `Tokens already issued. Sending all ${printPayloads.length} tokens to printer for reprint!`;
        }

        res.status(200).json({
            message,
            issuedCount: newlyIssued.length,
            skippedCount: totalSkipped,
            totalTeamMembers: participants.length,
            printPayloads
        });
    } catch (error) {
        console.error('Error in issueBulk:', error);
        res.status(500).json({ message: 'Failed to bulk issue tokens', error: error.message });
    }
};

/**
 * 3b. Issue All Unissued Meals for a Person on a Specific Date
 * POST /api/food-tokens/issue-day
 */
exports.issueDayTokens = async (req, res) => {
    try {
        const { personType, personRef } = req.body;
        const mealDate = (req.body.mealDate || getTodayString()).trim();

        if (!personType || !personRef) {
            return res.status(400).json({ message: 'personType and personRef are required' });
        }

        // Look up participant snapshot
        let snapshot = null;
        if (personType === 'PLAYER' || personType === 'COACH' || personType === 'MANAGER') {
            const reg = await Registration.findOne({
                $or: [
                    { 'players._id': personRef },
                    { 'coaches._id': personRef }
                ]
            }).lean();

            if (!reg) {
                return res.status(404).json({ message: 'Participant not found in registrations' });
            }

            const player = reg.players?.find(p => p._id.toString() === personRef.toString());
            const coach = reg.coaches?.find(c => c._id.toString() === personRef.toString());
            const person = player || coach;

            if (!person) {
                return res.status(404).json({ message: 'Person not found in team' });
            }

            snapshot = {
                name: person.playerName || person.name,
                identifier: person.mobileNo,
                teamOrSport: reg.universityName,
                block: person.roomAllocation?.building || '',
                room: person.roomAllocation?.roomNumber || '',
                eventName: EVENT_NAME
            };
        } else {
            return res.status(400).json({ message: 'Invalid personType' });
        }

        // Find existing tokens for this person on this date
        const existingTokens = await FoodToken.find({
            personType,
            personRef,
            mealDate,
            status: { $ne: 'CANCELLED' }
        });

        const existingMap = new Map();
        existingTokens.forEach(t => existingMap.set(t.mealType, t));

        const newlyIssued = [];
        const printPayloads = [];

        for (const mealType of MEAL_TYPES) {
            if (existingMap.has(mealType)) {
                // Token already exists -> prepare reprint
                const tokenDoc = existingMap.get(mealType);
                tokenDoc.printCount = (tokenDoc.printCount || 1) + 1;
                tokenDoc.lastPrintedAt = new Date();
                tokenDoc.auditLog.push({
                    action: 'REPRINT',
                    performedBy: req.user?.username || req.user?.name || 'admin',
                    timestamp: new Date(),
                    details: `Day reprint for ${mealDate} (${mealType})`
                });
                await tokenDoc.save();

                printPayloads.push({
                    code: tokenDoc.code,
                    name: tokenDoc.name,
                    identifier: tokenDoc.identifier,
                    teamOrSport: tokenDoc.teamOrSport,
                    block: tokenDoc.block,
                    room: tokenDoc.room,
                    mealType: tokenDoc.mealType,
                    mealDate: tokenDoc.mealDate,
                    eventName: tokenDoc.eventName,
                    isReprint: true,
                    printCount: tokenDoc.printCount
                });
            } else {
                // Generate unique code & create new token
                let uniqueCode = '';
                for (let attempt = 0; attempt < 5; attempt++) {
                    const candidate = generateSecureCode(10);
                    const exists = await FoodToken.exists({ code: candidate });
                    if (!exists) {
                        uniqueCode = candidate;
                        break;
                    }
                }
                if (!uniqueCode) uniqueCode = generateSecureCode(12);

                const tokenDoc = new FoodToken({
                    code: uniqueCode,
                    personType,
                    personRef,
                    personTypeModel: 'Registration',
                    name: snapshot.name,
                    identifier: snapshot.identifier,
                    teamOrSport: snapshot.teamOrSport,
                    block: snapshot.block,
                    room: snapshot.room,
                    eventName: snapshot.eventName,
                    mealType,
                    mealDate,
                    status: 'ISSUED',
                    issuedBy: req.user?.username || req.user?.name || 'admin',
                    issuedAt: new Date(),
                    printCount: 1,
                    lastPrintedAt: new Date(),
                    auditLog: [{
                        action: 'ISSUE',
                        performedBy: req.user?.username || req.user?.name || 'admin',
                        timestamp: new Date(),
                        details: `Day issued for ${mealDate} (${mealType})`
                    }]
                });

                await tokenDoc.save();
                newlyIssued.push(tokenDoc);

                printPayloads.push({
                    code: tokenDoc.code,
                    name: tokenDoc.name,
                    identifier: tokenDoc.identifier,
                    teamOrSport: tokenDoc.teamOrSport,
                    block: tokenDoc.block,
                    room: tokenDoc.room,
                    mealType: tokenDoc.mealType,
                    mealDate: tokenDoc.mealDate,
                    eventName: tokenDoc.eventName,
                    isReprint: false,
                    printCount: 1
                });
            }
        }

        emitSocketUpdate();

        const allTokens = [...existingTokens, ...newlyIssued];

        res.status(200).json({
            message: newlyIssued.length > 0
                ? `Successfully issued ${newlyIssued.length} token(s). Sending all 4 tokens for ${mealDate} to printer.`
                : `Sending all 4 tokens for ${mealDate} to printer.`,
            tokens: allTokens,
            newlyIssuedCount: newlyIssued.length,
            printPayloads
        });
    } catch (error) {
        console.error('Error in issueDayTokens:', error);
        res.status(500).json({ message: 'Failed to issue day tokens', error: error.message });
    }
};

/**
 * 4. Reprint Token
 * POST /api/food-tokens/:id/reprint
 */
exports.reprintToken = async (req, res) => {
    try {
        const token = await FoodToken.findById(req.params.id);

        if (!token) {
            return res.status(404).json({ message: 'Token not found' });
        }

        if (token.status !== 'ISSUED') {
            return res.status(400).json({
                message: `Cannot reprint a ${token.status.toLowerCase()} token.`
            });
        }

        token.printCount += 1;
        token.lastPrintedAt = new Date();
        token.auditLog.push({
            action: 'REPRINT',
            performedBy: req.user?.username || 'admin',
            timestamp: new Date(),
            details: `Reprinted (Copy #${token.printCount})`
        });

        await token.save();

        const printPayload = {
            code: token.code,
            name: token.name,
            identifier: token.identifier,
            teamOrSport: token.teamOrSport,
            block: token.block,
            room: token.room,
            eventName: token.eventName,
            mealType: token.mealType,
            mealDate: token.mealDate,
            issuedAt: token.issuedAt,
            isReprint: true,
            printCount: token.printCount
        };

        res.status(200).json({
            message: `Token reprinted successfully (Copy #${token.printCount})`,
            token,
            printPayload
        });
    } catch (error) {
        console.error('Error in reprintToken:', error);
        res.status(500).json({ message: 'Failed to reprint token', error: error.message });
    }
};


/**
 * 6. Cancel Token
 * POST /api/food-tokens/:id/cancel
 */
exports.cancelToken = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason || !reason.trim()) {
            return res.status(400).json({ message: 'A cancellation reason is required' });
        }

        const token = await FoodToken.findById(req.params.id);
        if (!token) {
            return res.status(404).json({ message: 'Token not found' });
        }

        if (token.status !== 'ISSUED') {
            return res.status(400).json({
                message: `Cannot cancel a ${token.status.toLowerCase()} token.`
            });
        }

        token.status = 'CANCELLED';
        token.cancelledBy = req.user?.username || 'admin';
        token.cancelledAt = new Date();
        token.cancelReason = reason.trim();
        token.auditLog.push({
            action: 'CANCEL',
            performedBy: req.user?.username || 'admin',
            timestamp: new Date(),
            details: `Cancelled: ${reason.trim()}`
        });

        await token.save();
        emitSocketUpdate();

        res.status(200).json({
            message: 'Token cancelled successfully',
            token
        });
    } catch (error) {
        console.error('Error in cancelToken:', error);
        res.status(500).json({ message: 'Failed to cancel token', error: error.message });
    }
};

/**
 * 7. List Tokens with filters and pagination
 * GET /api/food-tokens?mealType=&mealDate=&status=&personType=&search=&page=&limit=
 */
exports.getTokens = async (req, res) => {
    try {
        const { mealType, mealDate, status, personType, search, all } = req.query;
        const page = parseInt(req.query.page, 10) || 1;
        const parsedLimit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 20;
        const isAll = all === 'true' || parsedLimit === 0;
        const limit = isAll ? 0 : parsedLimit;
        const skip = isAll ? 0 : (page - 1) * limit;

        const filter = {};

        if (mealType) filter.mealType = mealType;
        if (mealDate) filter.mealDate = mealDate;
        if (status) filter.status = status;
        if (personType) filter.personType = personType;

        if (search && search.trim()) {
            const regex = new RegExp(escapeRegex(search.trim()), 'i');
            filter.$or = [
                { code: regex },
                { name: regex },
                { identifier: regex },
                { teamOrSport: regex }
            ];
        }

        let query = FoodToken.find(filter).sort({ createdAt: -1 });
        if (!isAll && limit > 0) {
            query = query.skip(skip).limit(limit);
        }

        const [tokens, total] = await Promise.all([
            query.lean(),
            FoodToken.countDocuments(filter)
        ]);

        res.status(200).json({
            tokens,
            total,
            page: isAll ? 1 : page,
            limit: isAll ? total : limit,
            totalPages: isAll ? 1 : Math.ceil(total / (limit || 1))
        });
    } catch (error) {
        console.error('Error in getTokens:', error);
        res.status(500).json({ message: 'Failed to fetch tokens', error: error.message });
    }
};

/**
 * 8. Summary Statistics for today
 * GET /api/food-tokens/stats
 */
exports.getStats = async (req, res) => {
    try {
        const { mealDate, fromDate, toDate } = req.query;

        // Build match stage: single date, date range, or no filter
        const matchStage = {};
        if (mealDate) {
            matchStage.mealDate = mealDate;
        } else if (fromDate || toDate) {
            matchStage.mealDate = {};
            if (fromDate) matchStage.mealDate.$gte = fromDate;
            if (toDate) matchStage.mealDate.$lte = toDate;
        }

        const hasMatch = Object.keys(matchStage).length > 0;

        const [statsAgg, dateAgg] = await Promise.all([
            FoodToken.aggregate([
                ...(hasMatch ? [{ $match: matchStage }] : []),
                {
                    $group: {
                        _id: { mealType: '$mealType', status: '$status' },
                        count: { $sum: 1 }
                    }
                }
            ]),
            FoodToken.aggregate([
                ...(hasMatch ? [{ $match: matchStage }] : []),
                {
                    $group: {
                        _id: { mealDate: '$mealDate', mealType: '$mealType', status: '$status' },
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { '_id.mealDate': 1 }
                }
            ])
        ]);

        // Build structured stats response
        const statsByMeal = {};
        for (const type of MEAL_TYPES) {
            statsByMeal[type] = {
                issued: 0,
                redeemed: 0,
                cancelled: 0,
                total: 0
            };
        }

        let totalIssued = 0;
        let totalRedeemed = 0;
        let totalCancelled = 0;

        for (const row of statsAgg) {
            const { mealType, status } = row._id;
            const count = row.count;

            if (statsByMeal[mealType]) {
                if (status === 'ISSUED') {
                    statsByMeal[mealType].issued += count;
                    totalIssued += count;
                } else if (status === 'REDEEMED') {
                    statsByMeal[mealType].redeemed += count;
                    totalRedeemed += count;
                } else if (status === 'CANCELLED') {
                    statsByMeal[mealType].cancelled += count;
                    totalCancelled += count;
                } else {
                    statsByMeal[mealType].issued += count;
                    totalIssued += count;
                }
                statsByMeal[mealType].total += count;
            }
        }

        // Build date-wise structured stats
        const byDateMap = {};
        for (const row of dateAgg) {
            const { mealDate: d, mealType, status } = row._id;
            if (!d) continue;

            if (!byDateMap[d]) {
                byDateMap[d] = {
                    date: d,
                    totalIssued: 0,
                    totalRedeemed: 0,
                    totalCancelled: 0,
                    totalTokens: 0,
                    breakfast: { issued: 0, redeemed: 0, total: 0 },
                    lunch: { issued: 0, redeemed: 0, total: 0 },
                    dinner: { issued: 0, redeemed: 0, total: 0 }
                };
            }

            const dObj = byDateMap[d];
            const count = row.count;
            const mealKey = (mealType || '').toLowerCase();

            if (status === 'ISSUED') {
                dObj.totalIssued += count;
                dObj.totalTokens += count;
                if (dObj[mealKey]) {
                    dObj[mealKey].issued += count;
                    dObj[mealKey].total += count;
                }
            } else if (status === 'REDEEMED') {
                dObj.totalRedeemed += count;
                dObj.totalTokens += count;
                if (dObj[mealKey]) {
                    dObj[mealKey].redeemed += count;
                    dObj[mealKey].total += count;
                }
            } else if (status === 'CANCELLED') {
                dObj.totalCancelled += count;
            } else {
                dObj.totalIssued += count;
                dObj.totalTokens += count;
                if (dObj[mealKey]) {
                    dObj[mealKey].issued += count;
                    dObj[mealKey].total += count;
                }
            }
        }

        const byDate = Object.values(byDateMap).sort((a, b) => a.date.localeCompare(b.date));

        res.status(200).json({
            mealDate,
            fromDate: fromDate || null,
            toDate: toDate || null,
            byMeal: statsByMeal,
            byDate,
            overall: {
                totalIssued,
                totalRedeemed,
                totalCancelled,
                totalActive: totalIssued + totalRedeemed
            }
        });
    } catch (error) {
        console.error('Error in getStats:', error);
        res.status(500).json({ message: 'Failed to compute stats', error: error.message });
    }
};

/**
 * 9. Verify Token by Code
 * POST /api/food-tokens/verify or GET /api/food-tokens/verify/:code
 */
exports.verifyToken = async (req, res) => {
    try {
        const rawCode = (req.body && req.body.code) || (req.params && req.params.code) || (req.query && req.query.code);
        if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
            return res.status(400).json({ success: false, message: 'Token code is required' });
        }

        const code = rawCode.trim().toUpperCase();
        const token = await FoodToken.findOne({ code });

        if (!token) {
            return res.status(404).json({
                success: false,
                message: `Token code "${code}" not found. Please verify the code or QR.`,
                code
            });
        }

        return res.status(200).json({
            success: true,
            token,
            status: token.status,
            isValidForRedemption: token.status === 'ISSUED',
            isRedeemed: token.status === 'REDEEMED',
            isCancelled: token.status === 'CANCELLED'
        });
    } catch (error) {
        console.error('Error in verifyToken:', error);
        res.status(500).json({ success: false, message: 'Failed to verify token', error: error.message });
    }
};

/**
 * 10. Redeem Token (Food Served)
 * POST /api/food-tokens/redeem
 */
exports.redeemToken = async (req, res) => {
    try {
        const rawCode = (req.body && req.body.code) || (req.body && req.body.tokenId);
        if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
            return res.status(400).json({ success: false, message: 'Token code or ID is required' });
        }

        const searchCriteria = mongoose.Types.ObjectId.isValid(rawCode.trim())
            ? { $or: [{ _id: rawCode.trim() }, { code: rawCode.trim().toUpperCase() }] }
            : { code: rawCode.trim().toUpperCase() };

        const token = await FoodToken.findOne(searchCriteria);

        if (!token) {
            return res.status(404).json({
                success: false,
                message: `Token "${rawCode.trim().toUpperCase()}" not found.`
            });
        }

        if (token.status === 'CANCELLED') {
            return res.status(400).json({
                success: false,
                message: `CANNOT REDEEM: Token is CANCELLED! (Reason: ${token.cancelReason || 'Cancelled by admin'})`,
                token
            });
        }

        if (token.status === 'REDEEMED') {
            return res.status(409).json({
                success: false,
                message: `ALREADY REDEEMED: This token was already used on ${new Date(token.redeemedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${token.redeemedBy || 'Staff'}.`,
                token,
                alreadyRedeemed: true
            });
        }

        // Mark as REDEEMED
        const redeemer = (req.user && (req.user.username || req.user.name)) || req.body.redeemedBy || 'Staff';
        token.status = 'REDEEMED';
        token.redeemedAt = new Date();
        token.redeemedBy = redeemer;
        token.auditLog.push({
            action: 'REDEEM',
            performedBy: redeemer,
            timestamp: new Date(),
            details: `Meal served (${token.mealType}) on ${token.mealDate} via QR Scanner`
        });

        await token.save();
        emitSocketUpdate();

        return res.status(200).json({
            success: true,
            message: `Food served successfully for ${token.name} (${token.mealType})!`,
            token
        });
    } catch (error) {
        console.error('Error in redeemToken:', error);
        res.status(500).json({ success: false, message: 'Failed to redeem token', error: error.message });
    }
};

/**
 * 11. Get all registered players with missing departure date & time
 * GET /api/food-tokens/missing-departure
 */
exports.getMissingDeparturePlayers = async (req, res) => {
    try {
        const registrations = await Registration.find({
            $or: [
                { 'players.departureDate': { $in: [null, '', undefined] } },
                { 'players.departureDate': { $exists: false } }
            ]
        }).lean();

        const missing = [];
        for (const reg of registrations) {
            if (Array.isArray(reg.players)) {
                for (const player of reg.players) {
                    const depDate = (player.departureDate || '').trim();
                    if (!depDate) {
                        missing.push({
                            registrationId: reg._id,
                            playerRef: player._id,
                            playerName: player.playerName,
                            mobileNo: player.mobileNo,
                            gender: player.gender || '',
                            universityName: reg.universityName,
                            arrivalDate: player.arrivalDate || '',
                            arrivalTime: player.arrivalTime || '',
                            departureDate: '',
                            departureTime: player.departureTime || '',
                            block: player.roomAllocation?.building || '',
                            room: player.roomAllocation?.roomNumber || ''
                        });
                    }
                }
            }
        }

        // Sort by university then player name
        missing.sort((a, b) => (a.universityName || '').localeCompare(b.universityName || '') || (a.playerName || '').localeCompare(b.playerName || ''));

        res.status(200).json({
            count: missing.length,
            players: missing
        });
    } catch (error) {
        console.error('Error in getMissingDeparturePlayers:', error);
        res.status(500).json({ message: 'Failed to fetch players with missing departure', error: error.message });
    }
};

/**
 * 12. Update departure date and time for a player
 * PUT /api/food-tokens/update-departure
 */
exports.updatePlayerDeparture = async (req, res) => {
    try {
        const { registrationId, playerRef, departureDate, departureTime } = req.body;

        if (!playerRef || !departureDate || !departureDate.trim()) {
            return res.status(400).json({ message: 'playerRef and departureDate are required' });
        }

        const cleanDate = departureDate.trim();
        const cleanTime = (departureTime || '').trim();

        let reg = null;
        if (registrationId) {
            reg = await Registration.findById(registrationId);
        }
        if (!reg) {
            reg = await Registration.findOne({ 'players._id': playerRef });
        }

        if (!reg) {
            return res.status(404).json({ message: 'Registration not found for player' });
        }

        const player = (reg.players.id ? reg.players.id(playerRef) : null) || (Array.isArray(reg.players) ? reg.players.find(p => String(p._id) === String(playerRef)) : null);
        if (!player) {
            return res.status(404).json({ message: 'Player not found in registration' });
        }

        player.departureDate = cleanDate;
        if (cleanTime !== undefined) {
            player.departureTime = cleanTime;
        }

        await reg.save();
        emitSocketUpdate();

        res.status(200).json({
            success: true,
            message: `Departure details updated successfully for ${player.playerName}!`,
            player: {
                registrationId: reg._id,
                playerRef: player._id,
                playerName: player.playerName,
                departureDate: player.departureDate,
                departureTime: player.departureTime
            }
        });
    } catch (error) {
        console.error('Error in updatePlayerDeparture:', error);
        res.status(500).json({ message: 'Failed to update departure details', error: error.message });
    }
};
