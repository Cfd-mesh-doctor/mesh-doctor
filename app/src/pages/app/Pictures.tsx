// SPDX-License-Identifier: GPL-3.0-or-later
// The sets of pictures of the flow in the engine's workspace (GET /pictures, API 1.17), newest first: each one's case,
// what it pictures (a written time, or a transient run's mean flow), its kinds and how many pictures it has, and the
// job making one now. Make pictures… starts a picture job (MakePictures.tsx); a set opens on its own page
// (PictureSet.tsx), and a run's page lists its own sets (RunPicturesCard). While a picture job waits or runs, the
// sets are asked for every 3 s.
import { CircleCheck, Image, ImagePlus, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { JobStateBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useJobs, usePictureSets } from "@/engine/hooks";
import type { PictureSetBrief } from "@/engine/types";
import { formatCount, formatDateTime, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { MakePicturesDialog } from "./MakePictures";
import { kindsText, makingPictures, setHeading, setPath, setShown, setTitle } from "./pictureSets";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** What a set's state is: the state of the job making it, or Made; a set made again by a job that failed or was
 * cancelled says so beside it (the pictures made before are still there). */
function SetState({ s }: { s: PictureSetBrief }) {
  const shown = setShown(s);
  if (shown === "making") return <JobStateBadge state={s.job?.state ?? "running"} />;
  if (shown !== "made") return <JobStateBadge state={shown} />;
  return (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      Made
    </Badge>
  );
}

/** A set's second line: its kinds, and how its last job to make it again ended when that didn't work. */
function about(s: PictureSetBrief): string {
  const again = s.made && (s.job?.state === "failed" || s.job?.state === "cancelled")
    ? ` · made again: its job ${s.job.state === "failed" ? "failed" : "was cancelled"}` : "";
  return `${kindsText(s.kinds)}${again}`;
}

/** An engine without the picture routes (before API 1.17) answers not-found. */
const tooOld = (q: { isError: boolean; error: unknown }) => q.isError && asEngineError(q.error).code === "not-found";

function NoPicturesYet({ onStart }: { onStart: () => void }) {
  const to = useAppPath();
  return (
    <EmptyState
      icon={Image}
      title="No pictures yet"
      action={(
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={onStart}><ImagePlus aria-hidden /> Make pictures…</Button>
          <Button variant="secondary" size="sm" asChild>
            <Link to={to("/solve")}><Play aria-hidden /> Go to Solve</Link>
          </Button>
        </div>
      )}
    >
      Make a set of a solved run, or of a case of yours with a result: ParaView draws its flow on the engine&apos;s
      computer, and the set shows here once its job has made it. A run&apos;s page on the Solve screen makes them too.
    </EmptyState>
  );
}

export function Pictures() {
  useTitle("Pictures");
  const to = useAppPath();
  const jobs = useJobs();
  const sets = usePictureSets(makingPictures(jobs.data?.items));
  const [starting, setStarting] = useState(false);
  const old = tooOld(sets);
  const items = sets.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Pictures"
        description={
          <>
            Pictures of the flow of a solved case, drawn by ParaView on the engine&apos;s computer: plane cuts, the
            vortices and the spots of unphysical pressure, at a written time, or of a transient run&apos;s mean flow.
            They go in the engine&apos;s workspace; the case is only read. A run&apos;s page on the{" "}
            <Link to={to("/solve")} className={LINK}>Solve screen</Link> lists its own.
          </>
        }
        actions={
          <>
            {sets.data && (
              <span className="text-[13px] text-muted-foreground">
                Updated {formatRelative(new Date(sets.dataUpdatedAt).toISOString())}
              </span>
            )}
            <Button size="sm" onClick={() => setStarting(true)} disabled={old}>
              <ImagePlus aria-hidden /> Make pictures…
            </Button>
          </>
        }
      />
      {sets.isError && !old && (
        <ErrorPanel className="mb-6" error={sets.error} onRetry={() => sets.refetch()} retrying={sets.isFetching} />
      )}
      <Card>
        {sets.isPending ? (
          <TableSkeleton rows={4} cols={4} />
        ) : old ? (
          <EmptyState icon={Image} title="Your engine can't make pictures yet">
            It is older than the Pictures screen (it speaks API 1.16 or older). Update Mesh Doctor on your computer,
            then make them here.
          </EmptyState>
        ) : !items.length ? (
          // A list that didn't load isn't empty: the message above says why, and no first step is offered.
          sets.isError ? <EmptyState icon={Image} title="The pictures didn't load" /> : <NoPicturesYet onStart={() => setStarting(true)} />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {/* As on the Repairs screen: Pictures shows from md, Made and the link from sm. On phones the
                    set's name is its link. */}
                <TH>Set</TH>
                <TH>State</TH>
                <TH className="hidden text-right md:table-cell">Pictures</TH>
                <TH className="hidden sm:table-cell">Made</TH>
                <TH className="hidden text-right sm:table-cell"><span className="sr-only">Open</span></TH>
              </TR>
            </THead>
            <TBody>
              {items.map((s) => {
                const path = to(setPath(s.case, s.set));
                const heading = `${s.case}, ${setTitle(s)}`;
                return (
                  <TR key={`${s.case}/${s.set}`}>
                    <TD>
                      <Link to={path} className="font-medium wrap-anywhere underline-offset-4 hover:underline">{s.case}</Link>
                      <div className="text-xs text-muted-foreground wrap-anywhere">
                        {setHeading(s)} · {about(s)}
                      </div>
                    </TD>
                    <TD><SetState s={s} /></TD>
                    <TD className="hidden text-right text-[13px] tabular-nums md:table-cell">
                      {s.count == null ? "–" : s.count}
                    </TD>
                    <TD className="hidden text-[13px] whitespace-nowrap text-muted-foreground sm:table-cell"
                      title={s.made ? formatDateTime(s.made) : undefined}>
                      {s.made ? formatRelative(s.made) : "Being made"}
                    </TD>
                    <TD className="hidden text-right sm:table-cell">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={path} aria-label={`Open the pictures of ${heading}`}>Open</Link>
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <MakePicturesDialog open={starting} onOpenChange={setStarting} />
    </>
  );
}

/**
 * A run's sets of pictures, on its page: each one's time, kinds and pictures, linked to its page, and Make pictures…
 * of it. An engine without the picture routes says so.
 */
export function RunPicturesCard({ name }: { name: string }) {
  const to = useAppPath();
  const jobs = useJobs();
  const sets = usePictureSets(makingPictures(jobs.data?.items, name), name);
  const [open, setOpen] = useState(false);
  const old = tooOld(sets);
  const items = sets.data?.items ?? [];
  return (
    <Card className="mt-4">
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Pictures of its flow</CardTitle>
          <CardDescription>
            Plane cuts, the vortices and the spots of unphysical pressure, drawn by ParaView on the engine&apos;s
            computer at a written time. Every set of every case is on the{" "}
            <Link to={to("/pictures")} className={LINK}>Pictures screen</Link>.
          </CardDescription>
        </div>
        {!old && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <ImagePlus aria-hidden /> Make pictures…
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {old ? (
          <p className="text-sm text-muted-foreground">
            Your engine is older than the pictures (it speaks API 1.16 or older): update Mesh Doctor to make them here.
          </p>
        ) : sets.isError ? (
          <ErrorPanel compact error={sets.error} onRetry={() => void sets.refetch()} retrying={sets.isFetching} />
        ) : sets.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">Asking the engine for its pictures…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet: Make pictures… draws its flow at its latest written time.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((s) => (
              <li key={s.set} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link to={to(setPath(s.case, s.set))} className={LINK}>{setHeading(s)}</Link>
                  <div className="text-xs text-muted-foreground">
                    {about(s)}
                    {s.count != null && ` · ${formatCount(s.count, "picture")}`}
                    {s.made && <> · <span title={formatDateTime(s.made)}>made {formatRelative(s.made)}</span></>}
                  </div>
                </div>
                <SetState s={s} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <MakePicturesDialog open={open} onOpenChange={setOpen} name={name} />
    </Card>
  );
}
