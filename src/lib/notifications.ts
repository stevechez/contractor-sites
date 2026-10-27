import type { LeadCreatedEvent } from "../types/intake";

// Used only for the direct Airtable path. Make owns SMS for webhook-accepted leads.
export async function notifyDirectLead(event: LeadCreatedEvent, leadId: string) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_MESSAGING_SERVICE_SID, BUSINESS_OWNER_PHONE, BUSINESS_NAME = "ApexPro" } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || (!TWILIO_FROM_NUMBER && !TWILIO_MESSAGING_SERVICE_SID) || !BUSINESS_OWNER_PHONE) {
    console.error("intake.notification_unconfigured", { leadId });
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
