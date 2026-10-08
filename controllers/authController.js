const User = require('../models/User');
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
        const user = await User.findOne({ username });
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

exports.registerAdmin = async (req, res) => {
    const { username, password, mobile } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        const newUser = await User.create({ username, password, mobile, role: 'admin' });
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
        const admins = await User.find({ role: 'admin' }).select('-password -__v');
        res.status(200).json(admins);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateAdmin = async (req, res) => {
    const { id } = req.params;
    const { username, password, mobile } = req.body;
    try {
        const admin = await User.findById(id);
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
        const admin = await User.findByIdAndDelete(id);
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
        const existingAdmin = await User.findOne({ username: 'superadmin' });
        if (!existingAdmin) {
            await User.create({
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
