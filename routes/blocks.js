const express = require('express');
const router = express.Router();
const { 
    addBlock, 
    getBlocks, 
    deleteBlock, 
    updateBlock,
    getGuidelines,
    updateGuidelines,
    getCategories,
    addCategory,
    deleteCategory
} = require('../controllers/blockController');
const { verifyToken, requireAdmin } = require('../Modules/authMiddleware');

// Category routes
router.get('/categories', getCategories);
router.post('/categories', verifyToken, requireAdmin, addCategory);
router.delete('/categories/:id', verifyToken, requireAdmin, deleteCategory);

// Public read routes
router.get('/guidelines', getGuidelines);
router.get('/', getBlocks);

// Protected administrative write routes
router.put('/guidelines', verifyToken, requireAdmin, updateGuidelines);
router.post('/', verifyToken, requireAdmin, addBlock);
router.put('/:id', verifyToken, requireAdmin, updateBlock);
router.delete('/:id', verifyToken, requireAdmin, deleteBlock);

module.exports = router;
