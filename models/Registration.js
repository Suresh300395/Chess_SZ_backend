const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    mobileNo: { type: String, required: true },
    gender: { type: String, required: true },
    dob: { type: String, required: true },
    transportMode: { type: String, required: true },
    transportNumber: { type: String },
    arrivalDate: { type: String, required: true },
    arrivalTime: { type: String, required: true },
    departureDate: { type: String, required: true },
    departureTime: { type: String, required: true },
    accommodation: { type: String, required: true }
});

const coachSchema = new mongoose.Schema({
    role: { type: String, required: true },
    name: { type: String, required: true },
    mobileNo: { type: String, required: true },
    mailId: { type: String, required: true },
    gender: { type: String, required: true },
    foodType: { type: String, required: true },
    accommodation: { type: String, required: true }
});

const registrationSchema = new mongoose.Schema({
    universityName: { type: String, required: true },
    universityContact: { type: String, required: true },
    address: { type: String, required: true },
    players: [playerSchema],
    coaches: [coachSchema]
}, { timestamps: true });

module.exports = mongoose.model('Registration', registrationSchema);
