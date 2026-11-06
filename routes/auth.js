const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const passwordResetController = require('../controllers/passwordResetController');
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

// Dedicated rate limiters for secure OTP & Password Reset endpoints
const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many password reset requests from this IP. Please try again after 15 minutes.' }
});

const verifyOtpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many OTP verification attempts. Please try again after 15 minutes.' }
});

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many password update attempts. Please try again after 15 minutes.' }
});

const resendOtpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many OTP resend attempts. Please try again after 15 minutes.' }
});

// Public routes with rate limiting
router.post('/login', loginLimiter, authController.login);
router.post('/check-mobile', checkMobileLimiter, authController.checkMobile);

// Secure Password Reset OTP routes
router.post('/forgot-password', forgotPasswordLimiter, passwordResetController.forgotPassword);
router.post('/verify-reset-otp', verifyOtpLimiter, passwordResetController.verifyResetOtp);
router.post('/reset-password', resetPasswordLimiter, passwordResetController.resetPassword);
router.post('/resend-reset-otp', resendOtpLimiter, passwordResetController.resendResetOtp);

// Protected: logged-in user dashboard and credentials
router.get('/me', verifyToken, authController.getMe);
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
