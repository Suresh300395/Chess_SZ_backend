var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const connectDB = require('./config/dbconnect')
const cors = require('cors')
const authRoutes = require('./routes/auth');
const authController = require('./controllers/authController');

var app = express();
connectDB().then(() => {
    // Seed admin once DB is connected
    authController.seedAdmin();
});

app.use(cors())
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);

module.exports = app;
