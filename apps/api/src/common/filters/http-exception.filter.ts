import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, ErrorCodes } from '../errors/error-codes';

@Catch()
export class HttpExceptionToApiResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId = (req as any).requestId ?? req.header('x-request-id') ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCodes.INTERNAL;
    let message = 'Internal server error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as any;

      // ValidationPipe default shape: { message: string[]; error: string; statusCode: number }
      if (status === HttpStatus.BAD_REQUEST) {
        code = ErrorCodes.VALIDATION;
        message = 'Validation failed';
        details = resp?.message ?? resp;
      } else if (status === HttpStatus.NOT_FOUND) {
        code = ErrorCodes.NOT_FOUND;
        message = resp?.message ?? 'Not found';
      } else if (status === HttpStatus.CONFLICT) {
        code = ErrorCodes.CONFLICT;
        message = resp?.message ?? 'Conflict';
      } else {
        message = resp?.message ?? exception.message ?? message;
        details = resp;
      }
    }

    res.status(status).json({
      requestId,
      data: null,
      error: { code, message, details },
    });
  }
}
