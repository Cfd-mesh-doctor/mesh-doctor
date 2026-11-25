// SPDX-License-Identifier: GPL-3.0-or-later
// Making a set of pictures from the app: which run or case, the written time, the kinds and, for a transient run that
// has averaged its flow, its mean flow; whether it fits in the memory of the engine's computer and on the disk of its
// workspace; then POST /jobs (a `pictures` job) and the new job on the Jobs screen, which links its set. A time still
// split onto a run's processes is joined first, into the run's own folder (API 1.19), and the disk this takes is said
// first. A run with two or more written times up to the one pictured can have a cut over time too (API 1.20): the
// first cut at each of them, and, on an engine at API 1.21, the cells that set the time step, from a written time's own
// flow (not a mean flow). The demo can't start jobs: it says so and gives the command that does the same in a
// terminal.
import { ImagePlus } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isPlainName, picturesCommand } from "@/engine/commands";
import { useAppPath, useEngine } from "@/engine/context";
import {
  useCases, useDiskJob, useEngineInfo, useJobs, useMachine, useReadiness, useRuns, useStartJob,
} from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive, type DiskPictures, type PictureKind, type Run } from "@/engine/types";
import { formatInt } from "@/lib/format";
import { DiskNote, FIELD, GB, JobDialog, Note } from "./dialogParts";
import {
  FASTEST, KINDS, MAX_TIMES, drawsFastest, hasMeanFlow, joinsTimes, makesOverTime, overTimes, pictureTimes,
  picturesMemory, splitTimes,
} from "./pictureSets";
import { formatTime } from "./solveStart";

/**
 * The picture dialog, for case `name` (a run's page) or, without one, the newest run that has a result (a list to
 * pick another run or a case you made from). It is made afresh each time it opens, so nothing chosen last time stays.
 */
export function MakePicturesDialog({ open, onOpenChange, name = null }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name?: string | null;
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <MakePicturesForm name={name} onDone={() => onOpenChange(false)} />
    </JobDialog>
  );
}

/** Every kind a picture job makes, in the engine's order: those of KINDS, a cut over time (API 1.20) and the cells
 * that set the time step (API 1.21). */
const ALL_KINDS: readonly PictureKind[] = [...KINDS.map((k) => k.value), "times", "fastest"];

/** What a cut over time of a run pictures: the first cut at each written time up to the one pictured, at most
 * MAX_TIMES, and how those split onto its processes are read. */
function overTimeAbout(o: { times: string[]; split: boolean }, mean: boolean): string {
  const n = o.times.length;
  const span = `${o.times[0]} to ${o.times.at(-1)}`;
  const which = n > MAX_TIMES ? `${MAX_TIMES} of its ${n} written times from ${span}, evenly picked`
    : `each of its ${n} written times from ${span}`;
  return `The first cut's ${mean ? "mean speed" : "speed"} at ${which}, oldest first: `
    + `${mean ? "the average as it settles" : "the flow as it changes"}.`
    + (o.split ? " Those split onto its processes are read as they are: none is joined for it." : "");
}

/** A run with a result to picture: one that isn't solving, with a written time (a joined one, on an engine that
 * doesn't join a split one first). */
const pictureable = (r: Run, joins: boolean) =>
  r.state !== "running" && ((joins ? r.times ?? r.joined : r.joined)?.length ?? 0) > 0;

/**
 * What a picture job takes on the disk, as the engine's guard counts it: its set of pictures in the workspace and,
 * when it joins a split time first (API 1.19), that time in the run's own folder; the two together when they are on
 * one disk.
 */
function PicturesDisk({ disk }: { disk: DiskPictures | undefined }) {
  const set = <DiskNote disk={disk} needs="The set of pictures needs" refuses="a picture job" />;
  const join = disk?.join;
  if (!disk || !join || join.needMb == null) return set;
  const joining = `Joining written time ${join.time} from its ${join.processes} processes into the run's folder`;
  if (join.sameDisk) {
    return disk.needMb == null ? set : (
      <DiskNote disk={{ ...disk, needMb: disk.needMb + join.needMb }} needs={`${joining} and the set of pictures need`}
        refuses="a picture job" />
    );
  }
  return (
    <>
      {set}
      <DiskNote disk={{ needMb: join.needMb, freeMb: join.freeMb, keepMb: disk.keepMb, folder: "cases" }}
        needs={`${joining} needs`} refuses="a picture job" />
    </>
  );
}

