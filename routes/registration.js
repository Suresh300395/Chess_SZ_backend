const express = require('express');
const router = express.Router();
const Registration = require('../models/Registration');
const User = require('../models/User');
const { verifyToken, requireAdmin } = require('../Modules/authMiddleware');


router.post('/', async (req, res) => {
    try {
        const { teamDetails, players, coaches } = req.body;
        
        const newRegistration = new Registration({
            universityName: teamDetails.universityName,
            universityContact: teamDetails.universityContact,
            address: teamDetails.address,
            players,
            coaches
        });

        const savedRegistration = await newRegistration.save();

        // Create user accounts for each player
        for (const player of players) {
            try {
                // Check if user already exists to avoid duplicate key errors
                const existingUser = await User.findOne({ username: player.mobileNo });
                if (!existingUser) {
                    await User.create({
                        username: player.mobileNo,
                        name: player.playerName,
                        password: 'Aditya@123',
                        mobile: player.mobileNo,
                        role: 'player'
                    });
                } else if (!existingUser.name) {
                    existingUser.name = player.playerName;
                    await existingUser.save();
                }
            } catch (err) {
                console.error(`Failed to create user for player ${player.mobileNo}:`, err);
            }
        }
        
        // Emit event for real-time update
        require('../socket').getIO().emit('dataUpdated');

        res.status(201).json({ message: 'Registration successful', data: savedRegistration });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ message: 'Server error during registration', error: error.message });
    }
});

router.get('/', verifyToken, requireAdmin, async (req, res) => {
    try {
        const registrations = await Registration.find().sort({ createdAt: -1 });
        res.status(200).json(registrations);
    } catch (error) {
        console.error('Error fetching registrations:', error);
        res.status(500).json({ message: 'Failed to fetch registrations', error: error.message });
    }
});

module.exports = router;
