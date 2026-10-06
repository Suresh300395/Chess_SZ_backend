const User = require('../models/User');

exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        if (user.password !== password) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        res.status(200).json({ message: 'Login successful', user: { username: user.username, role: user.role } });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
exports.registerAdmin = async (req, res) => {
    const { username, password, mobile } = req.body;
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        
        const newUser = await User.create({ username, password, mobile, role: 'admin' });
        res.status(201).json({ message: 'Admin created successfully', user: { username: newUser.username, role: newUser.role } });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getAdmins = async (req, res) => {
    try {
        const admins = await User.find({ role: 'admin' }).select('-__v');
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
        if (password) {
            admin.password = password;
        }
        admin.mobile = mobile || admin.mobile;
        
        await admin.save();
        res.status(200).json({ message: 'Admin updated successfully', user: admin });
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
            await User.create({ username: 'superadmin', password: 'Aditya@123', role: 'superadmin' });

        }
    } catch (error) {
        console.error('Error seeding admin:', error.message);
    }
};
