const mongoose = require('mongoose');

const hostelGuidelineSchema = new mongoose.Schema({
    points: [{
        type: String,
        trim: true
    }],
    updatedBy: {
        type: String,
        default: 'Admin'
    }
}, { timestamps: true });

module.exports = mongoose.model('HostelGuideline', hostelGuidelineSchema);
