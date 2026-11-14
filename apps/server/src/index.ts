import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp(config);

if (config.turn === null) {
  app.logger.warn(
    'TURN_KEY_ID / TURN_KEY_API_TOKEN are not set: calls have no relay and will fail between some networks',
  );
}

// Get the first TURN credentials before accepting visitors, so the very first pair
// already has a relay. This gives up by itself after a few seconds and never throws.
await app.iceServers.start();

app.httpServer.listen(config.port, () => {
  app.logger.info(
    {
      port: config.port,
      corsOrigins: config.corsOrigins,
      alwaysOpen: config.openWindows.length === 0,
      turnRelay: config.turn !== null,
      perIpCap: config.maxClientsPerIp,
    },
    'Bitsomeggle server listening',
  );
});

// On Ctrl+C locally, or when the host stops the service, close cleanly.
function shutdown(signal: string): void {
  app.logger.info({ signal }, 'shutting down');
  app.close().then(
    () => process.exit(0),
    (error: unknown) => {
      app.logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    },
  );
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
