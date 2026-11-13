import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import next from 'next';
import { getRoomStore } from './src/server/roomStore';
import { setupWebSocketServer } from './src/server/wsHandler';

// Load local env files before evaluating PORT/HOST (existing process.env values take precedence)
if (typeof process.loadEnvFile === 'function') {
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.resolve(process.cwd(), filename);
    if (existsSync(filePath)) {
      process.loadEnvFile(filePath);
    }
  }
}

const port = parseInt(process.env.PORT || '3000', 10);
const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || (dev ? 'localhost' : '0.0.0.0');

// Ensure singleton RoomStore is initialized before Next.js handlers load
getRoomStore();

const httpServer = createServer();
const app = next({ dev, hostname, port, httpServer });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const wss = setupWebSocketServer(httpServer);

  httpServer.on('request', (req, res) => {
    handle(req, res);
  });

  httpServer.listen(port, hostname, () => {
    console.log(
      `> 8 Ball Pool server listening at http://${hostname}:${port} (${dev ? 'dev' : 'prod'})`
    );
  });

  const shutdown = (signal: string) => {
    console.log(`> Received ${signal}, shutting down gracefully...`);
    wss.close();
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
});
