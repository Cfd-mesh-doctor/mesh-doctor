// SPDX-License-Identifier: GPL-3.0-or-later
// Navigation. Screens that later milestones add are listed already, marked "Soon", so the shape of the
// whole app is visible from day one: under Coming next, folded away until it's opened, so the screens that work
// come first.
import {
  BookOpen, Calculator, ChartLine, ChevronDown, Compass, FlaskConical, FolderOpen, Image, LayoutDashboard, ListChecks, Play,
  Settings, Toolbox, Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link, NavLink } from "react-router";
import { Logo } from "@/components/brand/Logo";
import { Dot } from "@/components/ui/badge";
import { useAppPath, useEngine } from "@/engine/context";
import { useJobs } from "@/engine/hooks";
import { isActive } from "@/engine/types";
import { APP_VERSION } from "@/lib/site";
import { readItem, writeItem } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useConnection } from "./connection";

interface Item {
  label: string;
  icon: LucideIcon;
  path?: string;
  soon?: string;
}

const MAIN: Item[] = [
  { label: "Overview", icon: LayoutDashboard, path: "" },
  { label: "Cases", icon: FolderOpen, path: "/cases" },
  { label: "Repairs", icon: Wrench, path: "/repairs" },
  { label: "Jobs", icon: ListChecks, path: "/jobs" },
  { label: "Size estimator", icon: Calculator, path: "/estimate" },
];

const NEXT: Item[] = [
  { label: "A/B tests", icon: FlaskConical, soon: "Did the repair help the solver?" },
  { label: "Solve", icon: Play, soon: "Set up and run a case on this PC" },
  { label: "Pictures", icon: Image, soon: "ParaView renders of the flow" },
  { label: "Results", icon: ChartLine, soon: "Forces, convergence and comparisons" },
  { label: "Local tools", icon: Toolbox, soon: "Zone repair, full-car pipeline, workbooks" },
];

/** Kept in this browser once Coming next is opened or folded again: it stays as it was left. */
const NEXT_OPEN = "md-coming-next";
/** Each sidebar on the page (the wide screen's and the phone menu's), so the list opens and folds in both at once,
 * even where the browser keeps nothing. */
const sidebars = new Set<(open: boolean) => void>();

/** Whether Coming next is open: folded away until it's opened. */
function useComingNext(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => readItem(NEXT_OPEN) === "open");
  useEffect(() => {
    sidebars.add(setOpen);
    return () => {
      sidebars.delete(setOpen);
    };
  }, []);
  const set = (next: boolean) => {
    writeItem(NEXT_OPEN, next ? "open" : "closed");
    sidebars.forEach((s) => s(next));
  };
  return [open, set];
}

function NavItem({ item, onNavigate, active }: { item: Item; onNavigate?: () => void; active?: number }) {
  const to = useAppPath();
  const Icon = item.icon;
  const base = "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors";
  if (item.path === undefined) {
    return (
      <div className={cn(base, "cursor-default text-muted-foreground/70")} title={item.soon} aria-disabled>
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="rounded border border-border px-1.5 text-[10px] font-semibold tracking-wide uppercase">Soon</span>
      </div>
    );
  }
  return (
    <NavLink
      to={to(item.path)}
      end={item.path === ""}
      onClick={onNavigate}
      className={({ isActive: on }) =>
        cn(base, on ? "bg-surface text-foreground shadow-card ring-1 ring-border" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")
      }
    >
      {({ isActive: on }) => (
        <>
          <Icon className={cn("size-4 shrink-0", on && "text-primary")} />
          <span className="flex-1 truncate">{item.label}</span>
          {active ? (
            <>
              <span aria-hidden className="rounded-full bg-primary-soft px-1.5 text-[11px] font-semibold text-primary tabular-nums">
                {active}
              </span>
              {/* Said as "Jobs (1 active)", not as a bare "Jobs 1": running or waiting their turn, as the Jobs
                  screen's Active filter counts them. */}
              <span className="sr-only"> ({active} active)</span>
            </>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/** `onTour` opens the app tour: the sidebar offers it when the app has one to give. */
export function Sidebar({ onNavigate, onTour }: { onNavigate?: () => void; onTour?: () => void }) {
  const to = useAppPath();
  const { mode } = useEngine();
  const jobs = useJobs();
  const active = jobs.data?.items.filter((j) => isActive(j.state)).length ?? 0;
  const conn = useConnection();
  const [nextOpen, setNextOpen] = useComingNext();
  const nextId = useId();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link to={to()} onClick={onNavigate} className="rounded-md">
          <Logo tag={mode === "demo" ? "Demo" : undefined} />
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3" aria-label="Main">
        <div className="space-y-0.5">
          {MAIN.map((i) => (
            <NavItem key={i.label} item={i} onNavigate={onNavigate} active={i.path === "/jobs" ? active : undefined} />
          ))}
        </div>
        <div>
          {/* Said as "Coming next 5 screens": the count is how many are coming. */}
          <button
            type="button"
            aria-expanded={nextOpen}
            aria-controls={nextId}
            onClick={() => setNextOpen(!nextOpen)}
            className="flex h-7 w-full items-center gap-2 rounded-md px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            Coming next{" "}
            <span className="rounded-full border border-border px-1.5 text-[10px] tabular-nums">{NEXT.length}</span>{" "}
            <span className="sr-only">screens</span>
            <ChevronDown className={cn("ml-auto size-3.5 shrink-0 transition-transform", nextOpen && "rotate-180")} aria-hidden />
          </button>
          <div id={nextId} hidden={!nextOpen} className="mt-1 space-y-0.5">
            {NEXT.map((i) => <NavItem key={i.label} item={i} />)}
          </div>
        </div>
      </nav>
      <div className="space-y-0.5 border-t border-border px-3 py-3">
        <NavItem item={{ label: "Settings", icon: Settings, path: "/settings" }} onNavigate={onNavigate} />
        {/* The site's Docs page, in a new tab so the app stays as it is. */}
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <BookOpen className="size-4 shrink-0" />
          Documentation
        </a>
        {onTour && (
          // Always at hand, as the banner's link is gone once the page scrolls. From the phone's menu, the menu
          // closes as the tour opens.
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              onTour();
            }}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Compass className="size-4 shrink-0" />
            Take the tour
          </button>
        )}
        <div className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground">
          <Dot tone={conn.tone} />
          <span className="truncate" title={conn.detail}>{conn.label}</span>
          <span className="ml-auto tabular-nums">v{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}
