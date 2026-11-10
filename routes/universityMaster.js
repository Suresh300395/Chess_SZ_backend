const express = require('express');
const router = express.Router();
const universityController = require('../controllers/universityController');
const { verifyToken, requireAdmin } = require('../Modules/authMiddleware');

// Public route for Registration Page Autocomplete & Search
router.get('/search-active', universityController.searchActiveUniversities);
router.get('/template', universityController.getSampleTemplate);

// Protected Admin Routes
router.get('/', verifyToken, requireAdmin, universityController.getUniversities);
router.get('/stats', verifyToken, requireAdmin, universityController.getStats);
router.get('/check-duplicate', verifyToken, requireAdmin, universityController.checkDuplicate);
router.get('/export', verifyToken, requireAdmin, universityController.exportUniversities);
router.post('/bulk-import', verifyToken, requireAdmin, universityController.bulkImport);
router.post('/', verifyToken, requireAdmin, universityController.createUniversity);
router.put('/:id', verifyToken, requireAdmin, universityController.updateUniversity);
router.patch('/:id/status', verifyToken, requireAdmin, universityController.toggleStatus);
router.delete('/:id', verifyToken, requireAdmin, universityController.deleteUniversity);

module.exports = router;

