const mongoose = require('mongoose');

const committeeSchema = new mongoose.Schema({
    memberName: { type: String, required: true },
    designation: { type: String, required: true },
    position: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    photo: { type: String }, // Base64 or URL
    order: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Committee', committeeSchema);
