// SPDX-License-Identifier: GPL-3.0-or-later
// Pairing: the engine prints https://<this site>/connect#key=…&engine=http://localhost:<port>. This page
// takes the key out of the address bar at once, keeps it in this browser, and tests the connection when
// the user presses Connect (that press is when Chrome and Edge ask about access to apps on this device).
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, KeyRound, Laptop, Link2, LoaderCircle, Lock, PlugZap, ShieldCheck, TriangleExclamationPoint } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Logo } from "@/components/brand/Logo";
import { ThemeMenu } from "@/components/layout/ThemeMenu";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/misc";
import { api, httpTransport } from "@/engine/client";
import { usePairing } from "@/engine/context";
import { maskKey, parsePairingHash, parsePairingLink, type ParsedLink } from "@/engine/pairing";
import { browserCantReachLocal, pageIsLocal } from "@/engine/permission";
import type { EngineInfo } from "@/engine/types";
import { formatRelative } from "@/lib/format";
import { BROWSERS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";

type Phase = { kind: "idle" } | { kind: "testing" } | { kind: "ok"; info: EngineInfo } | { kind: "error"; error: unknown };

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      <span className="absolute top-8 bottom-0 left-[13px] w-px bg-border last:hidden" aria-hidden />
      <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary ring-4 ring-surface">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium">{title}</p>
        {children && <div className="mt-2 text-[13px] text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

function PasteLink({ onUse, compact }: { onUse: (p: { engine: string; key: string }) => void; compact?: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const p = parsePairingLink(text);
    if (!p) return setError("Paste the whole link first.");
    if (!p.ok) return setError(p.error);
    setText("");
    setError(null);
    onUse(p);
  };
  return (
    <form
      className={compact ? "" : "mt-2"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://…/connect#key=…"
          aria-label="Pairing link"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        <Button type="submit" variant="secondary">Use link</Button>
      </div>
      {error && <p className="mt-2 text-[13px] text-danger" role="alert">{error}</p>}
    </form>
  );
}

function BrowserNotes() {
  if (browserCantReachLocal()) {
    return (
      <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-[13px]">
        <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>Safari doesn't let websites reach apps on your computer. Use {BROWSERS} for Mesh Doctor.</span>
      </div>
    );
  }
  if (pageIsLocal()) return null;
  return (
    <div className="flex gap-2.5 rounded-lg border border-border bg-surface-2 p-3 text-[13px] text-muted-foreground">
      <Laptop className="mt-0.5 size-4 shrink-0" />
      <span>
        Your browser will ask whether this site may reach <b className="font-medium text-foreground">apps on your device</b>.
        Choose <b className="font-medium text-foreground">Allow</b>: that is how the page reaches Mesh Doctor.
      </span>
    </div>
  );
}

const SAFETY: [typeof Lock, string, string][] = [
  [KeyRound, "The key never reaches this website", "It travels after the # in the link, which browsers keep to themselves."],
  [Laptop, "Only your own computer", "The app connects to localhost only. Your meshes and results never leave your PC."],
  [ShieldCheck, "Only this site, only with the key", "The engine answers this site's address and nothing else, and only when the key matches."],
  [Lock, "Easy to undo", "Forget the engine in Settings, or make a new key with meshdoctor pair --new, then restart the engine."],
];

export function Connect() {
  useTitle("Connect");
  const { pairing, pair } = usePairing();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [incoming] = useState<ParsedLink>(() => parsePairingHash(location.hash));
  const [kept, setKept] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [showPaste, setShowPaste] = useState(false);
  const started = useRef(false);

  // Once: a first pairing is saved straight away, and the key leaves the address bar and history.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (incoming?.ok && !pairing) pair(incoming.engine, incoming.key);
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  }, [incoming, pairing, pair, location, navigate]);

  const differs = incoming?.ok && pairing && (pairing.engine !== incoming.engine || pairing.key !== incoming.key);
  const needsConfirm = Boolean(differs) && !kept;

  async function connect(p: { engine: string; key: string }) {
    setPhase({ kind: "testing" });
    try {
      const info = await api.info(httpTransport(p.engine, p.key));
      await qc.resetQueries({ queryKey: [p.engine] });
      setPhase({ kind: "ok", info });
    } catch (error) {
      setPhase({ kind: "error", error });
    }
  }

  function use(p: { engine: string; key: string }) {
    pair(p.engine, p.key);
    setKept(true);
    setShowPaste(false);
    void connect(p);
  }

  // Straight into the app once connected.
  useEffect(() => {
    if (phase.kind !== "ok") return;
    const t = setTimeout(() => navigate("/app"), 1400);
    return () => clearTimeout(t);
  }, [phase, navigate]);

  let body: ReactNode;
  if (needsConfirm && incoming?.ok && pairing) {
    body = (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Replace this browser's pairing?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This browser is paired with <code>{pairing.engine}</code> (key {maskKey(pairing.key)}). The link you opened
          pairs it with <code>{incoming.engine}</code> (key {maskKey(incoming.key)}) instead.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => use(incoming)}><PlugZap /> Use the new link</Button>
          <Button variant="secondary" onClick={() => setKept(true)}>Keep the current one</Button>
        </div>
      </>
    );
  } else if (pairing) {
    body = (
      <>
        <h1 className="text-xl font-semibold tracking-tight">{phase.kind === "ok" ? "Connected" : "Connect to your engine"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {phase.kind === "ok"
            ? "Opening the app…"
            : "This browser is paired. Make sure Mesh Doctor is running in WSL, then connect."}
        </p>
        <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface ring-1 ring-border">
            <Laptop className="size-4 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[13px]">{pairing.engine}</div>
            <div className="text-xs text-muted-foreground">
              Key {maskKey(pairing.key)}{pairing.paired && ` · paired ${formatRelative(pairing.paired)}`}
            </div>
          </div>
        </div>
        <div className="mt-4"><BrowserNotes /></div>
        {phase.kind === "error" && (
          <ErrorPanel className="mt-4" error={phase.error} />
        )}
        {phase.kind === "ok" && (
          <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-success/30 bg-success-soft p-3 text-sm" role="status">
            <CircleCheck className="size-4 shrink-0 text-success" />
            Mesh Doctor v{phase.info.version ?? "?"} answered (API {phase.info.apiVersion}).
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {phase.kind === "ok" ? (
            <Button asChild><Link to="/app">Open the app <ArrowRight /></Link></Button>
          ) : (
            <Button onClick={() => void connect(pairing)} disabled={phase.kind === "testing"}>
              {phase.kind === "testing" ? <LoaderCircle className="animate-spin" /> : <PlugZap />}
              {phase.kind === "testing" ? "Connecting…" : phase.kind === "error" ? "Try again" : "Connect"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setShowPaste((s) => !s)}>
            <Link2 /> Use a different link
          </Button>
        </div>
        {showPaste && <div className="mt-4"><PasteLink compact onUse={use} /></div>}
      </>
    );
  } else {
    body = (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Pair this browser with Mesh Doctor</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Mesh Doctor runs on your PC. Pairing lets this page talk to it, once per browser.
        </p>
        {incoming && !incoming.ok && (
          <div className="mt-4 flex gap-2.5 rounded-lg border border-danger/25 bg-danger-soft p-3 text-[13px]" role="alert">
            <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>{incoming.error}</span>
          </div>
        )}
        <ol className="mt-6">
          {/* The engine keeps its window busy: a command typed there next would wait for it to stop. */}
          <Step n={1} title="Start Mesh Doctor in WSL">
            <CopyCommand command="meshdoctor serve" />
            <p className="mt-2">Leave that window open while you use the app: Mesh Doctor runs in it.</p>
          </Step>
          <Step n={2} title="Open the pairing link it prints">
            It starts with this site's address. Or have it open the link for you, from a second WSL window:
            <CopyCommand command="meshdoctor pair --open" className="mt-2" />
          </Step>
          <Step n={3} title="Or paste the link here">
            <PasteLink onUse={use} />
          </Step>
        </ol>
        <div className="mt-6"><BrowserNotes /></div>
        <p className="mt-6 text-[13px] text-muted-foreground">
          No Mesh Doctor yet?{" "}
          <Link to="/install" className="font-medium text-primary hover:underline">Install it (Windows or Linux)</Link>
          {" · "}
          <Link to="/demo" className="font-medium text-primary hover:underline">Explore the demo</Link>
        </p>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link to="/" className="rounded-md"><Logo /></Link>
        <ThemeMenu />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
        <div className="grid w-full max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="p-6 sm:p-8">{body}</Card>
          <aside className="space-y-5 lg:pt-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">How pairing keeps you safe</p>
            {SAFETY.map(([Icon, title, text]) => (
              <div key={title} className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
            <a href="/safety" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
              The full safety model <ArrowRight className="size-3.5" />
            </a>
          </aside>
        </div>
      </main>
    </div>
  );
}
