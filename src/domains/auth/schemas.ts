import { z } from "zod";

const password = z
  .string()
  .min(10, "Use at least 10 characters.")
  .regex(/[a-zA-Z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

export const signInSchema = z.object({
  email: z.email("Enter a valid email address.").trim(),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export const signUpSchema = z
  .object({
    displayName: z.string().trim().min(2, "Enter your name.").max(100),
    email: z.email("Enter a valid email address.").trim(),
    password,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address.").trim(),
});

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string(), token: z.string().min(20).max(500) })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export function safeNextPath(
  value: string | null | undefined,
  fallback: string,
) {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return fallback;
  return value;
}
