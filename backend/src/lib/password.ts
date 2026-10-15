import argon2 from 'argon2';

// Argon2id with the OWASP-recommended minimum parameters (19 MiB memory, 2 passes).
const options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, options);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash must never crash a login request; treat it as a failed match.
    return false;
  }
}