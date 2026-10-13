const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { verifyToken, requireAdmin, requireSuperAdmin } = require('../Modules/authMiddleware');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts. Please try again after 15 minutes.' }
});

const checkMobileLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' }
});

// Public routes with rate limiting
router.post('/login', loginLimiter, authController.login);
router.post('/check-mobile', checkMobileLimiter, authController.checkMobile);

// Protected: logged-in user dashboard and credentials
router.get('/dashboard', verifyToken, authController.getDashboard);
router.put('/profile-photo', verifyToken, authController.updateProfilePhoto);
router.put('/change-password', verifyToken, authController.changePassword);
router.get('/accommodation-details', verifyToken, authController.getAccommodationDetails);
router.get('/food-token-details', verifyToken, authController.getFoodTokenDetails);

// Protected: only superadmin can manage admins
router.post('/register-admin', verifyToken, requireSuperAdmin, authController.registerAdmin);
router.get('/admins', verifyToken, requireAdmin, authController.getAdmins);
router.put('/admins/:id', verifyToken, requireSuperAdmin, authController.updateAdmin);
router.delete('/admins/:id', verifyToken, requireSuperAdmin, authController.deleteAdmin);

module.exports = router;
