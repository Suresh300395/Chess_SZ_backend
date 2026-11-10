require('dotenv').config(); // Load .env FIRST before any other imports
var express = require('express');

var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const connectDB = require('./config/dbconnect');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const registrationRoutes = require('./routes/registration');
const committeeRoutes = require('./routes/committee');
const blocksRoutes = require('./routes/blocks');
const foodTokenRoutes = require('./routes/foodTokens');
const routeMapRoutes = require('./routes/routeMap');
const liveBoardRoutes = require('./routes/liveBoard');
const universityRoutes = require('./routes/universityMaster');
const helmet = require('helmet');
const authController = require('./controllers/authController');

var app = express();
app.disable('x-powered-by');

// Security headers with Helmet
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));

connectDB().then(() => {
    authController.seedAdmin();
    const blockController = require('./controllers/blockController');
    if (typeof blockController.initCategories === 'function') {
        blockController.initCategories();
    }
    // Auto-remove deprecated mapImage field from RouteMap collection
    const RouteMap = require('./models/RouteMap');
    RouteMap.updateMany({ mapImage: { $exists: true } }, { $unset: { mapImage: 1 } }).catch(err => {
        console.error('Error cleaning up mapImage from DB:', err.message);
    });

    // Auto-remove empty / unused fields from University collection
    const University = require('./models/University');
    University.updateMany({}, {
        $unset: {
            shortCode: 1,
            aliases: 1,
            normalizedAliases: 1,
            state: 1,
            city: 1,
            contactPerson: 1,
            email: 1,
            notes: 1
        }
    }).catch(err => {
        console.error('Error cleaning up empty fields from University DB:', err.message);
    });
});

// Secure CORS - only allow frontend origin
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(logger('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/registration', registrationRoutes);
app.use('/api/committee', committeeRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/food-tokens', foodTokenRoutes);
app.use('/api/route-map', routeMapRoutes);
app.use('/api/live-board', liveBoardRoutes);
app.use('/api/universities', universityRoutes);

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        message: err.message || 'Internal server error'
    });
});

module.exports = app;
