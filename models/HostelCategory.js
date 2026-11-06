const mongoose = require('mongoose');

const hostelCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    }
}, { timestamps: true });

module.exports = mongoose.model('HostelCategory', hostelCategorySchema);

