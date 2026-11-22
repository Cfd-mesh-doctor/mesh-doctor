// SPDX-License-Identifier: GPL-3.0-or-later
// The app's short walkthrough: five steps in plain words on where things are and what each screen tells you, which
// can be skipped at any step. Each step opens the screen it describes and rings the part it means, and the tour stands
// aside so it shows. It opens with the focus on Next, so Enter steps through it; each new step is read out, as the
// focus stays put while the words change; and closing it hands the focus back to whatever opened it.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAppPath } from "@/engine/context";
import { TOUR_STEPS } from "./tourSteps";

export function AppTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const to = useAppPath();
  const next = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { title, text, spot } = TOUR_STEPS[step]!;
  const last = step === TOUR_STEPS.length - 1;
  // Rings the part of the screen the step means once it's there (a screen shows its data after it opens), and brings
  // it into view when it's off the screen or low on it, where the tour stands. CSS lifts it above the tour's shade.
  useEffect(() => {
    if (!open || !spot) return;
    let lit: Element | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const light = () => {
      const el = document.querySelector(`[data-tour="${spot}"]`);
      if (!el) return false;
      lit = el;
      el.setAttribute("data-tour-spot", "");
      settle = setTimeout(() => { // after the screen has settled: opening one scrolls it to the top
        const { top } = el.getBoundingClientRect();
        if (top < 0 || top > window.innerHeight / 2) {
          const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
        }
      }, 150);
      return true;
    };
    const watch = new MutationObserver(() => {
      if (light()) watch.disconnect();
    });
    if (!light()) watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      clearTimeout(settle);
      lit?.removeAttribute("data-tour-spot");
    };
  }, [open, spot]);
  const go = (i: number) => {
    setStep(i);
    const { page } = TOUR_STEPS[i]!;
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
          opener.current?.focus();
        }}
      >
        <div aria-live="polite" aria-atomic="true">
          <p className="text-xs font-medium text-muted-foreground">Step {step + 1} of {TOUR_STEPS.length}</p>
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
