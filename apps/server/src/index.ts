import { loadConfig } from './config.ts';
import { createHttpServer } from './http.ts';

const config = loadConfig();
const server = createHttpServer();

server.listen(config.port, () => {
  console.log(`Bitsomeggle server listening on port ${config.port}`);
});

// On Ctrl+C locally, or when the host stops the service, close cleanly.
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
