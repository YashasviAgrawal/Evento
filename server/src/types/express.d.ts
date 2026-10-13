import type { AuthenticatedUser } from '../middleware/auth';
import type { CmsUser } from '../modules/cms/cms.service';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `authenticate` middleware. */
      user?: AuthenticatedUser;
      /**
       * Populated by the `authenticateCms` middleware. Separate from `user`:
       * a CMS account is not a platform account, and neither implies the other.
       */
      cmsUser?: CmsUser;
      /** Raw request body, captured only for the Razorpay webhook route. */
      rawBody?: Buffer;
    }
  }
}

export {};
