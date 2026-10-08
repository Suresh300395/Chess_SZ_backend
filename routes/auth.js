const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, requireAdmin, requireSuperAdmin } = require('../Modules/authMiddleware');

// Public routes
router.post('/login', authController.login);

// Protected: only superadmin can manage admins
router.post('/register-admin', verifyToken, requireSuperAdmin, authController.registerAdmin);
router.get('/admins', verifyToken, requireAdmin, authController.getAdmins);
router.put('/admins/:id', verifyToken, requireSuperAdmin, authController.updateAdmin);
router.delete('/admins/:id', verifyToken, requireSuperAdmin, authController.deleteAdmin);

module.exports = router;
