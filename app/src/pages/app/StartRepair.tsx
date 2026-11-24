// SPDX-License-Identifier: GPL-3.0-or-later
// Starting a repair from the app: which case, the new run's name, the limits, whether it fits in the memory of the
// engine's computer and on the disk of its workspace, then POST /jobs, and the new job's details on the Jobs screen. The demo can't start jobs: it
// says so and gives the command that does the same in a terminal.
import { Wrench } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Segmented } from "@/components/ui/misc";
import { fullCommand, isPlainName, repairName, type RepairProfile } from "@/engine/commands";
import { useAppPath, useEngine } from "@/engine/context";
import { useCases, useDiskJob, useJobs, useMachine, useRepairs, useStartJob } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive } from "@/engine/types";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DiskNote, FIELD, GB, JobDialog, Note } from "./dialogParts";
import { PROFILES, caseCells, nameProblem, repairMemory, takenNames } from "./repairStart";

/**
 * The repair dialog, for case `source` or, without one, the first case the engine can repair (a list to pick
 * another from). It is made afresh each time it opens, so nothing typed last time stays; the focus goes back to the
 * button that opened it (a case's Repair, or New repair).
 */
export function StartRepairDialog({ open, onOpenChange, source = null }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: string | null;
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <StartRepairForm source={source} onDone={() => onOpenChange(false)} />
    </JobDialog>
  );
}

function StartRepairForm({ source, onDone }: { source: string | null; onDone: () => void }) {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const cases = useCases();
  const repairs = useRepairs();
  const jobs = useJobs();
  const machine = useMachine();
  const start = useStartJob();
  const id = useId();

  const names = cases.data?.items ?? [];
  const [picked, setPicked] = useState<string | null>(source);
  // The case asked for, else the first one the engine can repair by its name.
  const chosen = picked ?? names.find(isPlainName) ?? names[0] ?? null;
  const taken = useMemo(() => takenNames(repairs.data?.items, jobs.data?.items), [repairs.data, jobs.data]);
  // The name follows the case until you type one of your own.
  const [typed, setTyped] = useState<string | null>(null);
  const suggested = chosen && repairs.data ? repairName(chosen, taken) : null;
  const name = typed ?? suggested ?? "";
  const [profile, setProfile] = useState<RepairProfile>("openfoam");

  const plain = chosen !== null && isPlainName(chosen);
  const problem = repairs.data && plain ? nameProblem(name, taken) : null;
  const cells = chosen ? caseCells(chosen, cases.data?.cells, repairs.data?.items) : null;
  const memory = repairMemory(cells, machine.data);
  const busy = jobs.data?.items.find((j) => isActive(j.state));
  const demo = mode === "demo";
  // its copy and what the repair writes, as the engine's disk guard counts them (API 1.12)
  const disk = useDiskJob("repair", !demo && plain && chosen ? { source: chosen } : null);
  const computer = demo ? "the demo engine's computer" : "your engine's computer";
  const Computer = demo ? "The demo engine's computer" : "Your engine's computer";
  const ready = !demo && plain && !!repairs.data && !problem && !busy && !start.isPending;
  const about = PROFILES.find((p) => p.value === profile)?.about;

  const submit = () => {
    if (!ready || !chosen) return;
    start.mutate({ kind: "repair", params: { source: chosen, name, profile } }, {
      onSuccess: (job) => {
        onDone();
        void navigate(to(`/jobs?job=${encodeURIComponent(job.id)}`));
      },
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>{chosen && source ? `Repair ${chosen}` : "Start a repair"}</DialogTitle>
      <DialogDescription>
        The engine copies the case into its workspace, checks the copy with checkMesh, repairs it and checks it again.
        The case itself is never changed.
      </DialogDescription>

      {cases.isError ? (
        <ErrorPanel compact className="mt-4" error={cases.error} onRetry={() => cases.refetch()} retrying={cases.isFetching} />
      ) : cases.isPending ? (
        <p role="status" className="mt-5 text-sm text-muted-foreground">Asking the engine for its cases…</p>
      ) : names.length === 0 ? (
        <div className="mt-5">
          <Note tone="info">
            The engine has no cases yet. It lists the folders with a mesh (constant/polyMesh) in its cases folder; the
            Cases screen says how to add one.
          </Note>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-case`} className="text-sm font-medium">Case</label>
            <select id={`${id}-case`} className={FIELD} value={chosen ?? ""} onChange={(e) => setPicked(e.target.value)}>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <p className="text-xs text-muted-foreground tabular-nums">
              {cells != null ? `${formatInt(cells)} cells` : "Its size isn't known."}
            </p>
            {!plain && chosen && (
              <Note tone="warn">
                The engine can&apos;t repair this case from here: its folder name has characters other than letters,
                digits and _ . -. Rename the folder, or run meshdoctor full with its path in a terminal.
              </Note>
            )}
          </div>

          {plain && (
            <div className="space-y-1.5">
              <label htmlFor={`${id}-name`} className="text-sm font-medium">Name of the new run</label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(e) => setTyped(e.target.value.trim())}
                disabled={!repairs.data}
                placeholder={repairs.data ? undefined : "…"}
                aria-invalid={problem ? true : undefined}
                aria-describedby={`${id}-name-hint`}
                autoComplete="off"
                spellCheck={false}
                className={cn("font-mono text-[13px]", problem && "border-danger")}
              />
              <p id={`${id}-name-hint`} className={cn("text-xs", problem ? "text-danger" : "text-muted-foreground")}>
                {problem ?? (repairs.isError
                  ? "The repair runs didn't load, so the engine can't be sure this name is new."
                  : "Its folder in the engine's workspace, for the copy and everything the repair writes.")}
              </p>
            </div>
          )}

          {plain && (
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">Limits</span>
              <Segmented
                label="Limits"
                value={profile}
                onChange={setProfile}
                options={PROFILES.map((p) => ({ value: p.value, label: p.label }))}
              />
              <p className="text-xs text-muted-foreground">{about}</p>
            </div>
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
                    refuses a repair that won&apos;t fit in its free memory.
                  </Note>
                )
              ) : (
                <Note tone="info">
                  {cells == null ? "The case's size isn't known" : `${Computer} doesn't say how much memory it has`},
                  so the memory isn&apos;t checked here; the engine checks it when the repair starts.
                </Note>
              )}
              <DiskNote disk={disk.data} needs="The copy and its repair need" refuses="a repair" />
              {busy && !demo && (
                <Note tone="warn">
                  {JOB_KIND_LABEL[busy.kind] ?? busy.kind} {busy.name} is {busy.state === "queued" ? "waiting to start" : "running"}.
                  The engine runs one big job at a time, to keep memory safe: start this one when it has finished.
                </Note>
              )}
            </div>
          )}

          {demo && plain && !problem && name && (
            <div className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
              <p className="text-[13px]">
                The demo can&apos;t start jobs. With your own engine paired, Start repair runs this on your computer; in a
                WSL or Linux terminal, this command does the same:
              </p>
              <CopyCommand command={fullCommand(chosen ?? "", name, profile)} />
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
              <Wrench aria-hidden />
              {start.isPending ? "Starting…" : "Start repair"}
            </Button>
          </>
        )}
      </DialogActions>
    </form>
  );
}
