import { createServer } from 'node:http';
import next from 'next';
import { getRoomStore } from './src/server/roomStore';
import { setupWebSocketServer } from './src/server/wsHandler';

const port = parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.HOST || 'localhost';
const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production';

// Ensure singleton RoomStore is initialized before Next.js handlers load
getRoomStore();

const httpServer = createServer();
const app = next({ dev, hostname, port, httpServer });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  setupWebSocketServer(httpServer);

  httpServer.on('request', (req, res) => {
    handle(req, res);
  });

  const onListening = () => {
    console.log(`> 8 Ball Pool server listening at http://${hostname}:${port} (${dev ? 'dev' : 'prod'})`);
  };

  if (process.env.HOST) {
    httpServer.listen(port, process.env.HOST, onListening);
  } else {
    httpServer.listen(port, onListening);
  }
});
