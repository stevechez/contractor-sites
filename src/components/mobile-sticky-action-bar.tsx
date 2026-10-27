"use client";

import { useEffect, useState } from "react";
import { Calendar, Phone } from "lucide-react";

export default function MobileStickyActionBar() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    function update() {
      const active = document.activeElement;
      const formFocused = active instanceof HTMLElement && Boolean(active.closest("[data-intake-form]"));
      const keyboardOpen = viewport ? window.innerHeight - viewport.height - viewport.offsetTop > 150 : false;
      setHidden(formFocused || keyboardOpen);
    }
    let frame = 0;
    function onFocusChange() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return <nav aria-label="Quick contact" aria-hidden={hidden} inert={hidden} className={`mobile-bar fixed inset-x-0 bottom-0 z-50 flex gap-3 border-t border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-md transition-[opacity,transform] duration-200 sm:hidden ${hidden ? "pointer-events-none translate-y-full opacity-0" : "translate-y-0 opacity-100"}`}>
    <a href="tel:+18315550192" aria-label="Call ApexPro at (831) 555-0192" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950"><Phone aria-hidden="true" className="size-4" />Call Now</a>
    <a href="#quote-section" data-intake-source="sticky_bar" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 text-sm font-bold text-white"><Calendar aria-hidden="true" className="size-4" />Get Quote</a>
  </nav>;
}
