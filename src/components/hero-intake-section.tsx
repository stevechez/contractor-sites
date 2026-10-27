"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Send, ShieldCheck } from "lucide-react";
import { intakeSchema, serviceTypes, validationErrors } from "@/lib/schemas";
import type { IntakeErrors, IntakeResponse, IntakeSource } from "@/types/intake";

export default function HeroIntakeSection() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [errors, setErrors] = useState<IntakeErrors>({});
  const [source, setSource] = useState<IntakeSource>("hero_form");
  const locked = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleQuoteClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href="#quote-section"]') : null;
      if (!target) return;
      const requestedSource = target.dataset.intakeSource;
      setSource(requestedSource === "sticky_bar" || requestedSource === "footer_form" || requestedSource === "service_card" ? requestedSource : "hero_form");
    }
    document.addEventListener("click", handleQuoteClick);
    return () => document.removeEventListener("click", handleQuoteClick);
  }, []);

  useEffect(() => {
    if (status === "success") successRef.current?.focus();
  }, [status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = event.currentTarget;
    const parsed = intakeSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      const nextErrors = validationErrors(parsed.error);
      setErrors(nextErrors);
      const first = Object.keys(nextErrors)[0];
      const field = form.elements.namedItem(first);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    locked.current = true;
    setStatus("submitting");
    setErrors({});
    try {
      const response = await fetch("/api/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(28000),
      });
      const result: IntakeResponse = await response.json();
      if (!response.ok || !result.success) {
        setErrors(!result.success ? { ...result.errors, _form: [result.error] } : { _form: ["We could not confirm your request. Please call us."] });
        setStatus("idle");
      } else setStatus("success");
    } catch {
      setErrors({ _form: ["We could not confirm your request. Please call us before submitting again."] });
      setStatus("idle");
    } finally { locked.current = false; }
  }

  function errorFor(field: keyof IntakeErrors) {
    return errors[field] ? <p id={`${field}-error`} className="mt-1 text-sm text-red-700">{errors[field]?.join(" ")}</p> : null;
  }
  const inputProps = (field: keyof IntakeErrors) => ({ "aria-invalid": Boolean(errors[field]), "aria-describedby": errors[field] ? `${field}-error` : undefined });

  return <section aria-labelledby="intake-heading" className="rounded-2xl border border-slate-100 bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
    <div className="mb-5 flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
      <div><h2 id="intake-heading" className="text-xl font-bold tracking-tight">Request a Free Estimate</h2><p className="mt-0.5 text-xs font-medium text-slate-500">Tell us what you need. We’ll call you back.</p></div>
      <span className="rounded-md bg-amber-100 px-2.5 py-1 text-[11px] font-bold tracking-wider text-amber-900 uppercase">Fast Intake</span>
    </div>
    {status === "success" ? <div ref={successRef} tabIndex={-1} role="status" className="space-y-4 rounded-lg py-6 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-teal-100 text-teal-700"><Check className="size-8" aria-hidden="true" /></div>
      <h3 className="text-xl font-bold">Request dispatched</h3>
      <p className="text-sm text-slate-600">We received your request. Expect a call within 15 minutes during service hours. For urgent help, please call us directly.</p>
      <a className="block font-bold text-teal-700 underline" href="tel:+18315550192" aria-label="Call ApexPro at (831) 555-0192">Call (831) 555-0192</a>
      <button type="button" onClick={() => { setStatus("idle"); setSource("hero_form"); }} className="text-sm font-semibold text-teal-700 underline">Send another request</button>
    </div> : <form data-intake-form onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={status === "submitting"}>
      <input type="hidden" name="source" value={source} />
      <fieldset disabled={status === "submitting"} className="space-y-4">
        <legend className="sr-only">Your contact and service details</legend>
        <div><label htmlFor="name" className="field-label">Your Full Name *</label><input id="name" name="name" autoComplete="name" required minLength={2} maxLength={100} placeholder="e.g. Michael Vance" className="form-input" {...inputProps("name")} />{errorFor("name")}</div>
        <div><label htmlFor="phone" className="field-label">Phone Number *</label><input id="phone" name="phone" type="tel" autoComplete="tel" required maxLength={30} placeholder="(831) 000-0000" className="form-input" {...inputProps("phone")} />{errorFor("phone")}</div>
        <div><label htmlFor="serviceType" className="field-label">Service Needed *</label><select id="serviceType" name="serviceType" required className="form-input" {...inputProps("serviceType")}>{serviceTypes.map((service) => <option key={service}>{service}</option>)}</select>{errorFor("serviceType")}</div>
        <div><label htmlFor="addressOrCity" className="field-label">City / ZIP (Optional)</label><input id="addressOrCity" name="addressOrCity" autoComplete="address-level2" maxLength={200} placeholder="e.g. Capitola, CA or 95003" className="form-input" {...inputProps("addressOrCity")} />{errorFor("addressOrCity")}</div>
        <div><label htmlFor="description" className="field-label">How can we help? (Optional)</label><textarea id="description" name="description" maxLength={500} rows={2} placeholder="Briefly describe the issue" className="form-input resize-y" {...inputProps("description")} />{errorFor("description")}</div>
        <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 py-3.5 text-base font-bold text-white shadow-lg shadow-teal-900/15 transition-colors hover:bg-teal-800 disabled:opacity-60">{status === "submitting" ? <><span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" /><span>Submitting...</span></> : <><span>Send Free Estimate Request</span><Send aria-hidden="true" className="size-4" /></>}</button>
      </fieldset>
      {errors._form && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{errors._form.join(" ")} <a href="tel:+18315550192" className="font-bold underline" aria-label="Call ApexPro at (831) 555-0192">Call (831) 555-0192</a></div>}
      <p className="flex items-start justify-center gap-1.5 text-center text-[11px] text-slate-500"><ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-teal-600" />By submitting, you agree to calls and texts about this service request. Message and data rates may apply. Reply STOP to opt out.</p>
    </form>}
  </section>;
}
