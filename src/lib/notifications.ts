import { Resend } from "resend";
import type { LeadCreatedEvent, IntakeLead } from "../types/intake";

// Optional legacy SMS path; Resend does not require Twilio.
async function notifySms(event: LeadCreatedEvent, leadId: string) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_MESSAGING_SERVICE_SID, BUSINESS_OWNER_PHONE, BUSINESS_NAME = "ApexPro" } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || (!TWILIO_FROM_NUMBER && !TWILIO_MESSAGING_SERVICE_SID) || !BUSINESS_OWNER_PHONE) {
    return;
  }
  const lead = event.data;
  const messages = [
    { to: BUSINESS_OWNER_PHONE, body: `🚨 NEW LEAD ALERT: ${lead.name} needs ${lead.serviceType} in ${lead.addressOrCity || "your service area"}. Phone: ${lead.phone}. Tap to call immediately: tel:${lead.phone}` },
    { to: lead.phone, body: `Hi ${lead.name}, thank you for reaching out to ${BUSINESS_NAME}! We have received your request for ${lead.serviceType} and an on-call technician will review and call you shortly.` },
  ];
  const results = await Promise.allSettled(messages.map(async ({ to, body }) => {
    const fields = new URLSearchParams({ To: to, Body: body });
    if (TWILIO_MESSAGING_SERVICE_SID) fields.set("MessagingServiceSid", TWILIO_MESSAGING_SERVICE_SID);
    else fields.set("From", TWILIO_FROM_NUMBER!);
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: fields.toString(), signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error",
    });
    if (!response.ok) throw new Error("SMS dispatch failed");
  }));
  results.forEach((result, index) => {
    // Never log provider response bodies, credentials, names, or phone numbers.
    if (result.status === "rejected") console.error("intake.notification_failed", { leadId, recipient: index === 0 ? "owner" : "customer" });
  });
}


type LeadNotificationPayload = Pick<IntakeLead, "name" | "phone" | "serviceType" | "addressOrCity" | "description">;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export async function sendOwnerAlert(lead: LeadNotificationPayload, leadId?: string) {
  const { RESEND_API_KEY, CONTRACTOR_ALERT_EMAIL, RESEND_FROM_EMAIL = "ApexPro Leads <onboarding@resend.dev>" } = process.env;
  if (!RESEND_API_KEY || !CONTRACTOR_ALERT_EMAIL) {
    console.warn("intake.email_unconfigured", { leadId });
    return;
  }
  const name = escapeHtml(lead.name);
  const phone = escapeHtml(lead.phone);
  const callLink = `tel:${lead.phone.replace(/[^+0-9]/g, "")}`;
  const service = escapeHtml(lead.serviceType);
  const location = escapeHtml(lead.addressOrCity || "Not provided");
  const description = escapeHtml(lead.description || "None");
  try {
    // Instantiate at request time so configuration is not captured during build.
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: CONTRACTOR_ALERT_EMAIL,
      subject: `New lead: ${lead.name} (${lead.serviceType})`.replace(/[\r\n]/g, " "),
      text: `NEW JOB INQUIRY\nCustomer: ${lead.name}\nPhone: ${lead.phone}\nService: ${lead.serviceType}\nLocation: ${lead.addressOrCity || "Not provided"}\nDetails: ${lead.description || "None"}\nCall now: ${callLink}`,
      html: `<div style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:8px">
        <h2 style="color:#38bdf8;margin-top:0">New Job Inquiry Received</h2>
        <p><strong>Customer:</strong> ${name}</p>
        <p><strong>Phone:</strong> <a href="${callLink}" style="color:#4ade80;font-weight:bold">${phone} (Tap to Call)</a></p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Location:</strong> ${location}</p>
        <p style="white-space:pre-wrap"><strong>Details:</strong> ${description}</p>
        <a href="${callLink}" style="display:inline-block;margin-top:16px;background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Call Customer Now</a>
      </div>`,
    }, {
      signal: AbortSignal.timeout(8000),
      ...(leadId ? { idempotencyKey: `owner-alert/${leadId}` } : {}),
    });
    // The SDK returns API failures in `error`; they do not necessarily throw.
    if (error || !data?.id) {
      console.error("intake.email_failed", { leadId });
      return;
    }
    console.info("intake.email_accepted", { leadId, emailId: data.id });
  } catch {
    // Avoid logging provider errors which can contain recipients or credentials.
    console.error("intake.email_failed", { leadId });
  }
}

export async function notifyDirectLead(event: LeadCreatedEvent, leadId: string) {
  // Await both before the serverless response. SMS runs only if configured.
  await Promise.all([sendOwnerAlert(event.data, leadId), notifySms(event, leadId)]);
}
