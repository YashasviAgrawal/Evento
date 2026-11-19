import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authLimiter, otpLimiter } from '../../middleware/rateLimit';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import * as controller from './auth.controller';
import {
  changePasswordSchema,
  googleAuthSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  requestOtpSchema,
  updateProfileSchema,
  verifyOtpSchema,
} from './auth.schema';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);
router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
router.post('/google', authLimiter, validate({ body: googleAuthSchema }), controller.googleAuth);
router.post('/otp/request', otpLimiter, validate({ body: requestOtpSchema }), controller.requestOtp);
router.post('/otp/verify', authLimiter, validate({ body: verifyOtpSchema }), controller.verifyOtp);
// Phone sign-in for accounts that have a mobile number on file.
const phoneBody = z.object({ phone: z.string().trim().min(10).max(16) });
router.post('/phone/otp/request', otpLimiter, validate({ body: phoneBody }), controller.requestPhoneOtp);
router.post(
  '/phone/otp/verify',
  authLimiter,
  validate({ body: phoneBody.extend({ code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from the SMS') }) }),
  controller.verifyPhoneOtp,
);
router.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', controller.logout);

router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), controller.updateProfile);
router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), controller.changePassword);

export default router;
