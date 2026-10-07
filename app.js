var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const connectDB = require('./config/dbconnect')
const cors = require('cors')
const authRoutes = require('./routes/auth');
const registrationRoutes = require('./routes/registration');
const committeeRoutes = require('./routes/committee');
const authController = require('./controllers/authController');

var app = express();
connectDB().then(() => {
    // Seed admin once DB is connected
    authController.seedAdmin();
});

app.use(cors())
app.use(logger('dev'));
app.use(express.json()); // Add limit to handle base64 images
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/registration', registrationRoutes);
app.use('/api/committee', committeeRoutes);

module.exports = app;
