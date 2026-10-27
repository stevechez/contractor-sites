import { randomUUID } from "node:crypto";
import { intakeSchema, validationErrors } from "../../../lib/schemas";
import { airtableConfigured, createAirtableLead } from "../../../lib/airtable";
import { notifyDirectLead } from "../../../lib/notifications";
import type { IntakeResponse, LeadCreatedEvent } from "../../../types/intake";

// Node.js is the default runtime; cacheComponents disallows a runtime override.
export const maxDuration = 30;
const MAX_BODY_BYTES = 8192;

function json(body: IntakeResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function POST(request: Request) {
  // Reject cross-origin browser submissions without breaking server-to-server clients.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ success: false, error: "Cross-origin submission is not allowed." }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ success: false, error: "Content-Type must be application/json." }, 415);
  }
  let body: unknown;
  try { body = await readBody(request); }
  catch (error) {
    return json({ success: false, error: error instanceof RangeError ? "Request body is too large." : "Invalid JSON body." }, error instanceof RangeError ? 413 : 400);
  }
  const parsed = intakeSchema.safeParse(body);
  if (!parsed.success) return json({ success: false, error: "Please correct the highlighted fields.", errors: validationErrors(parsed.error) }, 400);

  const { MAKE_WEBHOOK_URL, MAKE_WEBHOOK_SECRET } = process.env;
  let webhookUrl: URL | undefined;
  if (MAKE_WEBHOOK_URL && MAKE_WEBHOOK_SECRET) {
    try {
      const url = new URL(MAKE_WEBHOOK_URL);
      if (url.protocol === "https:" && !url.username && !url.password) webhookUrl = url;
    } catch { /* An invalid primary configuration may still use the fallback. */ }
  }
  if (!webhookUrl && !airtableConfigured()) {
    // Log configuration state only, never credentials or the private webhook URL.
    console.error("intake.configuration_missing", {
      makeWebhookUrlConfigured: Boolean(MAKE_WEBHOOK_URL),
      makeWebhookSecretConfigured: Boolean(MAKE_WEBHOOK_SECRET),
      makeWebhookUrlValid: Boolean(webhookUrl),
      airtableApiKeyConfigured: Boolean(process.env.AIRTABLE_API_KEY),
      airtableBaseIdConfigured: Boolean(process.env.AIRTABLE_BASE_ID),
    });
    return json({ success: false, error: "Online requests are temporarily unavailable. Please call us." }, 503);
  }

  const timestamp = new Date().toISOString();
  const requestId = randomUUID();
  const event: LeadCreatedEvent = { event: "lead.created", data: { ...parsed.data, submittedAt: timestamp } };
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-make-apikey": MAKE_WEBHOOK_SECRET!, "X-Lead-Id": requestId },
        body: JSON.stringify(event), signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error",
      });
      if (!response.ok) throw new Error("Webhook rejected lead");
      // Make may return plain-text 'Accepted'. This ID is a correlation ID,
      // not an Airtable record ID, and acceptance does not assert SMS delivery.
      return json({ success: true, timestamp, leadId: requestId }, 200);
    } catch {
      console.error("intake.webhook_failed", { leadId: requestId });
    }
  }
  if (airtableConfigured()) {
    try {
      const leadId = await createAirtableLead(event);
      // Await notifications so serverless shutdown cannot silently discard them.
      // Once stored, never report a lead failure merely because SMS failed.
      await notifyDirectLead(event, leadId);
      return json({ success: true, timestamp, leadId }, 200);
    } catch {
      console.error("intake.airtable_failed", { leadId: requestId });
    }
  }
  return json({ success: false, error: "We could not confirm your request. Please call us for immediate help." }, 502);
}
