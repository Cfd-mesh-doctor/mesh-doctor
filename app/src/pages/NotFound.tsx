// SPDX-License-Identifier: GPL-3.0-or-later
import { ArrowLeft, Compass } from "lucide-react";
import { useEffect } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Logo } from "@/components/brand/Logo";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/lib/useTitle";

export function NotFound({ home = "/" }: { home?: string }) {
  useTitle("Not found");
  return (
    <EmptyState
      icon={Compass}
      title="This page doesn't exist"
      heading="h1"
      className="py-24"
      action={
        <Button variant="secondary" asChild>
          <Link to={home}><ArrowLeft /> Back to the start</Link>
        </Button>
      }
    >
      Check the address, or go back to where you started.
    </EmptyState>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Link to="/" className="rounded-md"><Logo /></Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <NotFound />
      </main>
    </div>
  );
}

/**
 * A page whose code didn't load because the site was updated: a tab opened before the update still asks for the old
 * build's files, and the host, which has only the new ones, answers with the site's own page instead.
 */
function isOldBuild(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  // How Chrome and Edge, Firefox and Safari word a failed import, and Vite's words when a page's styles don't load.
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

/** Shown if a screen itself breaks: a plain message and a way out, never a blank page. */
export function RouteError() {
  const err = useRouteError();
  const oldBuild = isOldBuild(err);
  useTitle(oldBuild ? "Updated" : "Something went wrong");
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  // The page hides the error, so put it in the browser console for bug reports (an update isn't a bug).
  useEffect(() => {
    if (!notFound && !oldBuild) console.error("Mesh Doctor page error:", err);
  }, [err, notFound, oldBuild]);
  if (notFound) return <NotFoundPage />;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-8 text-xl font-semibold">{oldBuild ? "Mesh Doctor has been updated" : "Something went wrong on this page"}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {oldBuild
          ? "This tab was opened before the update, so this page can't load. Reload to get the new version."
          : "Reloading usually fixes it. If it keeps happening, please report it on GitHub with what you clicked."}
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Button variant="secondary" asChild><Link to="/">Home</Link></Button>
      </div>
    </main>
  );
}
