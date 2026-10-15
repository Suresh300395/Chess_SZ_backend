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
    accommodation: { type: String, required: true },
    roomAllocation: {
        building: { type: String },
        floor: { type: String },
        roomNumber: { type: String },
        allocatedAt: { type: Date }
    },
    photo: { type: String, default: '' }
});

const coachSchema = new mongoose.Schema({
    role: { type: String, required: true },
    name: { type: String, required: true },
    mobileNo: { type: String, required: true },
    mailId: { type: String, required: true },
    gender: { type: String, required: true },
    foodType: { type: String, required: true },
    accommodation: { type: String, required: true },
    roomAllocation: {
        building: { type: String },
        floor: { type: String },
        roomNumber: { type: String },
        allocatedAt: { type: Date }
    },
    photo: { type: String, default: '' }
});

const cautionDepositSchema = new mongoose.Schema({
    paid: { type: Boolean, default: false },
    amount: { type: Number, default: 2000 },
    paidBy: {
        personId: { type: String, default: '' },
        name: { type: String, default: '' },
        role: { type: String, default: '' },
        phone: { type: String, default: '' },
        roomNumber: { type: String, default: '' }
    },
    paymentMode: { type: String, default: 'Cash' },
    receiptNo: { type: String, default: '' },
    paidAt: { type: Date },
    collectedBy: { type: String, default: 'Admin' },
    notes: { type: String, default: '' },
    refundStatus: { type: String, enum: ['N/A', 'Refund Pending', 'Refunded'], default: 'N/A' },
    refundedAt: { type: Date },
    refundedAmount: { type: Number, default: 0 }
}, { _id: false });

const registrationSchema = new mongoose.Schema({
    universityName: { type: String, required: true },
    universityContact: { type: String, required: true },
    address: { type: String, required: true },
    players: [playerSchema],
    coaches: [coachSchema],
    cautionDeposit: {
        type: cautionDepositSchema,
        default: () => ({
            paid: false,
            amount: 2000,
            refundStatus: 'N/A'
        })
    }
}, { timestamps: true });

// Case-insensitive unique index to prevent duplicate universities
registrationSchema.index({ universityName: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('Registration', registrationSchema);
