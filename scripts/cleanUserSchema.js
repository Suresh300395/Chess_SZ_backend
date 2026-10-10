const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function clean() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected for cleanup.');

        const db = mongoose.connection.db;
        const result = await db.collection('users').updateMany({}, {
            $unset: {
                accommodation: '',
                foodTokens: '',
                cautionDeposit: ''
            }
        });

        console.log('Modified documents count:', result.modifiedCount);

        const sample = await db.collection('users').findOne({ role: 'player' });
        console.log('Cleaned user document sample:', JSON.stringify(sample, null, 2));

        await mongoose.disconnect();
        console.log('Cleanup completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error during cleanup:', err);
        process.exit(1);
    }
}

clean();
