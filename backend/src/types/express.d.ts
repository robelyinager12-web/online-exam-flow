import type { RoleName } from '../config/roles';

declare global {
  namespace Express {
    interface Request {
      // Set by the `authenticate` middleware.
      user?: {
        id: string;
        role: RoleName;
        institutionId: string | null;
        sessionId: string;
      };
    }
  }
}

export {};