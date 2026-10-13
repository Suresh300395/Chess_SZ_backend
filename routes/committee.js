const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Committee = require('../models/Committee');

const uploadDir = path.join(__dirname, '../public/uploads/committee');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Helper: Save Base64 image to physical file in public/uploads/committee
const saveBase64Image = async (base64Str, prefix = 'committee') => {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image/')) {
        return base64Str;
    }
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
    let ext = 'webp';
    if (base64Str.startsWith('data:image/png')) ext = 'png';
    else if (base64Str.startsWith('data:image/jpeg') || base64Str.startsWith('data:image/jpg')) ext = 'jpg';
    else if (base64Str.startsWith('data:image/webp')) ext = 'webp';

    const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
    const targetFilePath = path.join(uploadDir, fileName);

    await fs.promises.writeFile(targetFilePath, buffer);
    return `/uploads/committee/${fileName}`;
};

// Helper: Delete physical image file from disk
const deleteImageFile = (photoPath) => {
    if (!photoPath || typeof photoPath !== 'string') return;
    const match = photoPath.match(/\/uploads\/committee\/[^\s?#]+/);
    if (match) {
        const relativePath = match[0];
        const filePath = path.join(__dirname, '../public', relativePath);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.error(`Error deleting committee photo file: ${filePath}`, err);
            }
        }
    }
};

// Helper: Format photo path to full URL for clients
const formatPhotoUrl = (req, photoPath) => {
    if (!photoPath) return '';
    if (photoPath.startsWith('http://') || photoPath.startsWith('https://') || photoPath.startsWith('data:')) {
        return photoPath;
    }
    const host = req.get('host');
    const protocol = req.protocol;
    return `${protocol}://${host}${photoPath.startsWith('/') ? '' : '/'}${photoPath}`;
};

// POST route to add a new committee member
router.post('/', async (req, res) => {
    try {
        const { memberName, designation, position, email, phone, photo, order } = req.body;
        
        let savedPhoto = '';
        if (photo) {
            savedPhoto = await saveBase64Image(photo);
        }

        const newMember = new Committee({
            memberName,
            designation,
            position,
            email,
            phone,
            photo: savedPhoto,
            order: order !== undefined && order !== '' ? Number(order) : 0
        });

        await newMember.save();
        
        try {
            require('../socket').getIO().emit('committeeUpdated');
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }

        const memberObj = newMember.toObject();
        memberObj.photo = formatPhotoUrl(req, memberObj.photo);

        res.status(201).json({ message: 'Committee member added successfully', member: memberObj });
    } catch (error) {
        console.error('Error adding committee member:', error);
        res.status(500).json({ error: error.message || 'Failed to add committee member' });
    }
});

// GET route to fetch all committee members
router.get('/', async (req, res) => {
    try {
        const members = await Committee.find().sort({ order: 1, createdAt: 1 });
        const formattedMembers = members.map(m => {
            const obj = m.toObject();
            obj.photo = formatPhotoUrl(req, obj.photo);
            return obj;
        });
        res.status(200).json(formattedMembers);
    } catch (error) {
        console.error('Error fetching committee members:', error);
        res.status(500).json({ error: 'Failed to fetch committee members' });
    }
});

// PUT route to update a committee member
router.put('/:id', async (req, res) => {
    try {
        const existingMember = await Committee.findById(req.params.id);
        if (!existingMember) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const updateData = { ...req.body };
        if (updateData.order !== undefined && updateData.order !== '') {
            updateData.order = Number(updateData.order);
        }

        // If new photo provided as base64
        if (typeof updateData.photo === 'string' && updateData.photo.startsWith('data:image/')) {
            // Delete old physical file if it exists
            deleteImageFile(existingMember.photo);
            // Save new physical file
            updateData.photo = await saveBase64Image(updateData.photo);
        }

        const updatedMember = await Committee.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );
        
        try {
            require('../socket').getIO().emit('committeeUpdated');
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }

        const memberObj = updatedMember.toObject();
        memberObj.photo = formatPhotoUrl(req, memberObj.photo);
        
        res.status(200).json({ message: 'Committee member updated successfully', member: memberObj });
    } catch (error) {
        console.error('Error updating committee member:', error);
        res.status(500).json({ error: 'Failed to update committee member' });
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
        
        try {
            require('../socket').getIO().emit('committeeUpdated');
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }

        const memberObj = updatedMember.toObject();
        memberObj.photo = formatPhotoUrl(req, memberObj.photo);
        
        res.status(200).json({ message: 'Order updated successfully', member: memberObj });
    } catch (error) {
        console.error('Error updating member order:', error);
        res.status(500).json({ error: 'Failed to update member order' });
    }
});

// DELETE route to remove a committee member and their photo file
router.delete('/:id', async (req, res) => {
    try {
        const member = await Committee.findById(req.params.id);
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Delete physical photo file from disk if present
        if (member.photo) {
            deleteImageFile(member.photo);
        }

        await Committee.findByIdAndDelete(req.params.id);
        
        try {
            require('../socket').getIO().emit('committeeUpdated');
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }
        
        res.status(200).json({ message: 'Member and photo file deleted successfully' });
    } catch (error) {
        console.error('Error deleting member:', error);
        res.status(500).json({ error: 'Failed to delete member' });
    }
});

module.exports = router;
