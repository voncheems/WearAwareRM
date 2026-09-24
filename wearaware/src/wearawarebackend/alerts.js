const { WebSocketServer, WebSocket } = require('ws');
const { authenticateToken } = require('./middleware');
const { allowedOrigins } = require('./security');
function createAlerts(server, app) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  // Authenticate with the first message rather than putting credentials in URLs.
  server.on('upgrade', (req, socket, head) => {
    const trusted = app?.get('trust proxy fn')?.(req.socket.remoteAddress, 0);
    const secure = req.socket.encrypted || (trusted && req.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https');
    if ((process.env.NODE_ENV === 'production' && !secure) || req.url !== '/alerts' || (req.headers.origin && !allowedOrigins().includes(req.headers.origin))) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    const timer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    timer.unref();
    ws.once('close', () => clearTimeout(timer));
    ws.once('message', async raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'authenticate' || typeof message.token !== 'string') throw new Error();
        const user = await authenticateToken(message.token);
        if (user.role !== 'inspector') throw new Error();
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.token = message.token; ws.userId = user.id;
        clearTimeout(timer); ws.send(JSON.stringify({ type: 'authenticated' }));
      } catch { ws.close(1008, 'Authentication failed'); }
    });
  });
  wss.broadcastToInspector = async (inspectorId, payload) => {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN || ws.userId !== inspectorId) continue;
      try {
        const user = await authenticateToken(ws.token);
        if (user.role !== 'inspector' || user.id !== inspectorId) throw new Error();
        ws.send(JSON.stringify(payload));
      } catch { ws.close(1008, 'Session expired'); }
    }
  };
  return wss;
}
module.exports = { createAlerts };
