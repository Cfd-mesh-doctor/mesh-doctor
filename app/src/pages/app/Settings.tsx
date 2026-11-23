// SPDX-License-Identifier: GPL-3.0-or-later
// This browser's pairing, the theme, and what is running on each side.
import { ExternalLink, Monitor, Moon, PlugZap, RefreshCw, Sun, Unplug } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Field, PageHeader } from "@/components/shared/page";
import { useConnection } from "@/components/layout/connection";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CardTitleRow } from "@/components/ui/card";
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/misc";
import { useEngine, usePairing } from "@/engine/context";
import { useEngineInfo } from "@/engine/hooks";
import { maskKey } from "@/engine/pairing";
import { formatDateTime } from "@/lib/format";
import { APP_VERSION, REPO_URL } from "@/lib/site";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTitle } from "@/lib/useTitle";

function EngineCard() {
  const { mode } = useEngine();
  const { pairing, forget } = usePairing();
  const info = useEngineInfo();
  const conn = useConnection();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  // The button that asks: "Keep it" hands the focus back to it, as Radix does only for a Dialog.Trigger.
  const forgetButton = useRef<HTMLButtonElement>(null);

  if (mode === "demo" || !pairing) {
    return (
      <Card>
        <CardHeader className="block">
          <CardTitleRow>
            <CardTitle>Engine</CardTitle>
            <Badge tone="info">Demo data</Badge>
          </CardTitleRow>
          <CardDescription>The demo shows data recorded from a real engine. Nothing here runs.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button size="sm" asChild>
            <Link to="/connect"><PlugZap /> Connect your own engine</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="block">
        <CardTitleRow>
          <CardTitle>Engine</CardTitle>
          <Badge tone={conn.tone}><Dot tone={conn.tone} /> {conn.label}</Badge>
        </CardTitleRow>
        <CardDescription>Mesh Doctor on this computer. This browser talks to it directly; nothing passes through the website.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Address" mono>{pairing.engine}</Field>
          <Field label="Paired">{formatDateTime(pairing.paired)}</Field>
          <Field label="Pairing key" mono>{maskKey(pairing.key)}</Field>
        </dl>
        {info.isError && <ErrorPanel compact className="mt-4" error={info.error} />}
      </CardContent>
      <CardFooter className="flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => info.refetch()} disabled={info.isFetching}>
          <RefreshCw className={cn(info.isFetching && "animate-spin")} /> Test connection
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link to="/connect"><PlugZap /> Pair again</Link>
        </Button>
        <Button ref={forgetButton} variant="danger-ghost" size="sm" className="ml-auto" onClick={() => setConfirm(true)}>
          <Unplug /> Forget this engine
        </Button>
      </CardFooter>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            forgetButton.current?.focus(); // gone once the engine is forgotten, as the app goes to Connect
          }}
        >
          <DialogTitle>Forget this engine?</DialogTitle>
          <DialogDescription>
            This browser deletes its pairing key and stops talking to {pairing.engine}. The engine, its cases and its
            results are not touched. To use it again, open a new pairing link.
          </DialogDescription>
          <DialogActions>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={() => {
                forget();
                navigate("/connect");
              }}
            >
              Forget engine
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useTheme();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Saved in this browser only.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Segmented<Theme>
          label="Colour theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" /> Light</span> },
            { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" /> Dark</span> },
            { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" /> System</span> },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function AboutCard() {
  const info = useEngineInfo();
  const schemas = Object.entries(info.data?.schemas ?? {});
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>About</CardTitle>
          <CardDescription>Versions on each side. Any engine with API 1.x works with this app.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Web app">v{APP_VERSION}</Field>
          <Field label="Engine">{info.data?.version ? `v${info.data.version}` : "–"}</Field>
          <Field label="API">{info.data?.apiVersion ?? "–"}</Field>
          <Field label="Licence">GPL-3.0-or-later</Field>
        </dl>
        {schemas.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-medium text-muted-foreground">Result file versions</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {schemas.map(([kind, v]) => (
                <Badge key={kind} tone="neutral" className="font-mono">{kind} {v}</Badge>
              ))}
            </div>
          </div>
        )}
        <p className="mt-5 text-[13px] text-muted-foreground">
          This site keeps four things in your browser: the pairing, your theme, whether you've seen the tour and
          whether the sidebar's Coming next list is open. It has no accounts, no analytics and no server of its own.
        </p>
      </CardContent>
      <CardFooter className="flex-wrap gap-x-5">
        {[
          ["Source code", REPO_URL],
          ["Safety model", "/safety"],
          ["Troubleshooting", "/troubleshooting"],
        ].map(([label, href]) => (
          <a key={href} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {label} <ExternalLink className="size-3.5" />
          </a>
        ))}
      </CardFooter>
    </Card>
  );
}

export function Settings() {
  useTitle("Settings");
  return (
    <>
      <PageHeader title="Settings" description="This browser's connection to Mesh Doctor, and how the app looks." />
      {/* One column that narrows to the screen: a plain grid's column grows to its widest line that can't break,
          such as Pair again's command on a 320 px phone, and takes every card past the screen's edge. */}
      <div className="grid grid-cols-1 gap-6">
        <EngineCard />
        <AppearanceCard />
        <AboutCard />
      </div>
    </>
  );
}
