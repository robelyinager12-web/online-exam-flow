import type { Request } from 'express';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

// Who is calling and from where, for the audit log.
export const requestContext = (req: Request): RequestContext => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent') ?? undefined,
});