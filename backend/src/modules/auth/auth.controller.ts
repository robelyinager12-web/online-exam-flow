import type { CookieOptions, Request, Response } from 'express';
import { authConfig } from '../../config/auth';
import { env, isProduction } from '../../config/env';
import { AppError } from '../../lib/appError';
import { asyncHandler } from '../../lib/asyncHandler';
import { changePassword as applyPasswordChange } from './auth.password';
import * as authService from './auth.service';
import type { RequestContext } from './auth.sessions';

const context = (req: Request): RequestContext => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent') ?? undefined,
});

const baseCookie: CookieOptions = {
  httpOnly: true, // JavaScript can never read the tokens, which protects them from XSS
  secure: isProduction || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  domain: env.COOKIE_DOMAIN,
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(authConfig.accessCookie, accessToken, {
    ...baseCookie,
    path: '/',
    maxAge: authConfig.accessTtlSeconds * 1000,
  });
  res.cookie(authConfig.refreshCookie, refreshToken, {
    ...baseCookie,
    path: authConfig.refreshCookiePath,
    maxAge: authConfig.refreshTtlSeconds * 1000,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(authConfig.accessCookie, { ...baseCookie, path: '/' });
  res.clearCookie(authConfig.refreshCookie, { ...baseCookie, path: authConfig.refreshCookiePath });
}

const message = (text: string) => ({ success: true, data: { message: text } });

export const register = asyncHandler(async (req, res) => {
  await authService.register(req.body, context(req));
  res.status(201).json(message('Registration received. Please check your email to verify your account.'));
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body, context(req));
  setAuthCookies(res, accessToken, refreshToken);
  res.status(200).json({
    success: true,
    data: { user, accessTokenExpiresInSeconds: authConfig.accessTtlSeconds },
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const raw: string | undefined = req.cookies?.[authConfig.refreshCookie];
  if (!raw) {
    throw AppError.unauthorized('No active session');
  }
  try {
    const { user, accessToken, refreshToken } = await authService.refresh(raw, context(req));
    setAuthCookies(res, accessToken, refreshToken);
    res.status(200).json({
      success: true,
      data: { user, accessTokenExpiresInSeconds: authConfig.accessTtlSeconds },
    });
  } catch (error) {
    // A rejected session must not keep sending its dead cookies. A conflict is only a race: keep them.
    if (error instanceof AppError && error.statusCode === 401 && error.code !== 'REFRESH_CONFLICT') {
      clearAuthCookies(res);
    }
    throw error;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.[authConfig.refreshCookie], context(req));
  clearAuthCookies(res);
  res.status(200).json(message('Signed out'));
});

export const me = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  const user = await authService.getProfile(req.user.id);
  res.status(200).json({ success: true, data: { user } });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.body.token, context(req));
  res.status(200).json(message('Email verified. You can now sign in.'));
});

// The next three answer identically whether or not the email exists.
export const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.body.email);
  res.status(200).json(message('If that account needs verification, a new link has been sent.'));
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  res.status(200).json(message('If an account with that email exists, a reset link has been sent.'));
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password, context(req));
  res.status(200).json(message('Password updated. Please sign in with your new password.'));
});

export const changePassword = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  await applyPasswordChange(
    {
      userId: req.user.id,
      sessionId: req.user.sessionId,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    },
    context(req),
  );
  res.status(200).json(message('Password changed. Your other devices have been signed out.'));
});