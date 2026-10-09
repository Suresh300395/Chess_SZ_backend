const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    name: {
        type: String,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    mobile: {
        type: String,
        trim: true
    },
    role: {
        type: String,
        enum: ['superadmin', 'admin', 'player', 'coach'],
        default: 'admin'
    },
    registrationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Registration',
        index: true
    },
    participantId: {
        type: mongoose.Schema.Types.ObjectId
    },
    participantType: {
        type: String,
        enum: ['player', 'coach']
    },
    accommodation: {
        block: { type: String, default: '' },
        roomNumber: { type: String, default: '' },
        roomType: { type: String, default: '' },
        status: { type: String, default: 'Not Allocated' }  // e.g. Allocated, Not Allocated
    },
    foodTokens: {
        total: { type: Number, default: 0 },
        used: { type: Number, default: 0 },
        status: { type: String, default: 'Inactive' }       // Active, Inactive
    },
    cautionDeposit: {
        amount: { type: Number, default: 0 },
        paid: { type: Boolean, default: false },
        refundStatus: { type: String, default: 'N/A' }      // Paid, Refund Pending, N/A
    }
}, { timestamps: true });

// Hash password before saving (only if modified)
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});


// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
