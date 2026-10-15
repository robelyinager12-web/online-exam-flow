import { createHash, randomBytes } from 'crypto';

// Random URL-safe token (256 bits by default). Only its hash is stored in the database.
export const generateToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');