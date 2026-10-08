const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_this';

// Verify JWT token middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ message: 'Invalid or expired token.' });
    }
};

// Only allow admin or superadmin
const requireAdmin = (req, res, next) => {
    if (!req.user || !['admin', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    next();
};

// Only allow superadmin
const requireSuperAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied. Super admin role required.' });
    }
    next();
};

module.exports = { verifyToken, requireAdmin, requireSuperAdmin };
