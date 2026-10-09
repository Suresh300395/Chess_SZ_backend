const mongoose = require('mongoose');
const crypto = require('crypto');
const { MEAL_TYPES, EVENT_NAME } = require('../config/mealConfig');

// 32-character alphabet omitting visually ambiguous characters: 0, O, 1, I
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateSecureCode(length = 10) {
    const bytes = crypto.randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
}

const auditLogSchema = new mongoose.Schema({
    action: {
        type: String,
        enum: ['ISSUE', 'REPRINT', 'REDEEM', 'CANCEL'],
        required: true
    },
    performedBy: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    details: { type: String }
}, { _id: false });

const foodTokenSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    personType: {
        type: String,
        enum: ['PLAYER', 'COACH', 'MANAGER'],
        required: true
    },
    personRef: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'personTypeModel'
    },
    personTypeModel: {
        type: String,
        enum: ['Registration'],
        default: 'Registration'
    },
    // Snapshot fields preserved at the time of token issuance
    name: {
        type: String,
        required: true,
        trim: true
    },
    identifier: {
        type: String,
        required: true,
        trim: true
    },
    teamOrSport: {
        type: String,
        default: '',
        trim: true
    },
    block: {
        type: String,
        default: '',
        trim: true
    },
    room: {
        type: String,
        default: '',
        trim: true
    },
    eventName: {
        type: String,
        default: EVENT_NAME
    },
    mealType: {
        type: String,
        enum: MEAL_TYPES,
        required: true
    },
    mealDate: {
        type: String, // Format: YYYY-MM-DD
        required: true
    },
    status: {
        type: String,
        enum: ['ISSUED', 'REDEEMED', 'CANCELLED'],
        default: 'ISSUED'
    },
    issuedBy: {
        type: String,
        required: true
    },
    issuedAt: {
        type: Date,
        default: Date.now
    },
    printCount: {
        type: Number,
        default: 1
    },
    lastPrintedAt: {
        type: Date,
        default: Date.now
    },
    redeemedBy: {
        type: String,
        default: null
    },
    redeemedAt: {
        type: Date,
        default: null
    },
    cancelledBy: {
        type: String,
        default: null
    },
    cancelledAt: {
        type: Date,
        default: null
    },
    cancelReason: {
        type: String,
        default: null
    },
    auditLog: [auditLogSchema]
}, { timestamps: true });

// Strict unique index on code
foodTokenSchema.index({ code: 1 }, { unique: true });

// Unique compound index: One person can have only ONE token per mealType per mealDate
foodTokenSchema.index({ personType: 1, personRef: 1, mealType: 1, mealDate: 1 }, { unique: true });

// Performance index for stats aggregation and filtering
foodTokenSchema.index({ status: 1, mealType: 1, mealDate: 1 });
foodTokenSchema.index({ mealDate: 1, createdAt: -1 });

module.exports = {
    FoodToken: mongoose.model('FoodToken', foodTokenSchema),
    generateSecureCode
};
