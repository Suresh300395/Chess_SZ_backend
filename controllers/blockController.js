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
