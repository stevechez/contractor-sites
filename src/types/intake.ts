import type { z } from "zod";
import type { intakeSchema } from "../lib/schemas";

export type IntakeInput = z.input<typeof intakeSchema>;
export type IntakeLead = z.output<typeof intakeSchema>;
export type IntakeSource = IntakeLead["source"];
export type IntakeErrors = Partial<Record<keyof IntakeInput | "_form", string[]>>;
export interface LeadCreatedEvent {
  event: "lead.created";
  data: IntakeLead & { submittedAt: string };
}
export type IntakeResponse =
  | { success: true; timestamp: string; leadId: string }
  | { success: false; error: string; errors?: IntakeErrors };
