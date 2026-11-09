export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public campos?: Record<string, string>,
  ) {
    super(message);
  }
}
