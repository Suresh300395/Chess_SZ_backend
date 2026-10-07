const express = require('express');
const router = express.Router();
const Registration = require('../models/Registration');

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

module.exports = router;
