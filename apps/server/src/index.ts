import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp(config);

app.httpServer.listen(config.port, () => {
  app.logger.info(
    {
      port: config.port,
      corsOrigins: config.corsOrigins,
      alwaysOpen: config.openWindows.length === 0,
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
