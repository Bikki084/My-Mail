import { z } from "zod";
import {
  smtpHostField,
  smtpLabelField,
  smtpPasswordField,
  smtpPortField,
  smtpUsernameField,
} from "@/lib/validation/fields";

export const smtpProviderSchema = z.enum(["gmail", "yahoo", "outlook", "custom"]);

export const smtpFormSchema = z.object({
  host: smtpHostField,
  port: smtpPortField,
  secure: z.boolean(),
  username: smtpUsernameField,
  password: smtpPasswordField,
  label: smtpLabelField.optional().nullable(),
  provider: smtpProviderSchema.optional().nullable(),
  rotationOrder: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .nullable(),
});

export type ValidatedSmtpInput = z.infer<typeof smtpFormSchema>;
