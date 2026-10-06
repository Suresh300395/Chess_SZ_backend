const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(
            process.env.MONGO_URI
        );

    } catch (error) {
        console.error(`Database connection error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
