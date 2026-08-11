import type { AuthenticatedUser } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `authenticate` middleware. */
      user?: AuthenticatedUser;
      /** Raw request body, captured only for the Razorpay webhook route. */
      rawBody?: Buffer;
    }
  }
}

export {};
