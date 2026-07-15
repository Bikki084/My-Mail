import { z } from "zod";
import { emailField, loginPasswordField, newPasswordField } from "@/lib/validation/fields";

export const adminForgotPasswordBodySchema = z.object({
  email: emailField,
});

export const adminResetPasswordBodySchema = z
  .object({
    token: z.string().min(1, "Token is required.").max(512, "Token is invalid."),
    password: newPasswordField,
    confirmPassword: newPasswordField,
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const adminResetVerifyQuerySchema = z.object({
  token: z.string().trim().min(1, "Token is required.").max(512, "Token is invalid."),
});
