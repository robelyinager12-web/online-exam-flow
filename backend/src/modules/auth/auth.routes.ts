import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { accountActionLimiter, authLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validate';
import * as controller from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.validation';

export const authRouter = Router();

authRouter.post('/register', accountActionLimiter, validate({ body: registerSchema }), controller.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', authLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', authenticate, controller.me);

authRouter.post('/verify-email', authLimiter, validate({ body: verifyEmailSchema }), controller.verifyEmail);
authRouter.post(
  '/resend-verification',
  accountActionLimiter,
  validate({ body: resendVerificationSchema }),
  controller.resendVerification,
);
authRouter.post(
  '/forgot-password',
  accountActionLimiter,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
);
authRouter.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), controller.resetPassword);