export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          message: error.message,
          code: error.code,
          details: error.details,
        }
      }
    };
  }
  
  console.error('Unexpected error:', error);
  return {
    status: 500,
    body: {
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      }
    }
  };
};

export const asyncHandler = (fn: Function) => {
  return async (c: any, next: any) => {
    try {
      return await fn(c, next);
    } catch (error) {
      const { status, body } = errorResponse(error);
      return c.json(body, status);
    }
  };
};
