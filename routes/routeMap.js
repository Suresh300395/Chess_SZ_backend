const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const RouteMap = require('../models/RouteMap');
const { verifyToken, requireSuperAdmin } = require('../Modules/authMiddleware');

// Helper to format mapImage to full URL for clients
const formatImageUrl = (req, imgPath) => {
    if (!imgPath) return '';
    if (imgPath.startsWith('http://') || imgPath.startsWith('https://') || imgPath.startsWith('data:')) {
        return imgPath;
    }
    const host = req.get('host');
    const protocol = req.protocol;
    return `${protocol}://${host}${imgPath.startsWith('/') ? '' : '/'}${imgPath}`;
};

// GET current route map (Public)
router.get('/', async (req, res) => {
    try {
        let routeMap = await RouteMap.findOne().sort({ updatedAt: -1 });
        if (!routeMap) {
            routeMap = {
                title: 'Aditya University Campus Route Map',
                description: 'Directions and travel routes to Aditya University, Surampalem.',
                directions: 'Nearest Railway Station: Samalkot Junction (15 km)\nNearest Airport: Rajahmundry Airport (60 km)\nFrequent buses available from Kakinada and Rajahmundry.',
                mapImage: ''
            };
            return res.status(200).json(routeMap);
        }

        const formatted = routeMap.toObject();
        formatted.fullImageUrl = formatImageUrl(req, formatted.mapImage);
        res.status(200).json(formatted);
    } catch (error) {
        console.error('Error fetching route map:', error);
        res.status(500).json({ message: 'Failed to fetch route map', error: error.message });
    }
});

// PUT / POST update route map (Super Admin only)
router.put('/', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
        const { title, description, directions, imageBase64 } = req.body;

        let routeMap = await RouteMap.findOne().sort({ updatedAt: -1 });
        if (!routeMap) {
            routeMap = new RouteMap();
        }

        if (title !== undefined) routeMap.title = title;
        if (description !== undefined) routeMap.description = description;
        if (directions !== undefined) routeMap.directions = directions;

        // If a new image was uploaded
        if (typeof imageBase64 === 'string' && imageBase64.startsWith('data:image/')) {
            const uploadDir = path.join(__dirname, '../public/uploads/routemap');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            let ext = 'jpg';
            if (imageBase64.startsWith('data:image/png')) ext = 'png';
            else if (imageBase64.startsWith('data:image/webp')) ext = 'webp';
            else if (imageBase64.startsWith('data:image/jpeg') || imageBase64.startsWith('data:image/jpg')) ext = 'jpg';

            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            const fileName = `routemap-${Date.now()}.${ext}`;
            const targetFilePath = path.join(uploadDir, fileName);

            // Clean up previous image if exists
            if (routeMap.mapImage && routeMap.mapImage.startsWith('/uploads/routemap/')) {
                const oldFilePath = path.join(__dirname, '../public', routeMap.mapImage);
                if (fs.existsSync(oldFilePath)) {
                    try { fs.unlinkSync(oldFilePath); } catch (e) { /* ignore */ }
                }
            }

            await fs.promises.writeFile(targetFilePath, buffer);
            routeMap.mapImage = `/uploads/routemap/${fileName}`;
        }

        routeMap.updatedBy = req.user?.username || 'Super Admin';
        await routeMap.save();

        // Emit real-time socket notification
        try {
            require('../socket').getIO().emit('routeMapUpdated');
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }

        const formatted = routeMap.toObject();
        formatted.fullImageUrl = formatImageUrl(req, formatted.mapImage);

        res.status(200).json({
            message: 'Route map updated successfully',
            routeMap: formatted
        });
    } catch (error) {
        console.error('Error updating route map:', error);
        res.status(500).json({ message: 'Failed to update route map', error: error.message });
    }
});

// DELETE route map image / reset (Super Admin only)
router.delete('/', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
        const routeMap = await RouteMap.findOne().sort({ updatedAt: -1 });
        if (routeMap) {
            if (routeMap.mapImage && routeMap.mapImage.startsWith('/uploads/routemap/')) {
                const oldFilePath = path.join(__dirname, '../public', routeMap.mapImage);
                if (fs.existsSync(oldFilePath)) {
                    try { fs.unlinkSync(oldFilePath); } catch (e) { /* ignore */ }
                }
            }
            routeMap.mapImage = '';
            await routeMap.save();
        }

        try {
            require('../socket').getIO().emit('routeMapUpdated');
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }

        res.status(200).json({ message: 'Route map image deleted successfully' });
    } catch (error) {
        console.error('Error deleting route map:', error);
        res.status(500).json({ message: 'Failed to delete route map', error: error.message });
    }
});

module.exports = router;
