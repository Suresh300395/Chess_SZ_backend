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
