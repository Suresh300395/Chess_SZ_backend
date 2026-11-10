const mongoose = require('mongoose');

// Helper to normalize strings for comparison (lower-cased, extra spaces & punctuation removed)
const normalize = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 ]/g, ''); // alphanumeric only for robust duplicate detection
};

const universitySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'University name is required'],
        trim: true
    },
    normalizedName: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    phone: {
        type: String,
        trim: true,
        default: ''
    },
    address: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'INACTIVE'],
        default: 'ACTIVE',
        index: true
    },
    registeredTeamCount: {
        type: Number,
        default: 0
    },
    createdSource: {
        type: String,
        enum: ['MANUAL', 'BULK_IMPORT', 'SYSTEM'],
        default: 'MANUAL'
    },
    createdBy: {
        type: String,
        default: 'Admin'
    }
}, {
    timestamps: true
});

// Pre-save middleware to auto-populate normalized fields
universitySchema.pre('validate', function() {
    if (this.name) {
        this.normalizedName = normalize(this.name);
    }
});

universitySchema.statics.normalize = normalize;

module.exports = mongoose.models.University || mongoose.model('University', universitySchema);
