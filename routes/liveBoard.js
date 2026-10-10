const express = require('express');
const router = express.Router();
const LiveBoard = require('../models/LiveBoard');
const { verifyToken, requireSuperAdmin } = require('../Modules/authMiddleware');

// GET live board details (Public)
router.get('/', async (req, res) => {
    try {
        let board = await LiveBoard.findOne().sort({ updatedAt: -1 });
        if (!board) {
            board = {
                title: 'South Zone Inter-University Chess Championship - Live Board',
                currentRound: 'Round 1',
                status: 'LIVE',
                announcement: 'Tournament live board is active. Follow the top boards in real-time!',
                embedUrl: '',
                externalLink: '',
                matches: []
            };
            return res.status(200).json(board);
        }
        res.status(200).json(board);
    } catch (error) {
        console.error('Error fetching live board:', error);
        res.status(500).json({ message: 'Failed to fetch live board', error: error.message });
    }
});

// PUT / update live board (Super Admin only)
router.put('/', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
        const { title, currentRound, status, announcement, embedUrl, externalLink, matches } = req.body;

        let board = await LiveBoard.findOne().sort({ updatedAt: -1 });
        if (!board) {
            board = new LiveBoard();
        }

        if (title !== undefined) board.title = title;
        if (currentRound !== undefined) board.currentRound = currentRound;
        if (status !== undefined) board.status = status;
        if (announcement !== undefined) board.announcement = announcement;
        if (embedUrl !== undefined) board.embedUrl = embedUrl;
        if (externalLink !== undefined) board.externalLink = externalLink;
        if (Array.isArray(matches)) board.matches = matches;

        board.updatedBy = req.user?.username || 'Super Admin';
        await board.save();

        // Emit real-time socket event to all connected clients
        try {
            require('../socket').getIO().emit('liveBoardUpdated', board);
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }

        res.status(200).json({
            message: 'Live board updated successfully',
            liveBoard: board
        });
    } catch (error) {
        console.error('Error updating live board:', error);
        res.status(500).json({ message: 'Failed to update live board', error: error.message });
    }
});

module.exports = router;
