import { z } from 'zod';
import { HttpError } from './util';

/** A drawing sheet as sent by the web app after uploading its file. */
export const sheetSchema = z.object({
  number: z.string().trim().min(1, 'Enter the sheet number, e.g. A-101.').max(24, 'Keep the sheet number under 24 characters.'),
  title: z.string().trim().min(1, 'Enter a sheet title, e.g. Level 03 plan.').max(80, 'Keep the sheet title under 80 characters.'),
  revision: z.string().trim().min(1, 'Enter the revision, e.g. A or P01.').max(8, 'Keep the revision under 8 characters.'),
  fileId: z.string().min(1, 'Add the drawing file.').max(40),
  thumbFileId: z.string().max(40).nullable().default(null),
});

const GENERIC = /^(String|Number|Array|Invalid|Expected|Required)/;

/** Validate a request body. Hand-written messages are shown as-is; zod's generic ones name the field. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new HttpError(400, 'invalid', GENERIC.test(i.message) ? `${i.path.join('.') || 'request'}: ${i.message}` : i.message);
  }
  return r.data;
}
