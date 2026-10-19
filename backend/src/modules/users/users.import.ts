import { parseString } from 'fast-csv';
import { z } from 'zod';
import { ROLES } from '../../config/roles';
import { AppError } from '../../lib/appError';
import { emailField, personNameField } from '../auth/auth.validation';
import { studentNumberField } from './users.validation';

export const MAX_IMPORT_ROWS = 500;

// Column names are matched case-insensitively and a few common spellings are accepted.
const HEADER_ALIASES: Record<string, string> = {
  email: 'email',
  'e-mail': 'email',
  'email address': 'email',
  firstname: 'firstName',
  'first name': 'firstName',
  first_name: 'firstName',
  'given name': 'firstName',
  lastname: 'lastName',
  'last name': 'lastName',
  last_name: 'lastName',
  surname: 'lastName',
  'family name': 'lastName',
  role: 'role',
  studentnumber: 'studentNumber',
  'student number': 'studentNumber',
  student_number: 'studentNumber',
  studentid: 'studentNumber',
  'student id': 'studentNumber',
};

const canonicalHeader = (header: string): string | undefined => HEADER_ALIASES[header.trim().toLowerCase()];

const REQUIRED_COLUMNS = ['email', 'firstName', 'lastName'] as const;

const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

export const importRowSchema = z.object({
  email: emailField,
  firstName: personNameField,
  lastName: personNameField,
  role: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : undefined,
    z.enum(ROLES).default('STUDENT'),
  ),
  studentNumber: z.preprocess(blankToUndefined, studentNumberField.optional()),
});

export type ImportRow = z.infer<typeof importRowSchema>;

// Excel in many regions saves CSV with semicolons (and a BOM), so the delimiter is detected.
function detectDelimiter(headerLine: string): string {
  if (headerLine.includes(',')) return ',';
  if (headerLine.includes(';')) return ';';
  if (headerLine.includes('\t')) return '\t';
  return ',';
}

export async function parseCsv(buffer: Buffer): Promise<Record<string, string>[]> {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const headerLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(headerLine);

  const found = new Set(headerLine.split(delimiter).map(canonicalHeader));
  const missing = REQUIRED_COLUMNS.filter((column) => !found.has(column));
  if (missing.length > 0) {
    throw AppError.badRequest(
      `The CSV is missing required columns: ${missing.join(', ')}. Expected: email, firstName, lastName (optional: role, studentNumber).`,
    );
  }

  const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
    const collected: Record<string, string>[] = [];
    parseString(text, {
      headers: (headers) => headers.map((header) => canonicalHeader(header ?? '')),
      delimiter,
      ignoreEmpty: true,
      trim: true,
      // One more than the limit, so an oversized file can be detected.
      maxRows: MAX_IMPORT_ROWS + 1,
    })
      .on('error', (error) => reject(AppError.badRequest(`The CSV could not be read: ${error.message}`)))
      .on('data', (row: Record<string, string>) => collected.push(row))
      .on('end', () => resolve(collected));
  });

  if (rows.length === 0) {
    throw AppError.badRequest('The CSV has no data rows');
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw AppError.badRequest(`A single import can contain at most ${MAX_IMPORT_ROWS} rows`);
  }
  return rows;
}