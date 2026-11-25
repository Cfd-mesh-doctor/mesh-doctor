// SPDX-License-Identifier: GPL-3.0-or-later
// One set of pictures (GET /pictures/{case}/{set}, API 1.17): its notes on what was left out, and its pictures by
// kind, each fetched with the engine's key once it comes near the screen (GET /pictures/{case}/{set}/{kind}/{file})
// and shown through a blob: URL. A picture opens large, with its title, the ones before and after it, and Download.
// Delete… deletes the set (POST /pictures/{case}/{set}/delete) after a confirmation. A set being made shows its job;
// one being made again keeps the pictures made before until its job has finished. While a job makes it the screen
// asks again every 3 s.
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Image, ListChecks, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { JobStateBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/misc";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useDeletePictures, useJobs, usePicture, usePictureSet } from "@/engine/hooks";
import { isActive, type Job, type Picture, type PictureSet } from "@/engine/types";
import { useBlobSrc, useSeen } from "@/lib/blobImage";
import { formatCount, formatRelative, toMillis } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { Section } from "@/pages/report/Section";
import { saveFile } from "@/report/save";
import { KINDS, jobOfSet, parseSet, pictureFileName, setTitle } from "./pictureSets";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

const jobPath = (job: Job) => `/jobs?job=${encodeURIComponent(job.id)}`;

/** One picture in a set's grid: a grey frame until it comes near the screen and loads, then the picture, which opens
 * large. Its title says what it shows. */
function Thumb({ s, picture, id, onOpen }: { s: PictureSet; picture: Picture; id: string; onOpen: () => void }) {
  const [near, seen] = useSeen<HTMLLIElement>();
  const q = usePicture(s.case, s.set, s.made, picture.file, seen);
  const img = useBlobSrc(q.data);
  const [state, setState] = useState<"loading" | "shown" | "broken">("loading");
  return (
    <li ref={near} className="min-w-0">
      {q.isError ? (
        <div className="grid aspect-video place-items-center rounded-lg bg-surface-2 p-3 text-center ring-1 ring-border">
          <div>
            <p className="text-xs text-danger">The picture didn&apos;t load: {asEngineError(q.error).message}</p>
            <Button className="mt-2" size="sm" variant="secondary" onClick={() => void q.refetch()}
              disabled={q.isFetching}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <button id={id} type="button" onClick={onOpen}
          className="group block w-full rounded-lg text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <span className="relative block aspect-video overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
            {state === "broken" ? (
              <span className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-muted-foreground">
                This browser can&apos;t show the picture: its file isn&apos;t a PNG it can read.
              </span>
            ) : state === "loading" && <Skeleton className="absolute inset-0 size-full rounded-none" />}
            {/* Named by the title under it, which is the button's name. */}
            <img ref={img} alt="" onLoad={() => setState("shown")}
              onError={(e) => { if (e.currentTarget.getAttribute("src")) setState("broken"); }}
              className={cn("size-full object-contain transition-opacity duration-200",
                state === "shown" ? "opacity-100" : "opacity-0")} />
          </span>
          <span className="mt-1.5 block text-xs text-pretty text-muted-foreground group-hover:text-foreground">
            {picture.title}
          </span>
        </button>
      )}
    </li>
  );
}

/** The picture open large, made afresh for each picture so it starts grey until it has loaded. */
function LargePicture({ blob, title, error, onRetry, retrying }: {
  blob: Blob | undefined; title: string; error: unknown; onRetry: () => void; retrying: boolean;
}) {
  const img = useBlobSrc(blob);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative mt-4 aspect-video overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
      {error ? (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm">
          <div>
            <p className="text-danger">The picture didn&apos;t load: {asEngineError(error).message}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry} disabled={retrying}>Try again</Button>
          </div>
        </div>
      ) : (
        <>
          {!loaded && <Skeleton className="absolute inset-0 size-full rounded-none" />}
          <img ref={img} alt={title} onLoad={() => setLoaded(true)}
            className={cn("size-full object-contain", loaded ? "opacity-100" : "opacity-0")} />
        </>
      )}
    </div>
  );
}

/** A picture open large: its title, its place in the set, the ones before and after it (also with ← and →), and
 * Download, which saves the PNG the engine served. On closing, the focus goes to the last picture shown in the grid. */
