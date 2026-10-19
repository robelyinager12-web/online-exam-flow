import { z } from 'zod';

const timezoneField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'is not a valid timezone');

// Only these settings exist. Anything else is rejected, so nobody can store arbitrary data.
export const settingFields = {
  timezone: timezoneField,
  defaultPassMarkPercent: z.number().min(0).max(100),
  defaultExamDurationMinutes: z.number().int().min(5).max(600),
  defaultMaxAttempts: z.number().int().min(1).max(10),
  showCorrectAnswersByDefault: z.boolean(),
} as const;

export type SettingKey = keyof typeof settingFields;
export type Settings = { [K in SettingKey]: z.infer<(typeof settingFields)[K]> };

export const SETTING_DEFAULTS: Settings = {
  timezone: 'UTC',
  defaultPassMarkPercent: 50,
  defaultExamDurationMinutes: 60,
  defaultMaxAttempts: 1,
  showCorrectAnswersByDefault: false,
};

export const updateSettingsSchema = z
  .object(settingFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one setting to update' });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// Defaults first, then whatever is stored. A stored value that no longer passes validation is ignored.
export function mergeSettings(rows: { key: string; value: unknown }[]): Settings {
  const merged: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (row.key in settingFields) {
      const parsed = settingFields[row.key as SettingKey].safeParse(row.value);
      if (parsed.success) {
        merged[row.key] = parsed.data;
      }
    }
  }
  return merged as Settings;
}