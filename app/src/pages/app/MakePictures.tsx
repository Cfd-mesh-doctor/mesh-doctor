// SPDX-License-Identifier: GPL-3.0-or-later
// Making a set of pictures from the app: which run or case, the written time, the kinds and, for a transient run that
// has averaged its flow, its mean flow; whether it fits in the memory of the engine's computer and on the disk of its
// workspace; then POST /jobs (a `pictures` job) and the new job on the Jobs screen, which links its set. The demo
// can't start jobs: it says so and gives the command that does the same in a terminal.
import { ImagePlus } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isPlainName, picturesCommand } from "@/engine/commands";
import { useAppPath, useEngine } from "@/engine/context";
import { useCases, useDiskJob, useJobs, useMachine, useReadiness, useRuns, useStartJob } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive, type PictureKind, type Run } from "@/engine/types";
import { formatInt } from "@/lib/format";
import { DiskNote, FIELD, GB, JobDialog, Note } from "./dialogParts";
import { KINDS, hasMeanFlow, pictureTimes, picturesMemory } from "./pictureSets";
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

/** A run with a result to picture: one that isn't solving, with a joined written time. */
const pictureable = (r: Run) => r.state !== "running" && (r.joined?.length ?? 0) > 0;

function MakePicturesForm({ name, onDone }: { name: string | null; onDone: () => void }) {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const runs = useRuns(false);
  const cases = useCases();
  const jobs = useJobs();
  const machine = useMachine();
  const readiness = useReadiness();
  const start = useStartJob();
  const id = useId();
  const demo = mode === "demo";

  const solved = (runs.data?.items ?? []).filter(pictureable);
  const made = cases.data?.made ?? {};
  // A case you made: in the cases folder, not made by Mesh Doctor. Whether it has a result the engine says at start.
  const yours = (cases.data?.items ?? []).filter((c) => !(c in made));
  const [picked, setPicked] = useState<string | null>(name);
  const chosen = picked ?? solved[0]?.name ?? yours[0] ?? null;
  const run = (runs.data?.items ?? []).find((r) => r.name === chosen);
  const [mean, setMean] = useState(false);
  const withMean = mean && hasMeanFlow(run);
  const times = run ? pictureTimes(run, withMean) : [];
  const [time, setTime] = useState("");
  // the time chosen, while the run (and the mean flow or not) still has it; else the latest
  const at = times.includes(time) ? time : "";
  const [kinds, setKinds] = useState<readonly PictureKind[]>(KINDS.map((k) => k.value));
  const toggle = (k: PictureKind, on: boolean) =>
    setKinds((now) => KINDS.map((x) => x.value).filter((v) => (v === k ? on : now.includes(v))));

  const plain = chosen !== null && isPlainName(chosen);
  const solving = run?.state === "running";
  const nothing = run != null && !solving && times.length === 0;
  const cells = chosen ? cases.data?.cells?.[chosen] ?? null : null;
  const memory = picturesMemory(cells, machine.data);
  const busy = jobs.data?.items.find((j) => isActive(j.state));
  const paraview = readiness.data?.checks.find((c) => c.id === "pvbatch");
  const query = !demo && plain && chosen && kinds.length > 0
    ? { name: chosen, time: at, kinds: kinds.join(","), mean: String(withMean) } : null;
  // the set's pictures, as the engine's disk guard counts them (API 1.18)
  const disk = useDiskJob("pictures", query);
  const computer = demo ? "the demo engine's computer" : "your engine's computer";
  const ready = !demo && plain && !solving && !nothing && kinds.length > 0 && !busy && !start.isPending;
  const command = chosen ? picturesCommand(chosen, { time: at || undefined, kinds, mean: withMean }) : null;
  const options = solved.length + yours.length;

  const submit = () => {
    if (!ready || !chosen) return;
    start.mutate({ kind: "pictures", params: { name: chosen, time: at, kinds: kinds.join(","), mean: withMean } }, {
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
        workspace. The case itself is only read.
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
                    <option value="">The latest{times[0] ? ` (${times[0]})` : ""}</option>
                    {times.slice(1).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {solving ? "It is solving: picture it once it has stopped or finished."
                      : nothing ? (withMean ? "No time with its mean flow is joined yet." : "It has no joined time yet.")
                      : (run.times?.length ?? 0) > (run.joined?.length ?? 0)
                      ? "Its other times are split on its processes: only a joined time can be pictured for now."
                      : "As its folder names it."}
                  </p>
                </>
              ) : (
                <>
                  <span className="block text-sm font-medium">Written time</span>
                  <p className="text-[13px] text-muted-foreground">
                    The latest with U and p on its whole mesh. The engine says if it has none.
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
              {kinds.length === 0 && <p className="text-xs text-danger">Pick at least one.</p>}
            </fieldset>
          )}

          {plain && (
            <div className="space-y-2">
              {memory ? (
                memory.fits ? (
                  <Note tone="ok">
                    Needs about <GB value={memory.need} /> of memory; {computer} has <GB value={memory.have} />
                    {memory.limited ? " (its RAM limit)" : ""}.
                  </Note>
                ) : (
                  <Note tone="warn">
                    Needs about <GB value={memory.need} /> of memory, more than {computer} can give it: a job may use
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
              <DiskNote disk={disk.data} needs="The set of pictures needs" refuses="a picture job" />
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

          {demo && plain && command && kinds.length > 0 && (
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
