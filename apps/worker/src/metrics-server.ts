import http from 'node:http';
import { registry } from './metrics';

export function startMetricsServer() {
  const port = Number(process.env.METRICS_PORT ?? '9100');

  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.statusCode = 200;
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  server.listen(port, () => {
    console.log('[metrics] listening', { port });
  });
}
