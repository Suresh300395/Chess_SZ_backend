const University = require('../models/University');
const Registration = require('../models/Registration');
const xlsx = require('xlsx');

// Safe Socket emission
const emitUniversityUpdate = () => {
    try {
        const io = require('../socket').getIO();
        io.emit('universityUpdated');
    } catch (err) {
        // Socket might not be initialized in test environments
    }
};

// Levenshtein Distance for similarity check
const levenshteinDistance = (a, b) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

const getSimilarityScore = (s1, s2) => {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;
    return (longer.length - levenshteinDistance(longer, shorter)) / parseFloat(longer.length);
};

/**
 * 1. GET /api/universities
 * Paginated list with search, status filter, and registered player/team count sync
 */
exports.getUniversities = async (req, res) => {
    try {
        // Automatically remove empty/deprecated fields from existing database documents
        University.collection.updateMany(
            {
                $or: [
                    { shortCode: { $exists: true } },
                    { aliases: { $exists: true } },
                    { normalizedAliases: { $exists: true } },
                    { state: { $exists: true } },
                    { city: { $exists: true } },
                    { contactPerson: { $exists: true } },
                    { email: { $exists: true } },
                    { notes: { $exists: true } }
                ]
            },
            {
                $unset: {
                    shortCode: 1,
                    aliases: 1,
                    normalizedAliases: 1,
                    state: 1,
                    city: 1,
                    contactPerson: 1,
                    email: 1,
                    notes: 1
                }
            }
        ).catch(() => {});

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;

        const { q, status, sortBy, sortOrder } = req.query;

        const query = {};

        // Status Filter
        if (status && status !== 'ALL') {
            query.status = status.toUpperCase();
        }

        // Search Filter (name, phone, address)
        if (q && q.trim()) {
            const trimmed = q.trim();
            const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'i');
            query.$or = [
                { name: regex },
                { phone: regex },
                { address: regex }
            ];
        }

        // Sorting
        const sortOptions = {};
        const order = sortOrder === 'asc' ? 1 : -1;
        if (sortBy === 'name') sortOptions.name = order;
        else if (sortBy === 'status') sortOptions.status = order;
        else if (sortBy === 'registeredTeamCount') sortOptions.registeredTeamCount = order;
        else sortOptions.createdAt = -1;

        const [universities, total] = await Promise.all([
            University.find(query).sort(sortOptions).skip(skip).limit(limit).lean(),
            University.countDocuments(query)
        ]);

        // Sync registered team count & player count from Registration collection dynamically
        const regCounts = await Registration.aggregate([
            {
                $group: {
                    _id: { $toLower: '$universityName' },
                    teamCount: { $sum: 1 },
                    playerCount: { $sum: { $size: { $ifNull: ['$players', []] } } }
                }
            }
        ]);
        const countMap = {};
        const playerMap = {};
        regCounts.forEach(r => {
            if (r._id) {
                const key = r._id.trim();
                countMap[key] = r.teamCount || 0;
                playerMap[key] = r.playerCount || 0;
            }
        });

        const enriched = universities.map(u => {
            const norm = (u.name || '').toLowerCase().trim();
            const actualCount = countMap[norm] || 0;
            const actualPlayerCount = playerMap[norm] || 0;
            return {
                ...u,
                registeredPlayerCount: actualPlayerCount,
                registeredTeamCount: actualCount
            };
        });

        res.status(200).json({
            success: true,
            universities: enriched,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Error fetching universities:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch universities', error: error.message });
    }
};

/**
 * 2. GET /api/universities/stats
 * Aggregate metrics
 */
exports.getStats = async (req, res) => {
    try {
        const [total, active, inactive, regUnivs, playersAgg] = await Promise.all([
            University.countDocuments(),
            University.countDocuments({ status: 'ACTIVE' }),
            University.countDocuments({ status: 'INACTIVE' }),
            Registration.distinct('universityName'),
            Registration.aggregate([
                { $group: { _id: null, totalPlayers: { $sum: { $size: { $ifNull: ['$players', []] } } } } }
            ])
        ]);

        const registeredPlayersCount = playersAgg[0]?.totalPlayers || 0;

        res.status(200).json({
            success: true,
            stats: {
                total,
                active,
                inactive,
                registeredCount: regUnivs.length,
                registeredPlayersCount
            }
        });
    } catch (error) {
        console.error('Error fetching university stats:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch stats', error: error.message });
    }
};

