const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
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
        enum: ['superadmin', 'admin'],
        default: 'admin'
    },
    photo: {
        type: String,
        default: ''
    }
}, { timestamps: true });

// Hash password before saving (only if modified)
adminSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare passwords
adminSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);
