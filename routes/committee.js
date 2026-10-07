const express = require('express');
const router = express.Router();
const Committee = require('../models/Committee');

// POST route to add a new committee member
router.post('/', async (req, res) => {
    try {
        const { memberName, designation, position, email, phone, photo, order } = req.body;
        
        const newMember = new Committee({
            memberName,
            designation,
            position,
            email,
            phone,
            photo,
            order: order || 0
        });

        await newMember.save();
        
        require('../socket').getIO().emit('committeeUpdated');

        res.status(201).json({ message: 'Committee member added successfully', member: newMember });
    } catch (error) {
        console.error('Error adding committee member:', error);
        res.status(500).json({ error: error.message || 'Failed to add committee member' });
    }
});

// GET route to fetch all committee members
router.get('/', async (req, res) => {
    try {
        const members = await Committee.find().sort({ order: 1, createdAt: 1 });
        res.status(200).json(members);
    } catch (error) {
        console.error('Error fetching committee members:', error);
        res.status(500).json({ error: 'Failed to fetch committee members' });
    }
});

// PUT route to update order of a committee member
router.put('/:id/order', async (req, res) => {
    try {
        const { order } = req.body;
        const updatedMember = await Committee.findByIdAndUpdate(
            req.params.id,
            { order: Number(order) },
            { new: true }
        );
        
        if (!updatedMember) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        require('../socket').getIO().emit('committeeUpdated');
        
        res.status(200).json({ message: 'Order updated successfully', member: updatedMember });
    } catch (error) {
        console.error('Error updating member order:', error);
        res.status(500).json({ error: 'Failed to update member order' });
    }
});

// DELETE route to remove a committee member
router.delete('/:id', async (req, res) => {
    try {
        const deletedMember = await Committee.findByIdAndDelete(req.params.id);
        
        if (!deletedMember) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        require('../socket').getIO().emit('committeeUpdated');
        
        res.status(200).json({ message: 'Member deleted successfully' });
    } catch (error) {
        console.error('Error deleting member:', error);
        res.status(500).json({ error: 'Failed to delete member' });
    }
});

module.exports = router;