/**
 * 3. GET /api/universities/search-active
 * Public / fast search for Registration page Autocomplete
 */
exports.searchActiveUniversities = async (req, res) => {
    try {
        const q = (req.query.q || req.query.query || '').trim();
        if (!q || q.length < 2) {
            return res.status(200).json([]);
        }

        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        const normQ = University.normalize(q);

        // Find active universities matching name or normalizedName
        const universities = await University.find({
            status: 'ACTIVE',
            $or: [
                { name: regex },
                { normalizedName: { $regex: normQ, $options: 'i' } }
            ]
        }).limit(20).lean();

        // Also cross-reference with existing Registrations so that existing team data can load
        const registeredTeams = await Registration.find({
            universityName: { $regex: escaped, $options: 'i' }
        }).sort({ createdAt: -1 }).limit(20).lean();

        const registeredMap = new Map();
        registeredTeams.forEach(r => {
            registeredMap.set((r.universityName || '').toLowerCase().trim(), r);
        });

        // Combine into unified results
        const results = [];
        const seenNames = new Set();

        // Add matching Master Universities
        universities.forEach(u => {
            const norm = (u.name || '').toLowerCase().trim();
            seenNames.add(norm);
            const regDoc = registeredMap.get(norm);

            results.push({
                _id: u._id,
                isMaster: true,
                universityName: u.name,
                address: u.address || (regDoc ? regDoc.address : ''),
                universityContact: u.phone || (regDoc ? regDoc.universityContact : ''),
                isExistingUniversity: Boolean(regDoc),
                registrationId: regDoc ? regDoc._id : null,
                players: regDoc ? (regDoc.players || []) : [],
                coaches: regDoc ? (regDoc.coaches || []) : []
            });
        });

        // Add registered universities that are not yet in University Master
        registeredTeams.forEach(r => {
            const norm = (r.universityName || '').toLowerCase().trim();
            if (!seenNames.has(norm)) {
                seenNames.add(norm);
                results.push({
                    _id: r._id,
                    isMaster: false,
                    universityName: r.universityName,
                    address: r.address || '',
                    universityContact: r.universityContact || '',
                    isExistingUniversity: true,
                    registrationId: r._id,
                    players: r.players || [],
                    coaches: r.coaches || []
                });
            }
        });

        res.status(200).json(results);
    } catch (error) {
        console.error('Error in searchActiveUniversities:', error);
        res.status(500).json({ success: false, message: 'Search failed', error: error.message });
    }
};

/**
 * 4. GET /api/universities/check-duplicate
 * Real-time validation for duplicate names
 */
exports.checkDuplicate = async (req, res) => {
    try {
        const { name, excludeId } = req.query;
        if (!name || !name.trim()) {
            return res.status(200).json({ isDuplicate: false });
        }

        const normName = University.normalize(name);

        const filter = {
            ...(excludeId ? { _id: { $ne: excludeId } } : {})
        };

        // 1. Exact match on normalized name
        const exactNameMatch = await University.findOne({
            ...filter,
            normalizedName: normName
        }).lean();

        if (exactNameMatch) {
            return res.status(200).json({
                isDuplicate: true,
                type: 'EXACT_NAME',
                message: `University "${exactNameMatch.name}" already exists!`,
                matchedUniversity: exactNameMatch
            });
        }

        // 2. Similarity fuzzy check for typos
        const allUnivs = await University.find(filter, { name: 1, normalizedName: 1 }).lean();
        const similarMatches = [];
        for (const u of allUnivs) {
            const score = getSimilarityScore(normName, u.normalizedName);
            if (score >= 0.82 && score < 1.0) {
                similarMatches.push({
                    name: u.name,
                    score: Math.round(score * 100)
                });
            }
        }

        if (similarMatches.length > 0) {
            return res.status(200).json({
                isDuplicate: false,
                isSimilar: true,
                message: `Found similar university: "${similarMatches[0].name}" (${similarMatches[0].score}% match). Please ensure this is not a duplicate.`,
                similar: similarMatches[0]
            });
        }

        return res.status(200).json({ isDuplicate: false, isSimilar: false });
    } catch (error) {
        console.error('Error in checkDuplicate:', error);
        res.status(500).json({ success: false, message: 'Check failed', error: error.message });
    }
};

/**
 * 5. POST /api/universities
 * Create single university (Name, Contact, Address, Status only)
 */
