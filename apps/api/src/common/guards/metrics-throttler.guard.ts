import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { httpRequestsTotal } from '../../metrics/metrics';

function getRoute(req: Record<string, unknown>): string {
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const routePath =
    typeof req.path === 'string'
      ? req.path
      : typeof req.originalUrl === 'string'
        ? req.originalUrl
        : 'unknown';
  const route = `${base}${routePath}`;
  return route === '' ? '/' : route;
}

@Injectable()
export class MetricsThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<Record<string, unknown> | undefined>();
    if (req) {
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'UNKNOWN';
      const route = getRoute(req);
      httpRequestsTotal.labels(method, route, '429').inc(1);
    }

    await super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
