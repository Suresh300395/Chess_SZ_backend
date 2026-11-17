const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    boardNumber: { type: String, default: '1' },
    whitePlayer: { type: String, default: '' },
    whiteUniversity: { type: String, default: '' },
    blackPlayer: { type: String, default: '' },
    blackUniversity: { type: String, default: '' },
    result: { type: String, default: '*' } // '*', '1-0', '0-1', '1/2-1/2', 'Ongoing'
});

const liveBoardSchema = new mongoose.Schema({
    title: {
        type: String,
        default: 'South Zone Inter-University Chess Championship - Live Board'
    },
    currentRound: {
        type: String,
        default: 'Round 1'
    },
    status: {
        type: String,
        enum: ['LIVE', 'UPCOMING', 'COMPLETED', 'PAUSED'],
        default: 'LIVE'
    },
    announcement: {
        type: String,
        default: 'Live games in progress. Follow the top boards live!'
    },
    embedUrl: {
        type: String,
        default: 'https://s1.chess-results.com/tnr1522420.aspx?lan=1&SNode=S0' // Chess-results embed URL
    },
    externalLink: {
        type: String,
        default: 'https://s1.chess-results.com/tnr1522420.aspx?lan=1&SNode=S0' // Chess-results pairing or ranking link
    },
    streamUrl: {
        type: String,
        default: '' // Live video streaming embed URL (YouTube / Twitch / Custom)
    },
    matches: [matchSchema],
    updatedBy: {
        type: String,
        default: 'Super Admin'
    }
}, { timestamps: true });

module.exports = mongoose.model('LiveBoard', liveBoardSchema);