function Viewer({ s, index, onIndex, onClose, idOf }: {
  s: PictureSet;
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  idOf: (i: number) => string;
}) {
  const picture = index == null ? undefined : s.pictures[index];
  const q = usePicture(s.case, s.set, s.made, picture?.file ?? "", picture != null);
  const shown = useRef<number | null>(null);
  const last = s.pictures.length - 1;
  const go = (i: number) => {
    if (i < 0 || i > last) return;
    shown.current = i;
    onIndex(i);
  };
  const kind = KINDS.find((k) => k.value === picture?.kind)?.label ?? picture?.kind;
  return (
    <Dialog open={picture != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-5xl"
        onOpenAutoFocus={() => { shown.current = index; }}
        onCloseAutoFocus={(e) => {
          // Radix hands the focus back only to a Dialog.Trigger: it goes to the last picture shown instead.
          e.preventDefault();
          if (shown.current != null) document.getElementById(idOf(shown.current))?.focus();
        }}
        onKeyDown={(e) => {
          if (index == null) return;
          if (e.key === "ArrowLeft") go(index - 1);
          else if (e.key === "ArrowRight") go(index + 1);
        }}
      >
        {picture && index != null && (
          <>
            <DialogTitle>{picture.title}</DialogTitle>
            <DialogDescription>
              {kind} · picture {index + 1} of {s.pictures.length} · {s.case}, {setTitle(s)}
            </DialogDescription>
            <LargePicture key={picture.file} blob={q.data} title={picture.title} error={q.isError ? q.error : null}
              onRetry={() => void q.refetch()} retrying={q.isFetching} />
            <div className="mt-6 flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
                  <ChevronLeft aria-hidden /> Previous
                </Button>
                <Button variant="secondary" size="sm" onClick={() => go(index + 1)} disabled={index === last}>
                  Next <ChevronRight aria-hidden />
                </Button>
              </div>
              <Button size="sm" disabled={!q.data}
                onClick={() => q.data && saveFile(q.data, pictureFileName(s.case, s.set, picture.file))}>
                <Download aria-hidden /> Download
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Deleting the set, once asked to confirm: then the Pictures screen, which no longer lists it. */
function DeleteDialog({ s, open, onOpenChange }: { s: PictureSet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const del = useDeletePictures();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) del.reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogTitle>Delete the pictures of {s.case}, {setTitle(s)}?</DialogTitle>
        <DialogDescription>
          This deletes its {formatCount(s.pictures.length, "picture")} and its job&apos;s log from the engine&apos;s
          workspace. The case and its results aren&apos;t touched, so the set can be made again.
          {mode === "demo" && " In the demo this only changes the recorded data in this tab."}
        </DialogDescription>
        {del.isError && <ErrorPanel compact className="mt-4" error={del.error} />}
        <DialogActions>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Keep them</Button>
          <Button variant="danger" disabled={del.isPending}
            onClick={() => del.mutate({ name: s.case, set: s.set }, { onSuccess: () => void navigate(to("/pictures")) })}>
            <Trash2 aria-hidden /> {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

export function PictureSetPage() {
  const { name = "", set = "" } = useParams();
  useTitle(`Pictures of ${name}`);
  const { mode } = useEngine();
  const to = useAppPath();
  const jobs = useJobs();
  const job = jobOfSet(jobs.data?.items, name, set);
  const working = job != null && isActive(job.state);
  // Asked for every 3 s while its job waits or runs, and once it has made the set again until the set made shows (the
  // one here was made before the job started).
  const q = usePictureSet(name, set, (now) => working
    || (job?.state === "done" && now?.made != null && toMillis(now.made) < toMillis(job.started)));
  const s = q.data;
  const code = q.isError ? asEngineError(q.error).code : null;
  const [viewing, setViewing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const base = useId();
  const idOf = (i: number) => `${base}-picture-${i}`;

  const at = s ?? parseSet(set);
  const sub = [
    "Pictures",
    setTitle(at),
    s?.made && `made ${formatRelative(s.made)}`,
    mode === "demo" && "recorded demo",
  ].filter((x): x is string => typeof x === "string");
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" asChild>
        <Link to={to("/pictures")}><ArrowLeft />Pictures</Link>
      </Button>
      {job && (
        <Button variant="ghost" asChild>
          <Link to={to(jobPath(job))}><ListChecks />Job details</Link>
        </Button>
      )}
      {s && !working && (
        <Button variant="danger-ghost" onClick={() => setDeleting(true)}><Trash2 />Delete…</Button>
      )}
    </div>
  );
  const header = <PageHeader title={name} description={sub.join(" · ")} actions={actions} />;

  if (!s) {
    // Being made the first time: the engine answers not-ready while its job waits or runs.
    if (code === "not-ready" || (working && code === "not-found")) {
      return (
        <>
          {header}
          <Card>
            <CardHeader className="flex-wrap">
              <div>
                <CardTitle>Being made</CardTitle>
                <CardDescription>
                  {job ? `Its job ${job.state === "queued" ? "is waiting to start" : "is running"}` : "A job is making it"}
                  {job?.progress?.step ? `: ${job.progress.step}` : ""}
                </CardDescription>
              </div>
              {job && <JobStateBadge state={job.state} />}
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              ParaView is drawing the set on the engine&apos;s computer: its pictures show here as soon as the job has
              made them. This screen asks again every 3 s.
              {job && <> <Link to={to(jobPath(job))} className={LINK}>Follow its job</Link>.</>}
            </CardContent>
          </Card>
        </>
      );
    }
    if (code === "not-found" && job && !working) {
      return (
        <>
          {header}
          <Card>
            <CardHeader className="flex-wrap">
              <div>
                <CardTitle>The pictures weren&apos;t made</CardTitle>
                <CardDescription>Its job {job.state === "cancelled" ? "was cancelled" : "stopped first"}</CardDescription>
              </div>
              <JobStateBadge state={job.state} />
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-danger">
                {job.state === "cancelled" ? "It was cancelled before the set was made."
                  : job.error || `It stopped with exit code ${job.exitCode ?? "?"}.`} See{" "}
                <Link to={to(jobPath(job))} className={LINK}>its job</Link> for its log.
              </p>
            </CardContent>
          </Card>
        </>
      );
    }
    return (
      <>
        {header}
        {code === "not-found" ? (
          <Card>
            <EmptyState icon={Image} title="No such set of pictures">
              The engine has no set {set} of {name}: it may have been deleted.{" "}
              <Link to={to("/pictures")} className={LINK}>See the sets it has</Link>.
            </EmptyState>
          </Card>
        ) : q.isError ? (
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (
          <Card className="p-5">
            <p role="status" className="text-sm text-muted-foreground">Asking the engine for the set…</p>
          </Card>
        )}
      </>
    );
  }

  // The newest job made it again after this set, and didn't.
  const again = job && (job.state === "failed" || job.state === "cancelled") && s.made != null
    && toMillis(job.finished) > toMillis(s.made) ? job : null;
  const kinds = [...s.kinds, ...new Set(s.pictures.map((p) => p.kind).filter((k) => !s.kinds.includes(k)))];

  return (
    <>
      {header}
      {q.isError && !deleting && (
        <ErrorPanel className="mb-4" compact error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      )}
      {working && job && (
        <Card className="mb-4 p-4 text-sm">
          <p>
            <span className="font-medium">Being made again:</span> its job {job.state === "queued" ? "is waiting to start"
              : "is running"}. These are the pictures made before, until it has finished.{" "}
            <Link to={to(jobPath(job))} className={LINK}>Follow its job</Link>.
          </p>
        </Card>
      )}
      {again && (
        <Card className="mb-4 p-4 text-sm">
          <p>
            Its newest job to make it again {again.state === "cancelled" ? "was cancelled" : "failed"}: these are the
            pictures made before. <Link to={to(jobPath(again))} className={LINK}>See its job</Link>.
          </p>
        </Card>
      )}
      {s.notes.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="block">
            <CardTitle>Notes</CardTitle>
            <CardDescription>What the set leaves out, and why.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-pretty">
              {s.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
      {s.pictures.length === 0 && (
        <Card className="mb-4">
          <EmptyState icon={Image} title="This set has no pictures">
            {s.notes.length > 0 ? "The notes above say why." : "The job made none of the kinds it was asked for."}
          </EmptyState>
        </Card>
      )}
      <div className="space-y-4">
        {s.pictures.length > 0 && kinds.map((k) => {
          const info = KINDS.find((x) => x.value === k);
          const of = s.pictures.flatMap((p, i) => (p.kind === k ? [{ p, i }] : []));
          const title = info?.label ?? k;
          return (
            <Section key={k} title={title}>
              <Card>
                <CardHeader className="block">
                  <CardTitle>{title}</CardTitle>
                  {info && <CardDescription>{info.about}</CardDescription>}
                </CardHeader>
                <CardContent>
                  {of.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      None of this kind{s.notes.length > 0 ? ": the notes above say why." : "."}
                    </p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {of.map(({ p, i }) => (
                        // A set made again starts each picture grey, until its new one has loaded.
                        <Thumb key={`${s.made}:${p.file}`} s={s} picture={p} id={idOf(i)} onOpen={() => setViewing(i)} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </Section>
          );
        })}
      </div>
      <Viewer s={s} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} idOf={idOf} />
      <DeleteDialog s={s} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
