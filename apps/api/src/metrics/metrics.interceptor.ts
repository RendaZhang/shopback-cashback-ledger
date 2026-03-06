import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { httpRequestDurationSeconds, httpRequestsTotal } from './metrics';

type MetricsReq = {
  baseUrl?: string;
  route?: { path?: string };
  path?: string;
  method?: string;
};

type MetricsRes = {
  statusCode?: number;
};

function getRoute(req: MetricsReq): string {
  // prefer templated route, fallback to path
  const base = req.baseUrl ?? '';
  const routePath = req.route?.path ?? req.path ?? 'unknown';
  const r = `${base}${routePath}`;
  return r === '' ? '/' : r;
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<MetricsReq>();
    const res = http.getResponse<MetricsRes>();

    // avoid counting metrics endpoint itself (and any non-http context)
    if (!req || !res || req.path === '/metrics') return next.handle();

    const start = process.hrtime.bigint();
    const method = String(req.method ?? 'UNKNOWN').toUpperCase();

    return next.handle().pipe(
      finalize(() => {
        const end = process.hrtime.bigint();
        const seconds = Number(end - start) / 1e9;
        const route = getRoute(req);
        const status = String(res.statusCode ?? 0);

        httpRequestsTotal.labels(method, route, status).inc(1);
        httpRequestDurationSeconds.labels(method, route).observe(seconds);
      }),
    );
  }
}
