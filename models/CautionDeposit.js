const mongoose = require('mongoose');

const cautionDepositSchema = new mongoose.Schema({
    registrationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Registration',
        required: true,
        index: true
    },
    universityName: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    targetType: {
        type: String,
        enum: ['Team', 'Coach'],
        default: 'Team',
        index: true
    },
    coachId: {
        type: String,
        default: '',
        index: true
    },
    paid: {
        type: Boolean,
        default: false,
        index: true
    },
    amount: {
        type: Number,
        default: 2000
    },
    paidBy: {
        personId: { type: String, default: '' },
        name: { type: String, default: '' },
        role: { type: String, default: '' },
        phone: { type: String, default: '' },
        roomNumber: { type: String, default: '' }
    },
    paymentMode: {
        type: String,
        default: 'Cash'
    },
    receiptNo: {
        type: String,
        default: '',
        index: true
    },
    paidAt: {
        type: Date
    },
    collectedBy: {
        type: String,
        default: 'Hostel Admin'
    },
    notes: {
        type: String,
        default: ''
    },
    refundStatus: {
        type: String,
        enum: ['N/A', 'Refund Pending', 'Refunded'],
        default: 'N/A',
        index: true
    },
    refundedAt: {
        type: Date
    },
    refundedAmount: {
        type: Number,
        default: 0
    },
    refundedBy: {
        type: String,
        default: ''
    },
    refundOtpHash: {
        type: String,
        default: null
    },
    refundOtpExpires: {
        type: Date,
        default: null
    },
    refundOtpSentTo: {
        type: String,
        default: ''
    },
    refundOtpSentName: {
        type: String,
        default: ''
    },
    rooms: [{
        type: String
    }]
}, {
    timestamps: true
});

// Compound unique index per registration + targetType + coachId
cautionDepositSchema.index(
    { registrationId: 1, targetType: 1, coachId: 1 },
    { unique: true }
);

module.exports = mongoose.model('CautionDeposit', cautionDepositSchema);

