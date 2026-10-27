This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses `next/font` to optimize and self-host the Inter font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## ApexPro lead intake

The homepage uses server-rendered content with two client islands: the validated
intake form and a mobile action bar that hides during form focus or keyboard use.
Next.js 16.4.3 is retained; no new scaffold or framework downgrade is needed.
The layout uses a self-hosted Inter font through `next/font`, and viewport safe
areas support iOS. Public click-to-call numbers are intentionally visible;
customer numbers, the owner's private alert number, and provider credentials are
never returned by the intake API or logged.

Copy `.env.local.example` to `.env.local` and populate it locally. No real
credentials are included. Restart the dev server after changing environment
variables. Run `pnpm dev`, `pnpm lint`, `pnpm test`, and `pnpm build`.

### Dispatch contract

`POST /api/intake` accepts JSON matching `src/lib/schemas.ts`. US numbers require
a full ten-digit number with an optional country code and normalize to E.164.
Service options are Emergency Repair, Standard Service, System Installation, and
Inspection. These map to Airtable's Emergency, Repair, Installation, and
Inspection select values respectively. Invalid requests return HTTP 400 with
`{ success: false, error, errors: { fieldName: [messages] } }`. Body size is capped
at 8 KiB, and cross-origin browser posts are rejected.

Resend owner alerts run after either webhook acceptance or a direct Airtable save.
The primary path sends the exact `lead.created` envelope from the handoff with a
`submittedAt` timestamp. Configure API Key authentication on the Make Custom
Webhook using `MAKE_WEBHOOK_SECRET`; the route sends it in `x-make-apikey`.
`X-Lead-Id` supplies a correlation UUID without changing the JSON payload.
Make's plain-text acceptance response is supported. See
[Make webhook authentication](https://apps.make.com/gateway) and
[Make response semantics](https://help.make.com/webhooks).

If Make fails or is unconfigured, the route writes directly to Airtable using a
personal access token. After storage, it sends the owner alert through Resend. Optional existing
Twilio settings still enable direct-path owner and customer SMS; Twilio is not
required for email alerts. Notification tasks run in parallel, and failed sends
are logged with a lead ID. A notification failure does not erase an accepted lead
or encourage the customer to create another record. See the
[Airtable API guide](https://support.airtable.com/docs/getting-started-with-airtables-web-api)
and [Twilio Messages API](https://www.twilio.com/docs/messaging/api/message-resource).

Success returns `{ success: true, timestamp, leadId }`. For Make, `leadId` is a
correlation UUID; for direct Airtable it is a record ID. This confirms acceptance
or storage, not downstream completion or handset delivery. There are no blind
automatic retries. The webhook, Airtable, email, and SMS calls each have an 8-second
timeout, with SMS calls parallelized and a 30-second route budget.

### Airtable setup

Create base **Local Contractor CRM**, table **Leads**, with these exact names:

| Field | Type / values |
| --- | --- |
| Lead Name | Single line text, primary |
| Phone Number | Phone number |
| Service Requested | Single select: Emergency, Repair, Installation, Inspection |
| City / ZIP | Single line text |
| Status | Single select: New, Contacted, Estimate Scheduled, Won, Lost |
| Notes / Details | Long text |
| Source | Single line text |
| Created At | Created time, managed by Airtable |

Set the Status default to New; the direct path also explicitly writes New. Give
the PAT `data.records:write` permission on this base. No schema creation or real
records have been submitted by this implementation.

### Make scenario setup

1. Create a Custom Webhook, enable API Key authentication, and configure the URL
   and key in the server environment. Enable request headers to capture X-Lead-Id.
2. Add Airtable Create a Record. Map `data.name`, `data.phone`,
   `data.addressOrCity`, `data.description`, and `data.source` to the corresponding
   fields above. Map service select values using the four-value mapping described
   above. Set Status to New and leave Created At unset.
3. Add Twilio Send an SMS to the private owner number with:
   `🚨 NEW LEAD ALERT: {{data.name}} needs {{data.serviceType}} in {{data.addressOrCity}}. Phone: {{data.phone}}. Tap to call immediately: tel:{{data.phone}}`
4. Add Twilio Send an SMS to `data.phone` with:
   `Hi {{data.name}}, thank you for reaching out to [Business Name]! We have received your request for {{data.serviceType}} and an on-call technician will review and call you shortly.`
5. Enable immediate execution and the scenario, and configure error handlers and
   alerts for failed Airtable/SMS modules. Make holds its own Twilio credentials.

### Operational limits and launch verification

A timeout is ambiguous: Make may have accepted a request even when its response
never reaches this server. Falling back can therefore create a duplicate. The
correlation header helps trace this, but the specified Airtable schema has no
unique request ID. Exactly-once behavior needs a shared persistent idempotency
store/unique request ID spanning Make and the direct path; it is not claimed
here. Notification retries likewise need a durable queue/outbox and delivery
tracking; current failure logs require operator monitoring. Add infrastructure
rate limiting/bot controls for this public, SMS-capable endpoint before exposing
it to unrestricted traffic.

Unit tests mock all provider traffic and cover validation, request guards,
webhook auth/payload, Airtable field mapping, fallback, unavailable integrations,
and notification failures. A live Make/Airtable/Twilio round trip has not been
performed without credentials. Test with your designated number before launch,
including iOS keyboard behavior, failure recovery, and SMS timing. Sub-second
mobile loads and confirmation within 60 seconds are targets, not measured
results. The form has no customer email field. Resend emails the owner only; customer
confirmation remains the on-page message unless optional SMS is configured.
The phone, license, reviews, project details, prices, and service promises remain
prototype business content and need verification before publication.

### Resend owner alert setup

1. Create a Resend API key. Set `RESEND_API_KEY`, `CONTRACTOR_ALERT_EMAIL`, and
   `RESEND_FROM_EMAIL` in Vercel's Production environment and redeploy this code.
2. For the first test, use `ApexPro Leads <onboarding@resend.dev>` as the sender
   and the email address associated with your Resend account as the recipient.
3. For any other recipient, verify a domain in Resend, add its required DNS
   records, and use a sender on that domain. The Vercel `.vercel.app` hosting
   address is not a sender domain you own. See
   [Resend sender restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
4. Submit one lead with a number you control. Confirm Airtable storage and the
   owner email. Check Vercel logs for `intake.email_accepted`,
   `intake.email_failed`, or `intake.email_unconfigured`. API acceptance does not
   guarantee inbox delivery; check Resend delivery events and spam folders too.

The alert includes escaped HTML, plain text, and a click-to-call link. It uses an
8-second timeout and a provider idempotency key derived from the accepted lead ID.
Resend failures do not turn an accepted lead into a failed submission. No live
emails were sent by the automated tests. Resend's SDK may print provider error
information in development; production application logs omit provider messages.

A carrier gateway address can be configured as the owner recipient, but delivery
and formatting depend on that carrier. Verify support before relying on it:
[Verizon is shutting down Vtext/VZWPix email-to-text](https://www.verizon.com/support/vtext-vzwpix-shutdown/).
Start with a normal email inbox and phone push notifications. This integration
does not infer a customer's carrier or send customer confirmation by email.
If Make also sends an owner email, disable that duplicate module; this server
already sends an alert after Make acceptance (before downstream storage is confirmed).
