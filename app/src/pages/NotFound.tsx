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

/** Shown if a screen itself breaks: a plain message and a way out, never a blank page. */
export function RouteError() {
  const err = useRouteError();
  useTitle("Something went wrong");
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  // The page hides the error, so put it in the browser console for bug reports.
  useEffect(() => {
    if (!notFound) console.error("Mesh Doctor page error:", err);
  }, [err, notFound]);
  if (notFound) return <NotFoundPage />;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-8 text-xl font-semibold">Something went wrong on this page</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Reloading usually fixes it. If it keeps happening, please report it on GitHub with what you clicked.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Button variant="secondary" asChild><Link to="/">Home</Link></Button>
      </div>
    </div>
  );
}