function MakePicturesForm({ name, onDone }: { name: string | null; onDone: () => void }) {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const runs = useRuns(false);
  const cases = useCases();
  const jobs = useJobs();
  const machine = useMachine();
  const readiness = useReadiness();
  const info = useEngineInfo();
  const start = useStartJob();
  const id = useId();
  const demo = mode === "demo";
  // an engine that joins a time still split onto a run's processes, to picture it (API 1.19)
  const joins = joinsTimes(info.data?.apiVersion);

  const solved = (runs.data?.items ?? []).filter((r) => pictureable(r, joins));
  const made = cases.data?.made ?? {};
  // A case you made: in the cases folder, not made by Mesh Doctor. Whether it has a result the engine says at start.
  const yours = (cases.data?.items ?? []).filter((c) => !(c in made));
  const [picked, setPicked] = useState<string | null>(name);
  const chosen = picked ?? solved[0]?.name ?? yours[0] ?? null;
  const run = (runs.data?.items ?? []).find((r) => r.name === chosen);
  const [mean, setMean] = useState(false);
  const withMean = mean && hasMeanFlow(run);
  const times = run ? pictureTimes(run, withMean, joins) : [];
  const split = run && joins ? splitTimes(run) : new Set<string>();
  const [time, setTime] = useState("");
  // the time chosen, while the run (and the mean flow or not) still has it; else the latest
  const at = times.includes(time) ? time : "";
  // the time the job pictures is split onto the run's processes: it is joined first
  const joinsFirst = split.has(at || times[0] || "");
  const [kinds, setKinds] = useState<readonly PictureKind[]>(KINDS.map((k) => k.value));
  const toggle = (k: PictureKind, on: boolean) => setKinds((now) => ALL_KINDS.filter((v) => (v === k ? on : now.includes(v))));
  // a cut over time (API 1.20): the first cut at each written time up to the one pictured, of a run with two or more
  const overTime = run && makesOverTime(info.data?.apiVersion) ? overTimes(run, at || times[0] || "", withMean) : null;
  const canOverTime = overTime != null && overTime.times.length > 1;
  // the cells that set the time step (API 1.21): from a written time's own flow, so not of a mean flow
  const canFastest = drawsFastest(info.data?.apiVersion) && !withMean;
  // what the job is asked for: the kinds ticked, a cut over time while the run has the times for it, and the cells
  // that set the time step while they can be drawn
  const asked = kinds.filter((k) => (k !== "times" || canOverTime) && (k !== "fastest" || canFastest));
  const readOverTime = asked.includes("times") && overTime ? (overTime.split ? "split" : "joined") : null;

  const plain = chosen !== null && isPlainName(chosen);
  const solving = run?.state === "running";
  const nothing = run != null && !solving && times.length === 0;
  const cells = chosen ? cases.data?.cells?.[chosen] ?? null : null;
  const memory = picturesMemory(cells, machine.data, readOverTime);
  const busy = jobs.data?.items.find((j) => isActive(j.state));
  const paraview = readiness.data?.checks.find((c) => c.id === "pvbatch");
  const query = !demo && plain && chosen && asked.length > 0
    ? { name: chosen, time: at, kinds: asked.join(","), mean: String(withMean) } : null;
  // the set's pictures, as the engine's disk guard counts them (API 1.18), and a time it joins first (API 1.19)
  const disk = useDiskJob("pictures", query);
  const pictureDisk: DiskPictures | undefined = disk.data;
  const computer = demo ? "the demo engine's computer" : "your engine's computer";
  const ready = !demo && plain && !solving && !nothing && asked.length > 0 && !busy && !start.isPending;
  const command = chosen ? picturesCommand(chosen, { time: at || undefined, kinds: asked, mean: withMean }) : null;
  const options = solved.length + yours.length;

  const submit = () => {
    if (!ready || !chosen) return;
    start.mutate({ kind: "pictures", params: { name: chosen, time: at, kinds: asked.join(","), mean: withMean } }, {
      onSuccess: (job) => {
        onDone();
        void navigate(to(`/jobs?job=${encodeURIComponent(job.id)}`));
      },
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>{name ? `Make pictures of ${name}` : "Make pictures"}</DialogTitle>
      <DialogDescription>
        ParaView draws the flow offscreen, at a written time of a solved case, and the pictures go in the engine&apos;s
        workspace. {joinsFirst ? "The run itself only gets the time joined into its folder." : "The case itself is only read."}
      </DialogDescription>

      {runs.isError && cases.isError ? (
        <ErrorPanel compact className="mt-4" error={cases.error} onRetry={() => { void runs.refetch(); void cases.refetch(); }}
          retrying={cases.isFetching} />
      ) : runs.isPending || cases.isPending ? (
        <p role="status" className="mt-5 text-sm text-muted-foreground">Asking the engine for its runs and cases…</p>
      ) : options === 0 && !run ? (
        <div className="mt-5">
          <Note tone="info">
            The engine has nothing to picture yet: a solved run, or a case of yours with a written result. Solve a case
            on the Solve screen first.
          </Note>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-case`} className="text-sm font-medium">Run or case</label>
            <select id={`${id}-case`} className={FIELD} value={chosen ?? ""} onChange={(e) => setPicked(e.target.value)}>
              {chosen && !solved.some((r) => r.name === chosen) && !yours.includes(chosen) && (
                <option value={chosen}>{chosen}</option>
              )}
              {solved.length > 0 && (
                <optgroup label="Runs">
                  {solved.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                </optgroup>
              )}
              {yours.length > 0 && (
                <optgroup label="Cases you made">
                  {yours.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              )}
            </select>
            <p className="text-xs text-muted-foreground tabular-nums">
              {cells != null ? `${formatInt(cells)} cells` : "Its size isn't known."}
            </p>
            {!plain && chosen && (
              <Note tone="warn">
                The engine can&apos;t picture this case from here: its folder name has characters other than letters,
                digits and _ . -. Rename the folder, or run meshdoctor pictures with its path in a terminal.
              </Note>
            )}
          </div>

          {plain && run && hasMeanFlow(run) && (
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" checked={mean} onChange={(e) => setMean(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary" />
              <span>
                <span className="font-medium">Its mean flow</span>
                <span className="block text-xs text-muted-foreground">
                  The flow averaged {run.averaging?.from != null ? `from ${formatTime(run.averaging.from)} ` : ""}(UMean
                  and pMean), in place of the flow at that time: what the forces average, without the swings of the
                  moment.
                </span>
              </span>
            </label>
          )}

          {plain && (
            <div className="space-y-1.5">
              {run ? (
                <>
                  <label htmlFor={`${id}-time`} className="text-sm font-medium">Written time</label>
                  <select id={`${id}-time`} className={FIELD} value={at} onChange={(e) => setTime(e.target.value)}
                    disabled={times.length === 0}>
                    <option value="">
                      The latest{times[0] ? ` (${times[0]}${split.has(times[0]) ? ", split" : ""})` : ""}
                    </option>
                    {times.slice(1).map((t) => <option key={t} value={t}>{split.has(t) ? `${t} (split)` : t}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {solving ? "It is solving: picture it once it has stopped or finished."
                      : nothing ? (withMean ? `No time with its mean flow is ${joins ? "written" : "joined"} yet.`
                        : `It has no ${joins ? "written" : "joined"} time yet.`)
                      : joinsFirst
                      ? `It is split onto ${run.nProcs ? `its ${run.nProcs}` : "its"} processes: the job joins it `
                        + "first, into the run's own folder, as the solve joins its latest, and the run then lists it "
                        + "as joined."
                      : !joins && (run.times?.length ?? 0) > (run.joined?.length ?? 0)
                      ? "Its other times are split onto its processes: update Mesh Doctor (git pull) and restart it "
                        + "to picture them too."
                      : "As its folder names it."}
                  </p>
                </>
              ) : (
                <>
                  <span className="block text-sm font-medium">Written time</span>
                  <p className="text-[13px] text-muted-foreground">
                    {joins
                      ? "The latest with U and p, on its whole mesh or split onto its processes: a split one is read as "
                        + "it is, as a case you made is only read. The engine says if it has none."
                      : "The latest with U and p on its whole mesh. The engine says if it has none."}
                  </p>
                </>
              )}
            </div>
          )}

          {plain && (
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">What to make</legend>
              {KINDS.map((k) => (
                <label key={k.value} className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" checked={kinds.includes(k.value)} onChange={(e) => toggle(k.value, e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary" />
                  <span>
                    <span className="font-medium">{k.label}</span>
                    <span className="block text-xs text-muted-foreground">{k.about}</span>
                  </span>
                </label>
              ))}
              {canOverTime && (
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" checked={kinds.includes("times")} onChange={(e) => toggle("times", e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary" />
                  <span>
                    <span className="font-medium">A cut over time</span>
                    <span className="block text-xs text-muted-foreground">{overTimeAbout(overTime, withMean)}</span>
                  </span>
                </label>
              )}
              {canFastest && (
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" checked={kinds.includes("fastest")} onChange={(e) => toggle("fastest", e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary" />
                  <span>
                    <span className="font-medium">{FASTEST.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      The 100 cells with the highest Courant number at that written time, as a transient plan finds
                      them: in red with the walls from three sides, then the three fastest places close up. They need
                      the time&apos;s face flux (phi) and Mesh Doctor&apos;s foamCourantCells; the set says if
                      they aren&apos;t found.
                    </span>
                  </span>
                </label>
              )}
              {asked.length === 0 && <p className="text-xs text-danger">Pick at least one.</p>}
            </fieldset>
          )}

          {plain && (
            <div className="space-y-2">
              {memory ? (
                memory.fits ? (
                  <Note tone="ok">
                    Needs about <GB value={memory.need} /> of memory
                    {readOverTime ? " (the cut over time holds two of its written times at once)" : ""}; {computer} has{" "}
                    <GB value={memory.have} />{memory.limited ? " (its RAM limit)" : ""}.
                  </Note>
                ) : (
                  <Note tone="warn">
                    Needs about <GB value={memory.need} /> of memory
                    {readOverTime ? " (the cut over time holds two of its written times at once)" : ""}, more than{" "}
                    {computer} can give it: a job may use
                    90&nbsp;% of its <GB value={memory.have} />{memory.limited ? " (its RAM limit)" : ""}. The engine
                    refuses a picture job that won&apos;t fit in its free memory.
                  </Note>
                )
              ) : (
                <Note tone="info">
                  {cells == null ? "The case's size isn't known" : "The engine's computer doesn't say how much memory it has"},
                  so the memory isn&apos;t checked here; the engine checks it when the job starts.
                </Note>
              )}
              <PicturesDisk disk={pictureDisk} />
              {paraview && paraview.state !== "ok" && (
                <Note tone="warn">
                  ParaView isn&apos;t ready on {computer}: {paraview.found}. Ready to solve? on the Solve screen says how to
                  install it.
                </Note>
              )}
              {busy && !demo && (
                <Note tone="warn">
                  {JOB_KIND_LABEL[busy.kind] ?? busy.kind} {busy.name} is {busy.state === "queued" ? "waiting to start" : "running"}.
                  The engine runs one big job at a time, to keep memory safe: start this one when it has finished.
                </Note>
              )}
            </div>
          )}

          {demo && plain && command && asked.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
              <p className="text-[13px]">
                The demo can&apos;t start jobs. With your own engine paired, Make pictures runs this on your computer; in a
                WSL or Linux terminal, this command does the same:
              </p>
              <CopyCommand command={command} />
            </div>
          )}
        </div>
      )}

      {start.isError && <ErrorPanel compact className="mt-4" error={start.error} />}

      <DialogActions>
        {demo ? (
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        ) : (
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={!ready}>
              <ImagePlus aria-hidden />
              {start.isPending ? "Starting…" : "Make pictures"}
            </Button>
          </>
        )}
      </DialogActions>
    </form>
  );
}
