import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authLimiter, otpLimiter } from '../../middleware/rateLimit';
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
router.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', controller.logout);

router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), controller.updateProfile);
router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), controller.changePassword);

export default router;