exports.createUniversity = async (req, res) => {
    try {
        const { name, address, phone, status } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'University name is required' });
        }

        const normName = University.normalize(name);

        // Check duplicate name
        const existing = await University.findOne({ normalizedName: normName });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: `University "${existing.name}" already exists.`
            });
        }

        const university = new University({
            name: name.trim(),
            address: (address || '').trim(),
            phone: (phone || '').trim(),
            status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
            createdSource: 'MANUAL',
            createdBy: req.user?.username || req.user?.name || 'Admin'
        });

        await university.save();
        emitUniversityUpdate();

        res.status(201).json({
            success: true,
            message: 'University added successfully',
            university
        });
    } catch (error) {
        console.error('Error creating university:', error);
        res.status(500).json({ success: false, message: 'Failed to add university', error: error.message });
    }
};

/**
 * 6. PUT /api/universities/:id
 * Edit university (Name, Contact, Address, Status only)
 */
exports.updateUniversity = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, phone, status } = req.body;

        const university = await University.findById(id);
        if (!university) {
            return res.status(404).json({ success: false, message: 'University not found' });
        }

        if (name && name.trim()) {
            const normName = University.normalize(name);
            const duplicate = await University.findOne({
                _id: { $ne: id },
                normalizedName: normName
            });
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: `Another university with name "${duplicate.name}" already exists.`
                });
            }
            university.name = name.trim();
            university.normalizedName = normName;
        }

        if (address !== undefined) university.address = address.trim();
        if (phone !== undefined) university.phone = phone.trim();
        if (status !== undefined) university.status = status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

        await university.save();
        emitUniversityUpdate();

        res.status(200).json({
            success: true,
            message: 'University updated successfully',
            university
        });
    } catch (error) {
        console.error('Error updating university:', error);
        res.status(500).json({ success: false, message: 'Failed to update university', error: error.message });
    }
};

/**
 * 7. PATCH /api/universities/:id/status
 * Toggle Active / Inactive
 */
exports.toggleStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const university = await University.findById(id);
        if (!university) {
            return res.status(404).json({ success: false, message: 'University not found' });
        }

        const newStatus = university.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        const updated = await University.findByIdAndUpdate(
            id,
            { $set: { status: newStatus } },
            { new: true, runValidators: true }
        );
        emitUniversityUpdate();

        res.status(200).json({
            success: true,
            message: `University status updated to ${updated.status}`,
            university: updated
        });
    } catch (error) {
        console.error('Error toggling status:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle status', error: error.message });
    }
};

/**
 * 8. DELETE /api/universities/:id
 * Delete university
 */
