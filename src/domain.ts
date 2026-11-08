import { z } from "zod";

export const eventId = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/);
export const captureSchema = z
  .object({
    eventId,
    sourceText: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((s) => s.split(/\s+/).length <= 80),
    translatedText: z.string().trim().min(1).max(2000),
    sourceLanguage: z.literal("en"),
    targetLanguage: z.literal("vi"),
    capturedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type Capture = z.infer<typeof captureSchema>;
export const cardSchema = z
  .object({
    id: z.string().min(1).max(128),
    normalized: z.string().min(1).max(500),
    source: z.string().min(1).max(500),
    translation: z.string().min(1).max(2000),
    status: z.enum(["active", "suspended", "deleted"]),
    step: z.number().int().min(0).max(5),
    due: z.number().int().nonnegative(),
    introduced: z.number().int().nonnegative().nullable(),
    version: z.number().int().nonnegative(),
    lookups: z.number().int().positive(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
  })
  .strict();
export type Card = z.infer<typeof cardSchema>;
export const reviewSchema = z
  .object({
    eventId,
    cardId: z.string().min(1).max(128),
    version: z.number().int().nonnegative(),
    grade: z.enum(["remembered", "forgot"]),
  })
  .strict();
export const reviewEventSchema = z
  .object({
    id: eventId,
    card_id: z.string(),
    grade: z.enum(["remembered", "forgot"]),
    at: z.number().int().nonnegative(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    was_new: z.number().int().min(0).max(1),
    before_step: z.number().int().min(0).max(5),
    after_step: z.number().int().min(0).max(5),
    due: z.number().int().nonnegative(),
  })
  .strict();
export const backupSchema = z
  .object({
    format: z.literal("lookup-vocab/1"),
    dailyLimit: z.number().int().min(0).max(100),
    cards: z.array(cardSchema).max(50000),
    reviews: z.array(reviewEventSchema).max(200000),
    captures: z
      .array(
        z
          .object({
            id: eventId,
            payload: z.string(),
            at: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(200000),
  })
  .strict();
// NFC and whitespace only: preserve case and punctuation (US != us).
export function normalize(source: string) {
  return source.normalize("NFC").trim().replace(/\s+/gu, " ");
}
export function localDay(at: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
const intervals = [1, 3, 7, 14, 30];
export function schedule(
  step: number,
  grade: "remembered" | "forgot",
  now: number,
) {
  return grade === "forgot"
    ? { step: 0, due: now + 600000 }
    : {
        step: Math.min(step + 1, 5),
        due: now + intervals[Math.min(step, 4)] * 86400000,
      };
}
