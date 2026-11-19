import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { DriveNotConnectedError } from '../services/drive.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(422).json({ error: 'Validation failed', code: 'VALIDATION', details: err.issues });
    return;
  }
  if (err instanceof DriveNotConnectedError) {
    res.status(409).json({ error: err.message, code: 'DRIVE_NOT_CONNECTED' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
}
