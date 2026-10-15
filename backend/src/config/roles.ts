export const ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR', 'PROCTOR', 'STUDENT'] as const;

export type RoleName = (typeof ROLES)[number];