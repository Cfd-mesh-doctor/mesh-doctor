// SPDX-License-Identifier: GPL-3.0-or-later
// The header and footer of the public pages (home, report viewer). The app screens have their own sidebar.
import { Link, NavLink } from "react-router";
import { Logo } from "@/components/brand/Logo";
import { ThemeMenu } from "@/components/layout/ThemeMenu";
import { Button } from "@/components/ui/button";
import { usePairing } from "@/engine/context";
import { DOCS, REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const navLink = "hover:text-foreground";

export function PublicHeader() {
  const { pairing } = usePairing();
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="rounded-md"><Logo /></Link>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex" aria-label="Site">
          <Link to="/#how" className={navLink}>How it works</Link>
          <Link to="/#privacy" className={navLink}>Privacy</Link>
          <Link to="/#start" className={navLink}>Get started</Link>
          <NavLink to="/report" className={({ isActive }) => cn(navLink, isActive && "font-medium text-foreground")}>
            Report viewer
          </NavLink>
          <a href={DOCS.readme} target="_blank" rel="noreferrer" className={navLink}>Docs</a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeMenu />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to="/demo">Demo</Link>
          </Button>
          <Button size="sm" asChild>
            <Link to={pairing ? "/app" : "/connect"}>Open the app</Link>
          </Button>
        </div>
      </div>
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
          <a href={DOCS.howItWorks} {...ext}>How it works</a>
          <a href={DOCS.safety} {...ext}>Safety model</a>
          <a href={DOCS.limits} {...ext}>Limits</a>
          <a href={DOCS.example} {...ext}>Worked example</a>
          <a href={DOCS.license} {...ext}>Licence</a>
          <Link to="/report" className={navLink}>Report viewer</Link>
          <Link to="/demo" className={navLink}>Demo</Link>
        </nav>
      </div>
    </footer>
  );
}
