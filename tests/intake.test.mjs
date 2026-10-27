import { test, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Transpile the actual route and its dependencies for Node's built-in runner.
// No test-only copy of dispatch logic and no real network traffic.
const directory = await mkdtemp(join(tmpdir(), "intake-tests-"));
const modules = {
  schemas: "src/lib/schemas.ts",
  airtable: "src/lib/airtable.ts",
  notifications: "src/lib/notifications.ts",
  route: "src/app/api/intake/route.ts",
};
for (const [name, path] of Object.entries(modules)) {
  const source = await readFile(path, "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from "(?:\.\.\/)+lib\/(\w+)"/g, 'from "./$1.mjs"').replace('from "zod"', `from ${JSON.stringify(import.meta.resolve("zod"))}`).replace('from "resend"', `from ${JSON.stringify(import.meta.resolve("resend"))}`);
  await writeFile(join(directory, `${name}.mjs`), code);
}
const { POST } = await import(pathToFileURL(join(directory, "route.mjs")).href);
const { intakeSchema } = await import(pathToFileURL(join(directory, "schemas.mjs")).href);
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const envKeys = ["MAKE_WEBHOOK_URL", "MAKE_WEBHOOK_SECRET", "AIRTABLE_API_KEY", "AIRTABLE_BASE_ID", "AIRTABLE_TABLE_NAME", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID", "BUSINESS_OWNER_PHONE", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "CONTRACTOR_ALERT_EMAIL"];
beforeEach(() => { envKeys.forEach((key) => delete process.env[key]); });
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const lead = { name: " Jane Smith ", phone: "(831) 555-0192", serviceType: "Emergency Repair", addressOrCity: "Capitola, CA", description: "Drain backing up", source: "hero_form" };
function request(body = lead, headers = {}) {
  return new Request("https://example.com/api/intake", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function webhook() { process.env.MAKE_WEBHOOK_URL = "https://hook.us1.make.com/test"; process.env.MAKE_WEBHOOK_SECRET = "test-secret"; }
function airtable() { process.env.AIRTABLE_API_KEY = "test-pat"; process.env.AIRTABLE_BASE_ID = "appTest"; }
function twilio() { Object.assign(process.env, { TWILIO_ACCOUNT_SID: "ACTest", TWILIO_AUTH_TOKEN: "test-token", TWILIO_FROM_NUMBER: "+18005550199", BUSINESS_OWNER_PHONE: "+18005550198" }); }

test("schema trims names, normalizes US formats and rejects malformed fields", () => {
  for (const phone of ["(831) 555-0192", "+1 831-555-0192", "831.555.0192", "18315550192"]) {
    const parsed = intakeSchema.parse({ ...lead, phone });
    assert.equal(parsed.name, "Jane Smith"); assert.equal(parsed.phone, "+18315550192");
  }
  for (const update of [{ name: " " }, { phone: "555-0192" }, { phone: "+448315550192" }, { phone: "(8315550192" }, { serviceType: "unknown" }, { source: "unknown" }, { description: "x".repeat(501) }, { injected: true }]) {
    assert.equal(intakeSchema.safeParse({ ...lead, ...update }).success, false);
  }
});
test("validation failure has exact field map and does not dispatch", async () => {
  globalThis.fetch = () => assert.fail("Must not dispatch invalid data");
  const response = await POST(request({ ...lead, name: "x", phone: "bad" }));
  assert.equal(response.status, 400);
  assert.deepEqual((await response.json()).errors, { name: ["Enter at least 2 characters."], phone: ["Enter a complete US phone number."] });
});
test("malformed JSON, wrong content type, cross-origin and oversized requests are rejected", async () => {
  assert.equal((await POST(new Request("https://example.com/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status, 400);
  assert.equal((await POST(request(lead, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await POST(request(lead, { Origin: "https://attacker.example" }))).status, 403);
  assert.equal((await POST(request({ extra: "x".repeat(9000) }))).status, 413);
});
test("missing credentials and insecure webhook configuration fail closed", async () => {
  assert.equal((await POST(request())).status, 503);
  webhook(); process.env.MAKE_WEBHOOK_URL = "http://example.com/hook";
  assert.equal((await POST(request())).status, 503);
  process.env.MAKE_WEBHOOK_URL = "https://example.com/hook"; delete process.env.MAKE_WEBHOOK_SECRET;
  assert.equal((await POST(request())).status, 503);
});
test("Make receives exact envelope, normalized phone, API key and correlation ID", async () => {
  webhook();
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), process.env.MAKE_WEBHOOK_URL);
    assert.equal(options.headers["x-make-apikey"], "test-secret");
    const event = JSON.parse(options.body);
    assert.deepEqual(Object.keys(event), ["event", "data"]);
    assert.equal(event.event, "lead.created");
    assert.deepEqual(event.data, { ...lead, name: "Jane Smith", phone: "+18315550192", submittedAt: event.data.submittedAt });
    assert.ok(options.headers["X-Lead-Id"]);
    return new Response("Accepted", { status: 200 });
  };
  const response = await POST(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.deepEqual(Object.keys(result), ["success", "timestamp", "leadId"]);
  assert.equal(result.success, true);
});
test("webhook rejection falls back to Airtable with correct field mapping and sends both SMS", async () => {
  webhook(); airtable(); twilio();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes("make.com")) return new Response("Unavailable", { status: 503 });
    if (String(url).includes("airtable.com")) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.typecast, true);
      const fields = payload.records[0].fields;
      assert.deepEqual(fields, { "Lead Name": "Jane Smith", "Phone Number": "+18315550192", "Service Requested": "Emergency", "City / ZIP": "Capitola, CA", Status: "New", "Notes / Details": "Drain backing up", Source: "hero_form" });
      return Response.json({ records: [{ id: "recTest" }] });
    }
    assert.match(String(url), /api\.twilio\.com/);
    const fields = new URLSearchParams(options.body);
    assert.ok(["+18315550192", "+18005550198"].includes(fields.get("To")));
    assert.ok(fields.get("Body"));
    return Response.json({ sid: "SMTest" }, { status: 201 });
  };
  const response = await POST(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).leadId, "recTest");
  assert.equal(calls.length, 4);
});
test("network timeout falls back; a saved lead remains successful when SMS fails", async () => {
  webhook(); airtable(); twilio();
  globalThis.fetch = async (url) => {
    if (String(url).includes("make.com")) throw new DOMException("Timeout", "TimeoutError");
    if (String(url).includes("airtable.com")) return Response.json({ records: [{ id: "recSaved" }] });
    throw new Error("SMS unavailable");
  };
  assert.equal((await POST(request())).status, 200);
});
test("Airtable direct path works without Make and maps each select option", async () => {
  airtable();
  for (const [serviceType, expected] of [["Emergency Repair", "Emergency"], ["Standard Service", "Repair"], ["System Installation", "Installation"], ["Inspection", "Inspection"]]) {
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).records[0].fields["Service Requested"], expected);
      return Response.json({ records: [{ id: "recDirect" }] });
    };
    assert.equal((await POST(request({ ...lead, serviceType }))).status, 200);
  }
});
test("all dispatch failures return a safe error without credentials or provider details", async () => {
  webhook(); airtable();
  globalThis.fetch = async () => new Response("secret upstream detail", { status: 500 });
  const response = await POST(request());
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes("secret"), false); assert.equal(body.includes(lead.phone), false);
});
test("invalid Airtable success response is not reported as a stored lead", async () => {
  airtable(); globalThis.fetch = async () => Response.json({});
  assert.equal((await POST(request())).status, 502);
});

