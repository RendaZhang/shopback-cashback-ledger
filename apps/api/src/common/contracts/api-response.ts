export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResponse<T> = {
  requestId: string;
  data: T | null;
  error: ApiError | null;
};
