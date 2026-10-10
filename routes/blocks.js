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

router.get('/guidelines', getGuidelines);
router.put('/guidelines', updateGuidelines);

router.post('/', addBlock);
router.get('/', getBlocks);
router.put('/:id', updateBlock);
router.delete('/:id', deleteBlock);

module.exports = router;