function email() {
  Object.assign(process.env, { RESEND_API_KEY: "re_test", CONTRACTOR_ALERT_EMAIL: "owner@example.com", RESEND_FROM_EMAIL: "Leads <leads@example.com>" });
}
test("stored Airtable leads trigger an escaped Resend alert with text and idempotency", async () => {
  airtable(); email();
  let emails = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("airtable.com")) return Response.json({ records: [{ id: "recEmail" }] });
    assert.equal(String(url), "https://api.resend.com/emails");
    const payload = JSON.parse(options.body);
    assert.equal(payload.to, "owner@example.com");
    assert.equal(payload.from, "Leads <leads@example.com>");
    assert.ok(payload.text.includes("tel:+18315550192"));
    assert.ok(payload.html.includes("&lt;img src=x&gt;"));
    assert.equal(payload.html.includes("<img src=x>"), false);
    assert.equal(new Headers(options.headers).get("Idempotency-Key"), "owner-alert/recEmail");
    emails++;
    return Response.json({ id: "emailTest" });
  };
  assert.equal((await POST(request({ ...lead, description: "<img src=x>" }))).status, 200);
  assert.equal(emails, 1);
});
test("webhook-accepted leads also trigger exactly one owner email", async () => {
  webhook(); email();
  let emails = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("make.com")) return new Response("Accepted");
    assert.equal(String(url), "https://api.resend.com/emails");
    emails++;
    return Response.json({ id: "emailMake" });
  };
  assert.equal((await POST(request())).status, 200);
  assert.equal(emails, 1);
});
test("Resend API rejection and network failure never fail a saved lead", async () => {
  airtable(); email();
  for (const failure of ["api", "network"]) {
    globalThis.fetch = async (url) => {
      if (String(url).includes("airtable.com")) return Response.json({ records: [{ id: "recStored" }] });
      if (failure === "network") throw new Error("Provider unavailable");
      return Response.json({ name: "validation_error", message: "private provider details", statusCode: 403 }, { status: 403 });
    };
    assert.equal((await POST(request())).status, 200);
  }
});
test("failed lead storage sends no email", async () => {
  airtable(); email();
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes("airtable.com"));
    return new Response("Unavailable", { status: 503 });
  };
  assert.equal((await POST(request())).status, 502);
});
