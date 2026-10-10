const User = require('../models/User');
const Admin = require('../models/Admin');
const HostelBlock = require('../models/HostelBlock');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_this';
const JWT_EXPIRES = '7d';

// Helper: Format photo path to full URL for clients if relative
const formatPhotoUrl = (req, photoPath) => {
    if (!photoPath) return null;
    if (photoPath.startsWith('http://') || photoPath.startsWith('https://') || photoPath.startsWith('data:')) {
        return photoPath;
    }
    const host = req.get('host');
    const protocol = req.protocol;
    return `${protocol}://${host}${photoPath.startsWith('/') ? '' : '/'}${photoPath}`;
};

// Helper: generate JWT token
const generateToken = (user) => {
    return jwt.sign(
        { id: user._id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
};

exports.login = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    try {
        let user = await Admin.findOne({ username });
        let isUserAdmin = true;

        if (!user) {
            user = await User.findOne({ username });
            isUserAdmin = false;
        }

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Support both hashed and legacy plain-text passwords (migration period)
        let isMatch = false;
        if (user.password.startsWith('$2')) {
            // Already hashed with bcrypt
            isMatch = await user.comparePassword(password);
        } else {
            // Plain text - legacy, auto-migrate to hashed
            isMatch = (user.password === password);
            if (isMatch) {
                user.password = password; // will be hashed by pre-save hook
                await user.save();
            }
        }

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = generateToken(user);

        res.status(200).json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                username: user.username,
                role: user.role,
                name: user.name || null,
                photo: formatPhotoUrl(req, user.photo)
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.checkMobile = async (req, res) => {
    const { mobile } = req.body;
    if (!mobile) {
        return res.status(400).json({ message: 'Mobile number is required' });
    }
    try {
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(404).json({ message: 'Mobile number not registered' });
        }
        res.status(200).json({ message: 'Mobile number found', exists: true });
    } catch (error) {
        console.error('Check mobile error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getDashboard = async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        
        const user = await User.findById(req.user.id).select('-password -__v');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        let mappedAcc = {
            block: '',
            roomNumber: '',
            roomType: '',
            status: 'Not Allocated'
        };
        let playerDetails = null;
        let reg = null;
        let participant = null;
        let pType = null;
        let needsSave = false;

        // 1. Try explicit relationship first (fastest)
        if (user.registrationId && user.participantId && user.participantType) {
            reg = await Registration.findById(user.registrationId).lean();
            if (reg) {
                const arr = user.participantType === 'player' ? reg.players : reg.coaches;
                participant = arr.find(p => p._id.toString() === user.participantId.toString());
                pType = user.participantType;
            }
        } 
        
        // 2. Fallback: search by mobile if not explicitly linked (backfill strategy)
        if (!participant) {
            const userMobile = String(user.mobile || user.username).trim();
            reg = await Registration.findOne({ 'players.mobileNo': userMobile }).lean();
            if (reg) {
                participant = reg.players.find(p => String(p.mobileNo).trim() === userMobile);
                pType = 'player';
            } else {
                reg = await Registration.findOne({ 'coaches.mobileNo': userMobile }).lean();
                if (reg) {
                    participant = reg.coaches.find(c => String(c.mobileNo).trim() === userMobile);
                    pType = 'coach';
                }
            }
            
            // Link records for future requests to improve performance
            if (reg && participant) {
                user.registrationId = reg._id;
                user.participantId = participant._id;
                user.participantType = pType;
                needsSave = true;
            }
        }

        // 3. Map details if a valid participant record was found
        if (participant && reg) {
            playerDetails = {
                ...participant,
                universityName: reg.universityName
            };
            if (participant.roomAllocation) {
                mappedAcc = {
                    block: participant.roomAllocation.building || mappedAcc.block,
                    roomNumber: participant.roomAllocation.roomNumber || mappedAcc.roomNumber,
                    roomType: 'Not specified',
                    status: 'Allocated'
                };
            }
        }
        
        if (needsSave) {
            // Save in the background to avoid delaying the API response
            user.save().catch(err => console.error('Error backfilling user registration info:', err));
        }

        // Calculate user food tokens dynamically from FoodToken collection
        const { FoodToken } = require('../models/FoodToken');
        const userMobile = String(user.mobile || user.username || '').trim();
        const participantRef = participant?._id || user.participantId;

        const tokenOrConditions = [];
        if (participantRef) {
            tokenOrConditions.push({ personRef: participantRef });
        }
        if (userMobile) {
            tokenOrConditions.push({ identifier: userMobile });
        }

        let userFoodTokens = [];
        if (tokenOrConditions.length > 0) {
            userFoodTokens = await FoodToken.find({
                $or: tokenOrConditions,
                status: { $ne: 'CANCELLED' }
            }).sort({ mealDate: 1, mealType: 1 }).lean();
        }

        const totalTokens = userFoodTokens.length;
        const usedTokens = userFoodTokens.filter(t => t.status === 'REDEEMED').length;
        const availableTokens = userFoodTokens.filter(t => t.status === 'ISSUED').length;
        const ftStatus = totalTokens === 0 ? 'Inactive' : (availableTokens > 0 ? 'Active' : 'Used');

        const foodTokensData = {
            total: totalTokens,
            used: usedTokens,
            available: availableTokens,
            status: ftStatus,
            tokens: userFoodTokens.map(t => ({
                id: t._id,
                code: t.code,
                mealType: t.mealType,
                mealDate: t.mealDate,
                status: t.status,
                issuedAt: t.issuedAt,
                redeemedAt: t.redeemedAt
            }))
        };

        const userPhoto = user.photo || (participant && participant.photo) || null;

        res.status(200).json({
            name: user.name || user.username,
            email: user.username,
            role: user.role,
            photo: formatPhotoUrl(req, userPhoto),
            photoPath: userPhoto,
            accommodation: mappedAcc,
            foodTokens: foodTokensData,
            cautionDeposit: {
                amount: 0,
                paid: false,
                refundStatus: 'N/A'
            },
            details: playerDetails
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getAccommodationDetails = async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const user = await User.findById(req.user.id).select('registrationId participantId participantType mobile username');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let building = null;
        let roomNumber = null;
        let floor = null;
        let allocatedAt = null;

        // Find user's allocation
        if (user.registrationId && user.participantId) {
            const reg = await Registration.findById(user.registrationId).lean();
            if (reg) {
                const arr = user.participantType === 'player' ? reg.players : reg.coaches;
                const p = arr.find(x => x._id.toString() === user.participantId.toString());
                if (p && p.roomAllocation) {
                    building = p.roomAllocation.building;
                    roomNumber = p.roomAllocation.roomNumber;
                    floor = p.roomAllocation.floor;
                    allocatedAt = p.roomAllocation.allocatedAt;
                }
            }
        } else {
            // Fallback mobile lookup
            const mobile = String(user.mobile || user.username).trim();
            const reg = await Registration.findOne({
                $or: [
                    { 'players.mobileNo': mobile },
                    { 'coaches.mobileNo': mobile }
                ]
            }).lean();
            if (reg) {
                const p = reg.players.find(x => String(x.mobileNo).trim() === mobile) || 
                          reg.coaches.find(x => String(x.mobileNo).trim() === mobile);
                if (p && p.roomAllocation) {
                    building = p.roomAllocation.building;
                    roomNumber = p.roomAllocation.roomNumber;
                    floor = p.roomAllocation.floor;
                    allocatedAt = p.roomAllocation.allocatedAt;
                }
            }
        }

        if (!building || !roomNumber) {
            return res.status(404).json({ message: 'Accommodation not allocated yet' });
        }

        // Find roommates
        // We query Registration to find any player or coach in the same building and room
        const roommates = [];
        const allRegs = await Registration.find({
            $or: [
                { 'players.roomAllocation.building': building, 'players.roomAllocation.roomNumber': roomNumber },
                { 'coaches.roomAllocation.building': building, 'coaches.roomAllocation.roomNumber': roomNumber }
            ]
        }).lean();

        for (const r of allRegs) {
            r.players.forEach(p => {
                if (p.roomAllocation && p.roomAllocation.building === building && p.roomAllocation.roomNumber === roomNumber) {
                    roommates.push({
                        id: p._id.toString(),
                        name: p.playerName,
                        course: r.universityName, // Using university as course/reg info for now
                        regNo: p.mobileNo, // Using mobile as regNo for now
                        status: 'Allocated'
                    });
                }
            });
            r.coaches.forEach(c => {
                if (c.roomAllocation && c.roomAllocation.building === building && c.roomAllocation.roomNumber === roomNumber) {
                    roommates.push({
                        id: c._id.toString(),
                        name: c.name,
                        course: r.universityName + ' (Coach)',
                        regNo: c.mobileNo,
                        status: 'Allocated'
                    });
                }
            });
        }

        // Fetch block details from the database if they exist
        const blockDetails = await HostelBlock.findOne({ name: building }) || {};

        // Fetch dynamic accommodation guidelines
        const HostelGuideline = require('../models/HostelGuideline');
        const guidelineDoc = await HostelGuideline.findOne().sort({ updatedAt: -1 });
        const guidelines = guidelineDoc && guidelineDoc.points && guidelineDoc.points.length > 0
            ? guidelineDoc.points
            : [
                'Keep the room clean and maintain discipline.',
                'Any damage to property will be charged.',
                'Visitors are not allowed inside the hostel rooms.',
                'Follow hostel timings strictly.',
                'Report maintenance issues to the warden office.',
                'Ragging is strictly prohibited.'
            ];

        res.status(200).json({
            building,
            roomNumber,
            floor,
            allocatedAt,
            status: 'Allocated',
            capacity: blockDetails.capacityPerRoom ? `${blockDetails.capacityPerRoom} Sharing` : '4 Sharing',
            roommates,
            hostelInfo: {
                name: blockDetails.name || building,
                block: blockDetails.block || building,
                warden: blockDetails.warden || '',
                wardenContact: blockDetails.wardenContact || '',
                officeHours: blockDetails.officeHours || '',
                address: blockDetails.address || ''
            },
            guidelines
        });

    } catch (error) {
        console.error('Accommodation details error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getFoodTokenDetails = async (req, res) => {
    try {
        const Registration = require('../models/Registration');
        const { FoodToken } = require('../models/FoodToken');
        const user = await User.findById(req.user.id).select('registrationId participantId participantType mobile username name');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let participant = null;
        let reg = null;
        if (user.registrationId && user.participantId) {
            reg = await Registration.findById(user.registrationId).lean();
            if (reg) {
                const arr = user.participantType === 'player' ? reg.players : reg.coaches;
                participant = arr.find(x => x._id.toString() === user.participantId.toString());
            }
        }
        if (!participant) {
            const userMobile = String(user.mobile || user.username).trim();
            reg = await Registration.findOne({ 'players.mobileNo': userMobile }).lean();
            if (reg) {
                participant = reg.players.find(p => String(p.mobileNo).trim() === userMobile);
            } else {
                reg = await Registration.findOne({ 'coaches.mobileNo': userMobile }).lean();
                if (reg) {
                    participant = reg.coaches.find(c => String(c.mobileNo).trim() === userMobile);
                }
            }
        }

        const userMobile = String(user.mobile || user.username || '').trim();
        const participantRef = participant?._id || user.participantId;

        const tokenOrConditions = [];
        if (participantRef) {
            tokenOrConditions.push({ personRef: participantRef });
        }
        if (userMobile) {
            tokenOrConditions.push({ identifier: userMobile });
        }

        let tokens = [];
        if (tokenOrConditions.length > 0) {
            tokens = await FoodToken.find({
                $or: tokenOrConditions,
                status: { $ne: 'CANCELLED' }
            }).sort({ mealDate: 1, mealType: 1 }).lean();
        }

        const total = tokens.length;
        const used = tokens.filter(t => t.status === 'REDEEMED').length;
        const available = tokens.filter(t => t.status === 'ISSUED').length;

        res.status(200).json({
            userName: participant?.playerName || participant?.name || user.name || user.username,
            teamOrSport: reg?.universityName || reg?.sport || '',
            total,
            used,
            available,
            status: total === 0 ? 'Inactive' : (available > 0 ? 'Active' : 'Used'),
            tokens: tokens.map(t => ({
                id: t._id,
                code: t.code,
                mealType: t.mealType,
                mealDate: t.mealDate,
                status: t.status,
                issuedAt: t.issuedAt,
                redeemedAt: t.redeemedAt
            }))
        });
    } catch (error) {
        console.error('getFoodTokenDetails error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.registerAdmin = async (req, res) => {
    const { username, password, mobile } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    try {
        const existingUser = await Admin.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        const newUser = await Admin.create({ username, password, mobile, role: 'admin' });
        res.status(201).json({
            message: 'Admin created successfully',
            user: { id: newUser._id, username: newUser.username, role: newUser.role }
        });
    } catch (error) {
        console.error('Register admin error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getAdmins = async (req, res) => {
    try {
        const admins = await Admin.find({ role: 'admin' }).select('-password -__v');
        res.status(200).json(admins);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateAdmin = async (req, res) => {
    const { id } = req.params;
    const { username, password, mobile } = req.body;
    try {
        const admin = await Admin.findById(id);
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        admin.username = username || admin.username;
        admin.mobile = mobile || admin.mobile;
        if (password) {
            admin.password = password; // will be auto-hashed by pre-save hook
        }

        await admin.save();
        res.status(200).json({
            message: 'Admin updated successfully',
            user: { id: admin._id, username: admin.username, mobile: admin.mobile, role: admin.role }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.deleteAdmin = async (req, res) => {
    const { id } = req.params;
    try {
        const admin = await Admin.findByIdAndDelete(id);
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }
        res.status(200).json({ message: 'Admin deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateProfilePhoto = async (req, res) => {
    try {
        const { photo } = req.body;
        if (!photo) {
            return res.status(400).json({ message: 'Photo is required' });
        }

        let user = await User.findById(req.user.id);
        let isAdmin = false;

        if (!user) {
            user = await Admin.findById(req.user.id);
            isAdmin = true;
        }

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let savedPath = photo;

        // Save physical image file to disk if base64 provided
        if (typeof photo === 'string' && photo.startsWith('data:image/')) {
            const uploadDir = path.join(__dirname, '../public/uploads/profiles');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            let ext = 'jpg';
            if (photo.startsWith('data:image/png')) ext = 'png';
            else if (photo.startsWith('data:image/webp')) ext = 'webp';
            else if (photo.startsWith('data:image/jpeg') || photo.startsWith('data:image/jpg')) ext = 'jpg';

            const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            const fileName = `profile-${user._id}-${Date.now()}.${ext}`;
            const targetFilePath = path.join(uploadDir, fileName);

            // Clean up old uploaded image file if exists
            if (user.photo && user.photo.startsWith('/uploads/profiles/')) {
                const oldFilePath = path.join(__dirname, '../public', user.photo);
                if (fs.existsSync(oldFilePath)) {
                    try { fs.unlinkSync(oldFilePath); } catch (e) { /* ignore */ }
                }
            }

            await fs.promises.writeFile(targetFilePath, buffer);
            savedPath = `/uploads/profiles/${fileName}`;
        }

        // Store relative path in MongoDB
        user.photo = savedPath;
        await user.save();

        // If user is linked to registration/participant, sync photo in Registration collection as well
        if (!isAdmin && user.registrationId && user.participantId && user.participantType) {
            try {
                const Registration = require('../models/Registration');
                const reg = await Registration.findById(user.registrationId);
                if (reg) {
                    const list = user.participantType === 'player' ? reg.players : reg.coaches;
                    const participant = list.id(user.participantId);
                    if (participant) {
                        participant.photo = savedPath;
                        await reg.save();
                    }
                }
            } catch (regErr) {
                console.error('Error syncing photo to registration participant:', regErr);
            }
        }

        const fullPhotoUrl = formatPhotoUrl(req, savedPath);

        res.status(200).json({
            message: 'Profile photo updated successfully',
            photo: fullPhotoUrl,
            photoPath: savedPath
        });
    } catch (error) {
        console.error('Update profile photo error:', error);
        res.status(500).json({ message: 'Failed to update photo', error: error.message });
    }
};

exports.seedAdmin = async () => {
    try {
        const existingAdmin = await Admin.findOne({ username: 'superadmin' });
        if (!existingAdmin) {
            await Admin.create({
                username: 'superadmin',
                password: 'Aditya@123',
                role: 'superadmin'
            });
            console.log('✅ Super admin seeded');
        }
    } catch (error) {
        console.error('Error seeding admin:', error.message);
    }
};
