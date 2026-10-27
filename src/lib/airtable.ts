import type { LeadCreatedEvent, IntakeLead } from "../types/intake";

const serviceMapping: Record<IntakeLead["serviceType"], string> = {
  "Emergency Repair": "Emergency",
  "Standard Service": "Repair",
  "System Installation": "Installation",
  Inspection: "Inspection",
};

export function airtableConfigured() {
  return Boolean(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID);
}

export async function createAirtableLead(event: LeadCreatedEvent): Promise<string> {
  const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME = "Leads" } = process.env;
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) throw new Error("Airtable is not configured");
  const lead = event.data;
  const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: {
      "Lead Name": lead.name,
      "Phone Number": lead.phone,
      "Service Requested": serviceMapping[lead.serviceType],
      "City / ZIP": lead.addressOrCity ?? "",
      Status: "New",
      "Notes / Details": lead.description ?? "",
      Source: lead.source,
      // Created At is an Airtable computed field; do not write it.
    } }], typecast: true }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Airtable dispatch failed");
  const result = await response.json();
  const id: unknown = result?.records?.[0]?.id;
  if (typeof id !== "string" || !id.startsWith("rec")) throw new Error("Invalid Airtable response");
  return id;
}
