const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, requireAdmin, requireSuperAdmin } = require('../Modules/authMiddleware');

// Public routes
router.post('/login', authController.login);
router.post('/check-mobile', authController.checkMobile);

// Protected: logged-in user dashboard
router.get('/dashboard', verifyToken, authController.getDashboard);
router.put('/profile-photo', verifyToken, authController.updateProfilePhoto);
router.get('/accommodation-details', verifyToken, authController.getAccommodationDetails);
router.get('/food-token-details', verifyToken, authController.getFoodTokenDetails);

// Protected: only superadmin can manage admins
router.post('/register-admin', verifyToken, requireSuperAdmin, authController.registerAdmin);
router.get('/admins', verifyToken, requireAdmin, authController.getAdmins);
router.put('/admins/:id', verifyToken, requireSuperAdmin, authController.updateAdmin);
router.delete('/admins/:id', verifyToken, requireSuperAdmin, authController.deleteAdmin);

module.exports = router;
