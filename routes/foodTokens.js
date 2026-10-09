const express = require('express');
const router = express.Router();
const foodTokenController = require('../controllers/foodTokenController');
const { verifyToken, requireAdmin } = require('../Modules/authMiddleware');

// In-memory lightweight rate limiter for high-frequency sensitive endpoints
const createRateLimiter = (windowMs = 60000, maxRequests = 120) => {
    const hits = new Map();
    return (req, res, next) => {
        const key = req.user?.id || req.ip || 'global';
        const now = Date.now();
        const record = hits.get(key) || { count: 0, resetTime: now + windowMs };

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + windowMs;
        } else {
            record.count += 1;
        }

        hits.set(key, record);

        if (record.count > maxRequests) {
            return res.status(429).json({
                message: 'Too many requests. Please slow down and try again in a moment.'
            });
        }
        next();
    };
};

const issueLimiter = createRateLimiter(60000, 100);

// All food token routes require authentication and admin/superadmin role
router.use(verifyToken, requireAdmin);

// 1. Search people eligible for tokens (Players, Coaches, Managers)
router.get('/people', foodTokenController.getPeople);

// 2. Issue a token for one person
router.post('/issue', issueLimiter, foodTokenController.issueToken);

// 3. Issue tokens in bulk for a whole team/university
router.post('/issue-bulk', issueLimiter, foodTokenController.issueBulk);

// 3b. Issue all tokens for one person for a specific day
router.post('/issue-day', issueLimiter, foodTokenController.issueDayTokens);

// 4. Reprint an existing token (ISSUED only)
router.post('/:id/reprint', foodTokenController.reprintToken);

// 5. Cancel a token with a mandatory reason
router.post('/:id/cancel', foodTokenController.cancelToken);

// 7. Get token list with filters and pagination
router.get('/', foodTokenController.getTokens);

// 8. Aggregated statistics by meal type and status for a date
router.get('/stats', foodTokenController.getStats);

module.exports = router;
