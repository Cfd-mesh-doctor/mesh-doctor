// SPDX-License-Identifier: GPL-3.0-or-later
// The app's short walkthrough: eight steps in plain words on where things are and what each screen tells you, which
// can be skipped at any step. Each step opens the screen it describes and rings the part it means, and the tour stands
// aside so it shows. It opens with the focus on Next, so Enter steps through it; each new step is read out, as the
// focus stays put while the words change; and closing it hands the focus back to whatever opened it, or on to the
// page's content when that's gone. The steps are the demo's or your own app's (tourSteps.ts).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAppPath } from "@/engine/context";
import { focusOnce } from "@/lib/focusOnce";
import type { TourStep } from "./tourSteps";

export function AppTour({ open, onClose, steps }: { open: boolean; onClose: () => void; steps: readonly TourStep[] }) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const to = useAppPath();
  const next = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { title, text, spot } = steps[step]!;
  const last = step === steps.length - 1;
  // Rings the part of the screen the step means once it's there (a screen shows its data after it opens), and brings
  // it into view when it's off the screen or low on it, where the tour stands, or when it reaches under the tour's box
  // and would fit above it once scrolled up (Getting started, on a laptop's screen). It looks again whenever the part
  // moves on the page in the next two seconds, as the cards above it fill in and push it down (Solve, on a phone). CSS
  // lifts it above the tour's shade, and its scroll-margin-top keeps it clear of the header.
  useEffect(() => {
    if (!open || !spot) return;
    let lit: Element | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let glided = -Infinity; // when the tour last scrolled to the part smoothly
    const place = (el: Element) => {
      const { top, bottom } = el.getBoundingClientRect();
      const box = document.querySelector("[data-tour-box]")?.getBoundingClientRect().top ?? window.innerHeight;
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      // A part that reaches under the box goes up when it would then show above it, or all but its last few pixels.
      const under = bottom > box && bottom - top <= box - margin + 24;
      // A smooth scroll to it that may still be on its way heads for where the part was before it moved.
      const heading = performance.now() - glided < 1000;
      if (heading || top < 0 || top > window.innerHeight / 2 || (under && top > margin + 1)) {
        const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
        if (!still) glided = performance.now();
      }
    };
    const light = () => {
      const el = document.querySelector(`[data-tour="${spot}"]`);
      if (!el) return false;
      lit = el;
      el.setAttribute("data-tour-spot", "");
      const check = () => { // once the screen has settled: opening one scrolls it to the top
        clearTimeout(settle);
        settle = setTimeout(() => place(el), 150);
      };
      check();
      const end = performance.now() + 2000;
      const y = () => el.getBoundingClientRect().top + window.scrollY; // where it is on the page, however scrolled
      let was = y();
      const follow = () => {
        const now = y();
        if (Math.abs(now - was) > 1) {
          was = now;
          check();
        }
        if (performance.now() < end) frame = requestAnimationFrame(follow);
      };
      frame = requestAnimationFrame(follow);
      return true;
    };
    const watch = new MutationObserver(() => {
      if (light()) watch.disconnect();
    });
    if (!light()) watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      clearTimeout(settle);
      cancelAnimationFrame(frame);
      lit?.removeAttribute("data-tour-spot");
    };
  }, [open, spot]);
  const go = (i: number) => {
    setStep(i);
    const { page } = steps[i]!;
    if (page !== undefined) void navigate(to(page));
  };
  const close = () => {
    setStep(0); // the next time, it starts from the beginning
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        // At the foot of the screen (bottom right from 640 px), over a light shade: the screen it describes shows, and
        // the ringed part stands out of the shade. Above that part (z 52 to its 51), should the two meet.
        overlayClassName="bg-black/25 backdrop-blur-none"
        data-tour-box=""
        className="top-auto bottom-4 z-[52] translate-y-0 sm:right-6 sm:bottom-6 sm:left-auto sm:translate-x-0"
        onOpenAutoFocus={(e) => {
          // Radix hands the focus back only to a Dialog.Trigger, so the tour keeps what opened it and goes back there.
          const was = document.activeElement;
          opener.current = was instanceof HTMLElement && was !== document.body ? was : null;
          e.preventDefault();
          next.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          // Back to what opened it; or, when that's gone (the note that offers the tour goes as it opens) or there was
          // none (the demo opened it by itself), on to the page's content, as the skip link does.
          if (opener.current?.isConnected) opener.current.focus();
          else {
            const main = document.querySelector("main");
            if (main) focusOnce(main);
          }
        }}
      >
        <div aria-live="polite" aria-atomic="true">
          <p className="text-xs font-medium text-muted-foreground">Step {step + 1} of {steps.length}</p>
          <DialogTitle className="mt-1">{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </div>
        <DialogActions>
          <Button variant="ghost" className="mr-auto" onClick={close}>Skip tour</Button>
          {step > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                // Back goes away on the first step: the focus moves to Next first, so it isn't lost with it.
                if (step === 1) next.current?.focus();
                go(step - 1);
              }}
            >
              Back
            </Button>
          )}
          <Button ref={next} onClick={() => (last ? close() : go(step + 1))}>{last ? "Done" : "Next"}</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
