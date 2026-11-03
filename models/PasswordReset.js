const mongoose = require('mongoose');

const passwordResetSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    user_type: {
        type: String,
        enum: ['User', 'Admin'],
        default: 'User',
        required: true
    },
    identifier: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        index: true
    },
    identifier_type: {
        type: String,
        enum: ['email', 'mobile'],
        required: true
    },
    otp_hash: {
        type: String,
        required: true
    },
    expires_at: {
        type: Date,
        required: true,
        index: true
    },
    attempts: {
        type: Number,
        default: 0
    },
    resend_count: {
        type: Number,
        default: 0
    },
    last_sent_at: {
        type: Date,
        default: Date.now
    },
    verified_at: {
        type: Date,
        default: null
    },
    reset_token_hash: {
        type: String,
        default: null,
        index: true
    },
    reset_token_expires_at: {
        type: Date,
        default: null
    },
    used_at: {
        type: Date,
        default: null
    },
    created_at: {
        type: Date,
        default: Date.now,
        index: { expires: '24h' } // Automatically clean up expired records after 24 hours
    }
}, {
    timestamps: false // Schema explicitly uses created_at
});

// Compound indexes for optimal queries
passwordResetSchema.index({ identifier: 1, used_at: 1, created_at: -1 });
passwordResetSchema.index({ user_id: 1, used_at: 1, created_at: -1 });

module.exports = mongoose.model('PasswordReset', passwordResetSchema);

