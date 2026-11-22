// SPDX-License-Identifier: GPL-3.0-or-later
// The frame around every app screen: sidebar, top bar, and the demo notice when showing recorded data.
import { ArrowRight, Compass, Info, Menu as MenuIcon } from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useMatches } from "react-router";
import { Logo } from "@/components/brand/Logo";
import { AppTour } from "@/components/shared/AppTour";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/dialog";
import { useAppPath, useEngine } from "@/engine/context";
import { REPO_URL } from "@/lib/site";
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

function DemoNotice() {
  const [tour, setTour] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-info/20 bg-info-soft px-4 py-2 text-[13px] text-info">
      <span className="inline-flex items-center gap-2">
        <Info className="size-4" />
        Demo: recorded from a real run of the public Ahmed-body example. Nothing here runs.
      </span>
      {/* A minute's walk through the app in plain words: the first thing a newcomer to the demo can do. */}
      <button
        type="button"
        onClick={() => setTour(true)}
        className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
      >
        <Compass className="size-3.5" /> Take the tour
      </button>
      <Link to="/connect" className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline">
        Connect your own engine <ArrowRight className="size-3.5" />
      </Link>
      <AppTour open={tour} onClose={() => setTour(false)} />
    </div>
  );
}

export function AppLayout() {
  const { mode } = useEngine();
  const to = useAppPath();
  const title = usePageTitle();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-sidebar lg:block print:hidden">
        <Sidebar />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === "demo" && <DemoNotice />}
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
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
