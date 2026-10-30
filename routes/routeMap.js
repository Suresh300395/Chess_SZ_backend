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
                mapImage: '',
                mapImages: []
            };
            return res.status(200).json(routeMap);
        }

        const formatted = routeMap.toObject();
        if (!Array.isArray(formatted.mapImages) || formatted.mapImages.length === 0) {
            formatted.mapImages = formatted.mapImage ? [formatted.mapImage] : [];
        }
        formatted.fullImageUrl = formatImageUrl(req, formatted.mapImage);
        formatted.fullImageUrls = formatted.mapImages.map(img => formatImageUrl(req, img));
        res.status(200).json(formatted);
    } catch (error) {
        console.error('Error fetching route map:', error);
        res.status(500).json({ message: 'Failed to fetch route map', error: error.message });
    }
});

// PUT / POST update route map (Super Admin only)
router.put('/', verifyToken, requireSuperAdmin, async (req, res) => {
    try {
        const { title, description, directions, images, imageBase64 } = req.body;

        let routeMap = await RouteMap.findOne().sort({ updatedAt: -1 });
        if (!routeMap) {
            routeMap = new RouteMap();
        }

        if (title !== undefined) routeMap.title = title;
        if (description !== undefined) routeMap.description = description;
        if (directions !== undefined) routeMap.directions = directions;

        const uploadDir = path.join(__dirname, '../public/uploads/routemap');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Process images array if supplied
        if (Array.isArray(images)) {
            const finalImages = [];
            for (let i = 0; i < images.length; i++) {
                const item = images[i];
                const raw = typeof item === 'string' ? item : (item?.imageBase64 || item?.url || '');
                if (typeof raw === 'string' && raw.startsWith('data:image/')) {
                    let ext = 'jpg';
                    if (raw.startsWith('data:image/png')) ext = 'png';
                    else if (raw.startsWith('data:image/webp')) ext = 'webp';
                    else if (raw.startsWith('data:image/jpeg') || raw.startsWith('data:image/jpg')) ext = 'jpg';

                    const base64Data = raw.replace(/^data:image\/\w+;base64,/, '');
                    const buffer = Buffer.from(base64Data, 'base64');
                    const fileName = `routemap-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}.${ext}`;
                    const targetPath = path.join(uploadDir, fileName);
                    await fs.promises.writeFile(targetPath, buffer);
                    finalImages.push(`/uploads/routemap/${fileName}`);
                } else if (typeof raw === 'string' && raw.trim() !== '') {
                    let relativePath = raw.trim();
                    if (relativePath.includes('/uploads/routemap/')) {
                        relativePath = `/uploads/routemap/${relativePath.split('/uploads/routemap/')[1]}`;
                    }
                    finalImages.push(relativePath);
                }
            }

            // Clean up removed image files from disk
            const prevImages = [...(routeMap.mapImages || []), routeMap.mapImage].filter(Boolean);
            for (const oldImg of prevImages) {
                if (oldImg.startsWith('/uploads/routemap/') && !finalImages.includes(oldImg)) {
                    const oldFilePath = path.join(__dirname, '../public', oldImg);
                    if (fs.existsSync(oldFilePath)) {
                        try { fs.unlinkSync(oldFilePath); } catch (e) { /* ignore */ }
                    }
                }
            }

            routeMap.mapImages = finalImages;
            routeMap.mapImage = finalImages[0] || '';
        } else if (typeof imageBase64 === 'string' && imageBase64.startsWith('data:image/')) {
            // Legacy single image update
            let ext = 'jpg';
            if (imageBase64.startsWith('data:image/png')) ext = 'png';
            else if (imageBase64.startsWith('data:image/webp')) ext = 'webp';
            else if (imageBase64.startsWith('data:image/jpeg') || imageBase64.startsWith('data:image/jpg')) ext = 'jpg';

            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const fileName = `routemap-${Date.now()}.${ext}`;
            const targetFilePath = path.join(uploadDir, fileName);

            // Clean up previous image
            if (routeMap.mapImage && routeMap.mapImage.startsWith('/uploads/routemap/')) {
                const oldFilePath = path.join(__dirname, '../public', routeMap.mapImage);
                if (fs.existsSync(oldFilePath)) {
                    try { fs.unlinkSync(oldFilePath); } catch (e) { /* ignore */ }
                }
            }

            await fs.promises.writeFile(targetFilePath, buffer);
            const savedPath = `/uploads/routemap/${fileName}`;
            routeMap.mapImage = savedPath;
            routeMap.mapImages = [savedPath];
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
        if (!Array.isArray(formatted.mapImages) || formatted.mapImages.length === 0) {
            formatted.mapImages = formatted.mapImage ? [formatted.mapImage] : [];
        }
        formatted.fullImageUrl = formatImageUrl(req, formatted.mapImage);
        formatted.fullImageUrls = formatted.mapImages.map(img => formatImageUrl(req, img));

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
            const allImages = [...(routeMap.mapImages || []), routeMap.mapImage].filter(Boolean);
            for (const img of allImages) {
                if (img.startsWith('/uploads/routemap/')) {
                    const oldFilePath = path.join(__dirname, '../public', img);
                    if (fs.existsSync(oldFilePath)) {
                        try { fs.unlinkSync(oldFilePath); } catch (e) { /* ignore */ }
                    }
                }
            }
            routeMap.mapImage = '';
            routeMap.mapImages = [];
            await routeMap.save();
        }

        try {
            require('../socket').getIO().emit('routeMapUpdated');
        } catch (socketErr) {
            console.error('Socket error:', socketErr);
        }

        res.status(200).json({ message: 'Route map images deleted successfully' });
    } catch (error) {
        console.error('Error deleting route map:', error);
        res.status(500).json({ message: 'Failed to delete route map', error: error.message });
    }
});

module.exports = router;
