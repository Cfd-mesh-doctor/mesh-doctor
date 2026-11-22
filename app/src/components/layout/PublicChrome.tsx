// SPDX-License-Identifier: GPL-3.0-or-later
// The header and footer of the public pages (home, how it works, report viewer, estimator). The app screens have
// their own sidebar.
// Below tablet width the header's links move into a menu that slides in from the left, as the app's sidebar does.
import {
  BookOpen, Calculator, CirclePlay, Download, FileSearch, Images, Menu as MenuIcon, Rocket, ShieldCheck, Target,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router";
import { Logo } from "@/components/brand/Logo";
import { ThemeMenu } from "@/components/layout/ThemeMenu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/dialog";
import { usePairing } from "@/engine/context";
import { DOCS, REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const navLink = "hover:text-foreground";
const menuItem = "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors " +
  "hover:bg-surface-2 hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0";

/** The header's links, for small screens. */
function PhoneMenu({ onNavigate }: { onNavigate: () => void }) {
  const page = ({ isActive }: { isActive: boolean }) => cn(menuItem, isActive && "bg-surface-2 text-foreground");
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link to="/" onClick={onNavigate} className="rounded-md"><Logo /></Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Site menu">
        <NavLink to="/how-it-works" onClick={onNavigate} className={page}><Workflow aria-hidden />How it works</NavLink>
        <NavLink to="/accuracy" onClick={onNavigate} className={page}><Target aria-hidden />Accuracy check</NavLink>
        <NavLink to="/gallery" onClick={onNavigate} className={page}><Images aria-hidden />Gallery</NavLink>
        <Link to="/#privacy" onClick={onNavigate} className={menuItem}><ShieldCheck aria-hidden />Privacy</Link>
        <Link to="/#start" onClick={onNavigate} className={menuItem}><Rocket aria-hidden />Get started</Link>
        <NavLink to="/install" onClick={onNavigate} className={page}><Download aria-hidden />Install</NavLink>
        <NavLink to="/report" onClick={onNavigate} className={page}><FileSearch aria-hidden />Report viewer</NavLink>
        <NavLink to="/estimate" onClick={onNavigate} className={page}><Calculator aria-hidden />Size estimator</NavLink>
        <NavLink to="/demo" onClick={onNavigate} className={page}><CirclePlay aria-hidden />Demo</NavLink>
        <a href={DOCS.readme} target="_blank" rel="noreferrer" onClick={onNavigate} className={menuItem}>
          <BookOpen aria-hidden />Docs
        </a>
      </nav>
    </div>
  );
}

export function PublicHeader() {
  const { pairing } = usePairing();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 md:gap-6">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" className="-ml-1.5 md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <MenuIcon />
          </Button>
          <Link to="/" className="rounded-md"><Logo className="whitespace-nowrap" /></Link>
        </div>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex" aria-label="Site">
          <NavLink to="/how-it-works" className={({ isActive }) => cn(navLink, isActive && "font-medium text-foreground")}>
            How it works
          </NavLink>
          <Link to="/#privacy" className={navLink}>Privacy</Link>
          <Link to="/#start" className={navLink}>Get started</Link>
          <NavLink to="/report" className={({ isActive }) => cn(navLink, isActive && "font-medium text-foreground")}>
            Report viewer
          </NavLink>
          <NavLink to="/estimate" className={({ isActive }) => cn(navLink, isActive && "font-medium text-foreground")}>
            Estimator
          </NavLink>
          <a href={DOCS.readme} target="_blank" rel="noreferrer" className={navLink}>Docs</a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeMenu />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to="/demo">Demo</Link>
          </Button>
          <Button size="sm" asChild>
            {/* "Open app" on the smallest phones (under 360 px), where the whole header just fits that way. */}
            <Link to={pairing ? "/app" : "/connect"}>Open <span className="max-[360px]:hidden">the </span>app</Link>
          </Button>
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <PhoneMenu onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}

export function PublicFooter() {
  const ext = { target: "_blank", rel: "noreferrer", className: navLink };
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-[13px] text-muted-foreground sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md space-y-3">
          <Logo />
          <p>
            Free software under the GPL-3.0-or-later licence. This offering is not approved or endorsed by OpenCFD
            Limited, producer and distributor of the OpenFOAM software and owner of the OPENFOAM® and OpenCFD® trade
            marks.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-10 gap-y-2" aria-label="Footer">
          <a href={REPO_URL} {...ext}>Source code</a>
          <Link to="/install" className={navLink}>Install</Link>
          <Link to="/how-it-works" className={navLink}>How it works</Link>
          <Link to="/accuracy" className={navLink}>Accuracy check</Link>
          <Link to="/gallery" className={navLink}>Gallery</Link>
          <a href={DOCS.safety} {...ext}>Safety model</a>
          <a href={DOCS.limits} {...ext}>Limits</a>
          <a href={DOCS.example} {...ext}>Worked example</a>
          <a href={DOCS.license} {...ext}>Licence</a>
          <Link to="/report" className={navLink}>Report viewer</Link>
          <Link to="/estimate" className={navLink}>Size estimator</Link>
          <Link to="/demo" className={navLink}>Demo</Link>
        </nav>
      </div>
    </footer>
  );
}
