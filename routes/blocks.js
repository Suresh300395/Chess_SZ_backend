const express = require('express');
const router = express.Router();
const { 
    addBlock, 
    getBlocks, 
    deleteBlock, 
    updateBlock,
    getGuidelines,
    updateGuidelines
} = require('../controllers/blockController');
const { verifyToken, requireAdmin } = require('../Modules/authMiddleware');

// Public read routes
router.get('/guidelines', getGuidelines);
router.get('/', getBlocks);

// Protected administrative write routes
router.put('/guidelines', verifyToken, requireAdmin, updateGuidelines);
router.post('/', verifyToken, requireAdmin, addBlock);
router.put('/:id', verifyToken, requireAdmin, updateBlock);
router.delete('/:id', verifyToken, requireAdmin, deleteBlock);

module.exports = router;
