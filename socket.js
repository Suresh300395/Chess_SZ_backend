const { Server } = require("socket.io");
let io;

const configuredOrigins = [
    process.env.FRONTEND_URL,
    process.env.ALLOWED_ORIGINS,
    process.env.CORS_ORIGIN
]
    .filter(Boolean)
    .flatMap(item => item.split(',').map(s => s.trim()))
    .filter(Boolean);

const defaultOrigins = [
    'http://localhost:3331',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://127.0.0.1:3331',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:3000'
];

const allowedOrigins = Array.from(new Set([...configuredOrigins, ...defaultOrigins]));

const isOriginAllowed = (origin) => {
    if (!origin) return true;
    if (allowedOrigins.includes('*') || process.env.CORS_ALLOW_ALL === 'true') return true;
    if (allowedOrigins.includes(origin)) return true;
    const normalized = origin.replace(/\/+$/, '');
    if (allowedOrigins.some(o => o.replace(/\/+$/, '') === normalized)) return true;
    if (process.env.STRICT_CORS !== 'true') return true;
    return false;
};

module.exports = {
    init: (httpServer) => {
        io = new Server(httpServer, {
            cors: {
                origin: (origin, callback) => {
                    if (isOriginAllowed(origin)) {
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
