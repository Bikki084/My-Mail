import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.");

export const sendingLogsDateRangeSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    campaignId: z.string().uuid().optional(),
  })
  .refine((data) => data.from <= data.to, {
    message: "Start date must be on or before end date.",
    path: ["to"],
  });
