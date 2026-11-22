// SPDX-License-Identifier: GPL-3.0-or-later
// The frame around every app screen: sidebar, top bar, and the demo notice when showing recorded data.
import { ArrowRight, Compass, Info, Menu as MenuIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useMatches } from "react-router";
import { Logo } from "@/components/brand/Logo";
import { AppTour } from "@/components/shared/AppTour";
import { TOUR_SEEN, TOUR_STEPS, engineTourSteps } from "@/components/shared/tourSteps";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/dialog";
import { useAppPath, useEngine } from "@/engine/context";
import { useRepairs } from "@/engine/hooks";
import { latestFinished } from "@/engine/verdict";
import { focusOnce } from "@/lib/focusOnce";
import { REPO_URL } from "@/lib/site";
import { canStore, readItem, writeItem } from "@/lib/storage";
import { ConnectionPill } from "./ConnectionPill";
import { Sidebar } from "./Sidebar";
import { ThemeMenu } from "./ThemeMenu";

export interface RouteHandle {
  title?: string;
}

function usePageTitle(): string | undefined {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const t = (matches[i]?.handle as RouteHandle | undefined)?.title;
    if (t) return t;
  }
  return undefined;
}

function DemoNotice({ onTour }: { onTour: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-info/20 bg-info-soft px-4 py-2 text-[13px] text-info">
      <span className="inline-flex items-center gap-2">
        <Info className="size-4" />
        Demo: recorded from a real run of the public Ahmed-body example. Nothing here runs.
      </span>
      {/* A minute's walk through the app in plain words: the first thing a newcomer to the demo can do. */}
      <button
        type="button"
        onClick={onTour}
        className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
      >
        <Compass className="size-3.5" /> Take the tour
      </button>
      <Link to="/connect" className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline">
        Connect your own engine <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

/** Your own app's offer of its tour, on its front page until it's taken or turned down. */
function TourOffer({ onTour, onDecline }: { onTour: () => void; onDecline: () => void }) {
  return (
    <div
      role="note"
      aria-label="Tour"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary-soft p-4 sm:flex-row sm:items-center"
    >
      <p className="flex min-w-0 flex-1 items-start gap-3 text-sm">
        <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          <strong className="font-semibold">New to Mesh Doctor?</strong> A one-minute tour shows where things are and
          what each screen tells you. It stays in the sidebar for later.
        </span>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={onTour}>Take the tour</Button>
        <Button size="sm" variant="ghost" onClick={onDecline}>No thanks</Button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { mode } = useEngine();
  const to = useAppPath();
  const title = usePageTitle();
  const { pathname } = useLocation();
  const home = pathname.replace(/\/+$/, "") === to();
  const [open, setOpen] = useState(false);
  // The app tour, opened from the sidebar (and the demo's banner). The demo's front page also opens it by itself the
  // first time, once per browser; a link straight to another screen (a report someone shared) opens that screen alone,
  // and a browser that can't keep the note that the tour has been open doesn't get it by itself, or it would open on
  // every visit.
  const [tour, setTour] = useState(() => mode === "demo" && home && readItem(TOUR_SEEN) === null && canStore());
  // Your own app offers its tour on its front page instead, with a note: you've just paired, and came to see your own
  // cases. The note goes once the tour has been open or turned down, remembered as the tour is (so, as there, not where
  // that can't be kept).
  const [offer, setOffer] = useState(() => mode === "engine" && readItem(TOUR_SEEN) === null && canStore());
  useEffect(() => {
    if (tour) writeItem(TOUR_SEEN, "1");
  }, [tour]);
  // The demo's tour ends on a recorded report; your own app's on your latest finished repair's, asked of the engine
  // while the tour is open.
  const repairs = useRepairs(tour && mode === "engine");
  const steps = mode === "demo" ? TOUR_STEPS : engineTourSteps(latestFinished(repairs.data?.items));
  const onTour = () => {
    setOffer(false);
    setTour(true);
  };
  const decline = () => {
    writeItem(TOUR_SEEN, "1");
    setOffer(false);
    const main = document.querySelector("main");
    if (main) focusOnce(main); // the note goes with the focus: on to the page's content
  };
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-sidebar lg:block print:hidden">
        <Sidebar onTour={onTour} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setOpen(false)} onTour={onTour} />
        </SheetContent>
      </Sheet>
      <AppTour open={tour} onClose={() => setTour(false)} steps={steps} />
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === "demo" && <DemoNotice onTour={onTour} />}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6 print:hidden">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <MenuIcon />
          </Button>
          <Link to={to()} className="lg:hidden">
            <Logo />
          </Link>
          {title && <span className="hidden text-sm font-medium text-muted-foreground lg:inline">{title}</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <ConnectionPill />
            <ThemeMenu />
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">
            {offer && home && <TourOffer onTour={onTour} onDecline={decline} />}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
