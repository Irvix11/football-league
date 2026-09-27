import server from '../server.js';

// Vercel's Node runtime supports WebSocket upgrades on Fluid Compute.
// server.ts owns the Express app and ws WebSocketServer; this file exposes the
// same HTTP server at the /api/ws function route without starting a listener.
export default server;
