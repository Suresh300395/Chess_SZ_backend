const User = require('../models/User');
const Admin = require('../models/Admin');
const HostelBlock = require('../models/HostelBlock');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_this';
const JWT_EXPIRES = '7d';

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
                name: user.name || null
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
        
        let mappedAcc = user.accommodation || {};
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

        res.status(200).json({
            name: user.name || user.username,
            email: user.username,
            role: user.role,
            accommodation: mappedAcc,
            foodTokens: user.foodTokens || {},
            cautionDeposit: user.cautionDeposit || {},
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
            }
        });

    } catch (error) {
        console.error('Accommodation details error:', error);
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
