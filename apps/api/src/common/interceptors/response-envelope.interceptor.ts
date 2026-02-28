import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import type { ApiResponse } from '../contracts/api-response';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<unknown>> {
    const req = ctx.switchToHttp().getRequest();
    const requestId: string = req.requestId ?? req.header?.('x-request-id') ?? 'unknown';

    return next.handle().pipe(
      map((data) => ({
        requestId,
        data: data ?? null,
        error: null,
      })),
    );
  }
}
