import { z } from "zod";

export const serviceTypes = ["Emergency Repair", "Standard Service", "System Installation", "Inspection"] as const;
export const intakeSources = ["hero_form", "sticky_bar", "footer_form", "service_card"] as const;

// Require a complete US number; normalize punctuation and optional country code.
const usPhone = /^(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}$/;
export const intakeSchema = z.strictObject({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(100, "Use no more than 100 characters."),
  phone: z.string().trim().max(30).regex(usPhone, "Enter a complete US phone number.")
    .transform((value) => `+1${value.replace(/\D/g, "").slice(-10)}`),
  serviceType: z.enum(serviceTypes, { error: "Choose a service." }),
  addressOrCity: z.string().trim().max(200, "Use no more than 200 characters.").optional(),
  description: z.string().trim().max(500, "Use no more than 500 characters.").optional(),
  source: z.enum(intakeSources, { error: "Invalid form source." }),
});

export function validationErrors(error: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}
