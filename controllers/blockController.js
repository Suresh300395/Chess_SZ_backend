const HostelBlock = require('../models/HostelBlock');

exports.addBlock = async (req, res) => {
    try {
        const { name, block, warden, wardenContact, officeHours, address, capacityPerRoom, floors } = req.body;
        
        // Validation
        if (!name || !block) {
            return res.status(400).json({ message: 'Name and Block fields are required' });
        }

        const existingBlock = await HostelBlock.findOne({ name });
        if (existingBlock) {
            return res.status(400).json({ message: 'A block with this name already exists' });
        }

        const newBlock = new HostelBlock({
            name, block, warden, wardenContact, officeHours, address, capacityPerRoom, floors
        });

        await newBlock.save();
        res.status(201).json({ message: 'Block added successfully', block: newBlock });
    } catch (error) {
        console.error('Error adding block:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.getBlocks = async (req, res) => {
    try {
        const blocks = await HostelBlock.find().sort({ name: 1 });
        res.status(200).json(blocks);
    } catch (error) {
        console.error('Error fetching blocks:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.deleteBlock = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedBlock = await HostelBlock.findByIdAndDelete(id);
        
        if (!deletedBlock) {
            return res.status(404).json({ message: 'Block not found' });
        }

        res.status(200).json({ message: 'Block deleted successfully' });
    } catch (error) {
        console.error('Error deleting block:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.updateBlock = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        if (updateData.name) {
            const existing = await HostelBlock.findOne({ name: updateData.name, _id: { $ne: id } });
            if (existing) {
                return res.status(400).json({ message: 'A block with this name already exists' });
            }
        }
        
        const updatedBlock = await HostelBlock.findByIdAndUpdate(id, updateData, { new: true });
        if (!updatedBlock) {
             return res.status(404).json({ message: 'Block not found' });
        }
        res.json({ message: 'Block updated successfully', block: updatedBlock });
    } catch (error) {
        console.error('Error updating block:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

const HostelGuideline = require('../models/HostelGuideline');

const DEFAULT_GUIDELINES = [
    'Keep the room clean and maintain discipline.',
    'Any damage to property will be charged.',
    'Visitors are not allowed inside the hostel rooms.',
    'Follow hostel timings strictly.',
    'Report maintenance issues to the warden office.',
    'Ragging is strictly prohibited.'
];

exports.getGuidelines = async (req, res) => {
    try {
        let doc = await HostelGuideline.findOne().sort({ updatedAt: -1 });
        if (!doc) {
            doc = await HostelGuideline.create({ points: DEFAULT_GUIDELINES });
        }
        res.status(200).json({ points: doc.points || DEFAULT_GUIDELINES });
    } catch (error) {
        console.error('Error fetching guidelines:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.updateGuidelines = async (req, res) => {
    try {
        const { points } = req.body;
        if (!Array.isArray(points)) {
            return res.status(400).json({ message: 'Points must be an array of strings' });
        }

        const cleanPoints = points.map(p => String(p).trim()).filter(Boolean);
        let doc = await HostelGuideline.findOne().sort({ updatedAt: -1 });
        if (doc) {
            doc.points = cleanPoints;
            await doc.save();
        } else {
            doc = await HostelGuideline.create({ points: cleanPoints });
        }

        try {
            const socket = require('../socket');
            socket.getIO().emit('accommodation_guidelines_updated', { points: doc.points });
        } catch (e) {
            // socket optional
        }

        res.status(200).json({ message: 'Guidelines updated successfully', points: doc.points });
    } catch (error) {
        console.error('Error updating guidelines:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

