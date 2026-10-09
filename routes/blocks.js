const express = require('express');
const router = express.Router();
const { addBlock, getBlocks, deleteBlock, updateBlock } = require('../controllers/blockController');

router.post('/', addBlock);
router.get('/', getBlocks);
router.put('/:id', updateBlock);
router.delete('/:id', deleteBlock);

module.exports = router;
