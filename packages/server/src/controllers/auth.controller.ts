import type { Request, Response } from 'express';
import { AuthService, type SessionMetadata } from '../services/auth.service.js';
import logger from '../lib/logger.js';
import { setRefreshTokenCookie, clearRefreshTokenCookie, getRefreshTokenFromCookie } from '../lib/cookies.js';
import { isServiceError } from '../lib/service-error.js';

function sessionMetadata(req: Request): SessionMetadata {
  const userAgent = req.headers['user-agent'];
  const ipAddress = req.ip;
  const metadata: SessionMetadata = {};
  if (userAgent) { metadata.userAgent = userAgent; }
  if (ipAddress) { metadata.ipAddress = ipAddress; }
  return metadata;
}

export class AuthController {
  static async login(req: Request, res: Response): Promise<void> {
    const { username, password } = req.body as { username: string; password: string };

    const result = await AuthService.login(username, password, sessionMetadata(req));

    if (!result.ok) {
      logger.warn({ username, errMsg: result.error.message }, 'Login failed');

      if (isServiceError(result.error, 'ACCOUNT_LOCKED')) {
        const details = result.error.details;
        if (details?.['lockedNow']) {
          res.status(429).json({
            success: false,
            error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Account has been temporarily locked.' },
          });
        } else {
          res.status(429).json({
            success: false,
            error: { code: 'ACCOUNT_LOCKED', message: `Account is locked. Try again in ${String(details?.['minutesRemaining'])} minute(s).` },
          });
        }
        return;
      }

      if (isServiceError(result.error, 'INVALID_CREDENTIALS')) {
        res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
        return;
      }

      if (isServiceError(result.error, 'ACCOUNT_DEACTIVATED')) {
        res.status(403).json({ success: false, error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is deactivated' } });
        return;
      }

      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
      return;
    }

    logger.info({ userId: result.value.user.id }, 'User logged in');
    setRefreshTokenCookie(res, result.value.refreshToken);

    res.json({
      success: true,
      data: {
        user: result.value.user,
        accessToken: result.value.accessToken,
      },
    });
  }

  static async refresh(req: Request, res: Response): Promise<void> {
    const refreshToken = getRefreshTokenFromCookie(req.cookies as Record<string, string | undefined>);

    if (!refreshToken) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No refresh token provided' } });
      return;
    }

    const result = await AuthService.refreshSession(refreshToken, sessionMetadata(req));

    if (!result.ok) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
      return;
    }

    setRefreshTokenCookie(res, result.value.refreshToken);
    // The user rides along so the web replaces its permission list (#219).
    res.json({ success: true, data: { user: result.value.user, accessToken: result.value.accessToken } });
  }

  static async logout(req: Request, res: Response): Promise<void> {
    const sessionId = req.sessionId;

    if (sessionId) {
      const result = await AuthService.logout(sessionId, req.user?.id ?? null, req.ip ?? null);
      if (!result.ok) {
        logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Logout failed');
      }
    }

    clearRefreshTokenCookie(res);
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  }
}
