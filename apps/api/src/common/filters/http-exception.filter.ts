import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, ErrorCodes } from '../errors/error-codes';

type RequestWithId = Request & {
  requestId?: string;
};

type HttpExceptionResponse = {
  message?: string | string[];
};

@Catch()
export class HttpExceptionToApiResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();

    const requestId = req.requestId ?? req.header('x-request-id') ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCodes.INTERNAL;
    let message = 'Internal server error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as HttpExceptionResponse | string;
      const responseMessage = typeof resp === 'string' ? resp : resp.message;
      const normalizedMessage = Array.isArray(responseMessage) ? responseMessage.join('; ') : responseMessage;

      // ValidationPipe default shape: { message: string[]; error: string; statusCode: number }
      if (status === HttpStatus.BAD_REQUEST) {
        code = ErrorCodes.VALIDATION;
        message = 'Validation failed';
        details = responseMessage ?? resp;
      } else if (status === HttpStatus.NOT_FOUND) {
        code = ErrorCodes.NOT_FOUND;
        message = normalizedMessage ?? 'Not found';
      } else if (status === HttpStatus.CONFLICT) {
        code = ErrorCodes.CONFLICT;
        message = normalizedMessage ?? 'Conflict';
      } else {
        message = normalizedMessage ?? exception.message ?? message;
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
