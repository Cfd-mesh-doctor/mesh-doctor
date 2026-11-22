// SPDX-License-Identifier: GPL-3.0-or-later
// The app's short walkthrough: five steps in plain words on where things are and what each screen tells you, which
// can be skipped at any step. It opens with the focus on Next, so Enter steps through it; each new step is read out,
// as the focus stays put while the words change; and closing it hands the focus back to whatever opened it.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TOUR_STEPS } from "./tourSteps";

export function AppTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { title, text } = TOUR_STEPS[step]!;
  const last = step === TOUR_STEPS.length - 1;
  const close = () => {
    setStep(0); // the next time, it starts from the beginning
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
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
                setStep(step - 1);
              }}
            >
              Back
            </Button>
          )}
          <Button ref={next} onClick={() => (last ? close() : setStep(step + 1))}>{last ? "Done" : "Next"}</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
