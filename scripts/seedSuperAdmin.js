const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

const SUPERADMIN_USERNAME = 'superadmin';
const SUPERADMIN_PASSWORD = 'Pngs@3003';

async function seedSuperAdmin() {
    console.log('🚀 Running one-time Superadmin build provisioning...');
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
        console.warn('⚠️ [BUILD SEED] MONGO_URI is not defined in environment. Skipping DB seed during build.');
        process.exit(0);
    }

    try {
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000
        });
        console.log('📦 Connected to MongoDB successfully.');

        let admin = await Admin.findOne({ username: SUPERADMIN_USERNAME });

        if (!admin) {
            await Admin.create({
                username: SUPERADMIN_USERNAME,
                password: SUPERADMIN_PASSWORD,
                role: 'superadmin',
                name: 'Super Administrator'
            });
            console.log(`✅ [BUILD SEED] Superadmin '${SUPERADMIN_USERNAME}' created successfully.`);
        } else {
            const isMatch = await admin.comparePassword(SUPERADMIN_PASSWORD);
            if (!isMatch || admin.role !== 'superadmin') {
                admin.password = SUPERADMIN_PASSWORD; // Automatically hashed by bcrypt pre('save')
                admin.role = 'superadmin';
                await admin.save();
                console.log(`✅ [BUILD SEED] Superadmin '${SUPERADMIN_USERNAME}' password and role updated successfully.`);
            } else {
                console.log(`ℹ️ [BUILD SEED] Superadmin '${SUPERADMIN_USERNAME}' is already provisioned and up to date.`);
            }
        }

        await mongoose.disconnect();
        console.log('🔒 Database connection closed. Build seed complete.');
        process.exit(0);
    } catch (err) {
        console.warn(`⚠️ [BUILD SEED] Note during DB build seed: ${err.message}`);
        console.log('ℹ️ Build will continue smoothly.');
        try { await mongoose.disconnect(); } catch (_) {}
        process.exit(0);
    }
}

seedSuperAdmin();
