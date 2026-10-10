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
const authController = require('./controllers/authController');

var app = express();
connectDB().then(() => {
    authController.seedAdmin();
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(logger('dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: false }));
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

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        message: err.message || 'Internal server error'
    });
});

module.exports = app;
