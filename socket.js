const { Server } = require("socket.io");
let io;

const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
];

module.exports = {
    init: (httpServer) => {
        io = new Server(httpServer, {
            cors: {
                origin: (origin, callback) => {
                    if (!origin) return callback(null, true);
                    if (allowedOrigins.includes(origin)) {
                        return callback(null, true);
                    }
                    callback(new Error('Origin not allowed by Socket.io CORS'));
                },
                methods: ["GET", "POST"],
                credentials: true
            }
        });

        io.on("connection", (socket) => {
            // Block unauthorized client-emitted broadcast events
            const serverBroadcastEvents = [
                'committeeUpdated',
                'liveBoardUpdated',
                'routeMapUpdated',
                'accommodation_guidelines_updated',
                'dataUpdated',
                'foodTokenUpdated'
            ];

            serverBroadcastEvents.forEach((event) => {
                socket.on(event, () => {
                    console.warn(`[SECURITY WARNING] Blocked unauthorized client emission of server event: ${event} from socket: ${socket.id}`);
                });
            });
        });

        return io;
    },
    getIO: () => {
        if (!io) {
            throw new Error("Socket.io not initialized!");
        }
        return io;
    }
};
