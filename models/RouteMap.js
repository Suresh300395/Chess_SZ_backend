const mongoose = require('mongoose');

const routeMapSchema = new mongoose.Schema({
    title: {
        type: String,
        default: 'Aditya University Campus Route Map'
    },
    description: {
        type: String,
        default: ''
    },
    directions: {
        type: String,
        default: ''
    },
    mapImage: {
        type: String,
        default: '' // path or URL e.g. /uploads/routemap/routemap-xxx.jpg
    },
    updatedBy: {
        type: String,
        default: 'Super Admin'
    }
}, { timestamps: true });

module.exports = mongoose.model('RouteMap', routeMapSchema);
