import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { APP_NAME } from '@bitsomeggle/shared';

/**
 * Creates the HTTP server. For now it only answers GET /health, which hosting
 * platforms (and our pre-opening wake-up ping) call to check the server is alive.
 * Socket.IO will attach to this same server in Milestone M2.
 */
export function createHttpServer(): Server {
  return createServer(handleRequest);
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok', app: APP_NAME });
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