exports.deleteUniversity = async (req, res) => {
    try {
        const { id } = req.params;
        const university = await University.findById(id);
        if (!university) {
            return res.status(404).json({ success: false, message: 'University not found' });
        }

        // Check if teams from this university are registered
        const regCount = await Registration.countDocuments({
            universityName: { $regex: new RegExp(`^${university.name}$`, 'i') }
        });

        if (regCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete "${university.name}" because ${regCount} player(s)/team(s) are registered under this university. You can set its status to INACTIVE instead.`
            });
        }

        await University.findByIdAndDelete(id);
        emitUniversityUpdate();

        res.status(200).json({
            success: true,
            message: `University "${university.name}" deleted successfully.`
        });
    } catch (error) {
        console.error('Error deleting university:', error);
        res.status(500).json({ success: false, message: 'Failed to delete university', error: error.message });
    }
};

/**
 * 9. POST /api/universities/bulk-import
 * Excel / CSV bulk import (Name, Contact, Address, Status only)
 */
exports.bulkImport = async (req, res) => {
    try {
        let rows = [];

        // Check if rows array was sent directly in body
        if (req.body && Array.isArray(req.body.rows)) {
            rows = req.body.rows;
        } else if (req.body && req.body.fileData) {
            // Base64 file sent in body
            const buffer = Buffer.from(req.body.fileData, 'base64');
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
        } else {
            return res.status(400).json({ success: false, message: 'No file data or rows provided for import.' });
        }

        if (!rows || rows.length === 0) {
            return res.status(400).json({ success: false, message: 'The uploaded file is empty.' });
        }

        // Preload all existing normalized names into Set for ultra-fast collision detection
        const allExisting = await University.find({}, { name: 1, normalizedName: 1 }).lean();
        const existingNamesSet = new Set(allExisting.map(u => u.normalizedName));

        const batchAdded = [];
        const skipped = [];
        const errors = [];
        const batchNamesSeen = new Set();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // considering 1-based header row

            // Flexible column mapping (supports various casing)
            const name = (row['University Name'] || row['Name'] || row['universityName'] || row['name'] || '').toString().trim();
            const phone = (row['University Contact'] || row['universityContact'] || row['Phone'] || row['Mobile'] || row['phone'] || row['mobileNo'] || '').toString().trim();
            const address = (row['Address'] || row['address'] || '').toString().trim();
            const statusRaw = (row['Status'] || row['status'] || 'ACTIVE').toString().trim().toUpperCase();

            if (!name) {
                errors.push({ row: rowNum, reason: 'University name is missing.' });
                continue;
            }

            const normName = University.normalize(name);

            // Check if duplicate in Database
            if (existingNamesSet.has(normName)) {
                skipped.push({ row: rowNum, name, reason: 'Already exists in database' });
                continue;
            }

            // Check if duplicate in this batch itself
            if (batchNamesSeen.has(normName)) {
                skipped.push({ row: rowNum, name, reason: 'Duplicate entry within the same import file' });
                continue;
            }

            batchNamesSeen.add(normName);
            existingNamesSet.add(normName);

            // ONLY push the required fields — no empty / unused fields!
            batchAdded.push({
                name,
                normalizedName: normName,
                address,
                phone,
                status: statusRaw === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
                createdSource: 'BULK_IMPORT',
                createdBy: req.user?.username || req.user?.name || 'Bulk Import'
            });
        }

        if (batchAdded.length > 0) {
            await University.insertMany(batchAdded, { ordered: false });
            emitUniversityUpdate();
        }

        res.status(200).json({
            success: true,
            message: `Bulk import completed: ${batchAdded.length} added, ${skipped.length} skipped duplicates.`,
            summary: {
                totalRows: rows.length,
                addedCount: batchAdded.length,
                skippedCount: skipped.length,
                errorCount: errors.length,
                skipped,
                errors
            }
        });
    } catch (error) {
        console.error('Error during bulk import:', error);
        res.status(500).json({ success: false, message: 'Bulk import failed', error: error.message });
    }
};

/**
 * 10. GET /api/universities/template
 * Download sample Excel template (University Name, University Contact, Address, Status only)
 */
exports.getSampleTemplate = (req, res) => {
    try {
        const sampleData = [
            {
                'University Name': 'Aditya University',
                'University Contact': '9876543210',
                'Address': 'ADB Road, Aditya Nagar, Surampalem, Kakinada District, Andhra Pradesh',
                'Status': 'ACTIVE'
            },
            {
                'University Name': 'Andhra University',
                'University Contact': '9848012345',
                'Address': 'Waltair Junction, Visakhapatnam, Andhra Pradesh',
                'Status': 'ACTIVE'
            },
            {
                'University Name': 'Osmania University',
                'University Contact': '9849012345',
                'Address': 'Amberpet, Hyderabad, Telangana',
                'Status': 'ACTIVE'
            }
        ];

        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(sampleData);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Universities');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename="university_import_template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Error generating sample template:', error);
        res.status(500).json({ success: false, message: 'Failed to generate template', error: error.message });
    }
};

/**
 * 11. GET /api/universities/export
 * Export all universities to Excel
 */
exports.exportUniversities = async (req, res) => {
    try {
        const { status } = req.query;
        const query = {};
        if (status && status !== 'ALL') query.status = status;

        const [universities, regCounts] = await Promise.all([
            University.find(query).sort({ name: 1 }).lean(),
            Registration.aggregate([
                {
                    $group: {
                        _id: { $toLower: '$universityName' },
                        playerCount: { $sum: { $size: { $ifNull: ['$players', []] } } }
                    }
                }
            ])
        ]);

        const playerMap = {};
        regCounts.forEach(r => {
            if (r._id) playerMap[r._id.trim()] = r.playerCount || 0;
        });

        const dataToExport = universities.map((u, idx) => {
            const norm = (u.name || '').toLowerCase().trim();
            const players = playerMap[norm] ?? u.registeredPlayerCount ?? u.registeredTeamCount ?? 0;
            return {
                'S.No': idx + 1,
                'University Name': u.name,
                'University Contact': u.phone || '',
                'Address': u.address || '',
                'Registered Players': players,
                'Status': u.status,
                'Created Date': u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN') : ''
            };
        });

        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(dataToExport);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Universities');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename="universities_master_export.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Error exporting universities:', error);
        res.status(500).json({ success: false, message: 'Failed to export universities', error: error.message });
    }
};
