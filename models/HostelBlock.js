const mongoose = require('mongoose');

const floorSchema = new mongoose.Schema({
    floorName: { type: String, required: true },
    roomCount: { type: Number, required: true },
    rooms: [{ type: String }] // Array of room numbers
});

const hostelBlockSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    block: {
        type: String,
        required: true,
        trim: true
    },
    warden: {
        type: String,
        trim: true
    },
    wardenContact: {
        type: String,
        trim: true
    },
    officeHours: {
        type: String,
        trim: true
    },
    address: {
        type: String,
        trim: true
    },
    capacityPerRoom: {
        type: Number,
        default: 4
    },
    floors: [floorSchema]
}, { timestamps: true });

module.exports = mongoose.model('HostelBlock', hostelBlockSchema);
