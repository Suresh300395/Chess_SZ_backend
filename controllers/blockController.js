const mongoose = require('mongoose');
const HostelBlock = require('../models/HostelBlock');

const emitBlockUpdate = () => {
    try {
        const socket = require('../socket');
        const io = socket.getIO();
        if (io) {
            io.emit('blocks_updated');
            io.emit('dataUpdated');
        }
    } catch (e) {
        // Socket optional
    }
};

exports.addBlock = async (req, res) => {
    try {
        const { name, block, warden, wardenContact, incharge, inchargeContact, officeHours, address, capacityPerRoom, floors } = req.body;
        
        // Validation
        if (!name || !block) {
            return res.status(400).json({ message: 'Name and Block fields are required' });
        }

        const existingBlock = await HostelBlock.findOne({ name });
        if (existingBlock) {
            return res.status(400).json({ message: 'A block with this name already exists' });
        }

        const inchargeName = incharge || warden || '';
        const inchargePhone = inchargeContact || wardenContact || '';

        const newBlock = new HostelBlock({
            name,
            block,
            warden: inchargeName,
            wardenContact: inchargePhone,
            incharge: inchargeName,
            inchargeContact: inchargePhone,
            officeHours: officeHours || '',
            address: address || '',
            capacityPerRoom,
            floors
        });

        await newBlock.save();
        emitBlockUpdate();
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

        emitBlockUpdate();
        res.status(200).json({ message: 'Block deleted successfully' });
    } catch (error) {
        console.error('Error deleting block:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.updateBlock = async (req, res) => {
    try {
        const { id } = req.params;
        const allowedFields = ['name', 'block', 'warden', 'wardenContact', 'incharge', 'inchargeContact', 'officeHours', 'address', 'capacityPerRoom', 'floors'];
        const updateData = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        }
        if (updateData.warden !== undefined && updateData.incharge === undefined) {
            updateData.incharge = updateData.warden;
        } else if (updateData.incharge !== undefined && updateData.warden === undefined) {
            updateData.warden = updateData.incharge;
        }
        if (updateData.wardenContact !== undefined && updateData.inchargeContact === undefined) {
            updateData.inchargeContact = updateData.wardenContact;
        } else if (updateData.inchargeContact !== undefined && updateData.wardenContact === undefined) {
            updateData.wardenContact = updateData.inchargeContact;
        }
        
        if (updateData.name) {
            const existing = await HostelBlock.findOne({ name: updateData.name, _id: { $ne: id } });
            if (existing) {
                return res.status(400).json({ message: 'A block with this name already exists' });
            }
        }
        
        const updatedBlock = await HostelBlock.findByIdAndUpdate(id, { $set: updateData }, { returnDocument: 'after', runValidators: true });
        if (!updatedBlock) {
             return res.status(404).json({ message: 'Block not found' });
        }
        emitBlockUpdate();
        res.json({ message: 'Block updated successfully', block: updatedBlock });
    } catch (error) {
        console.error('Error updating block:', error);
        res.status(500).json({ message: 'Server Error' });
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

const HostelCategory = require('../models/HostelCategory');

const DEFAULT_CATEGORIES = ['Boys Hostel', 'Girls Hostel', 'Staff Hostel', 'Guest House'];

// Metadata model to track one-time initial seed
const hostelCategoryMetaSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed
}, { collection: 'hostel_category_meta' });

const HostelCategoryMeta = mongoose.models.HostelCategoryMeta || mongoose.model('HostelCategoryMeta', hostelCategoryMetaSchema);

exports.initCategories = async () => {
    try {
        const meta = await HostelCategoryMeta.findOne({ key: 'categories_seeded' });
        if (!meta) {
            const count = await HostelCategory.countDocuments();
            if (count === 0) {
                const existingBlockCategories = await HostelBlock.distinct('block');
                const allDefaults = Array.from(new Set([...DEFAULT_CATEGORIES, ...existingBlockCategories.filter(Boolean)]));
                if (allDefaults.length > 0) {
                    const docs = allDefaults.map(name => ({ name }));
                    await HostelCategory.insertMany(docs, { ordered: false });
                }
            }
            await HostelCategoryMeta.create({ key: 'categories_seeded', value: true });
        }
    } catch (err) {
        console.error('Error initializing categories:', err.message);
    }
};

exports.getCategories = async (req, res) => {
    try {
        const categories = await HostelCategory.find().sort({ createdAt: 1 });
        res.status(200).json(categories);
    } catch (error) {
        console.error('Error fetching block categories:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.addCategory = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Category name is required' });
        }
        const trimmedName = name.trim();

        const escaped = trimmedName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const existing = await HostelCategory.findOne({
            name: { $regex: new RegExp(`^${escaped}$`, 'i') }
        });

        if (existing) {
            return res.status(400).json({ message: 'A category with this name already exists' });
        }

        const newCat = new HostelCategory({ name: trimmedName });
        await newCat.save();
        emitBlockUpdate();

        res.status(201).json({ message: 'Category added successfully', category: newCat });
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const category = await HostelCategory.findById(id);
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        await HostelCategory.findByIdAndDelete(id);
        emitBlockUpdate();
        res.status(200).json({ message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};


