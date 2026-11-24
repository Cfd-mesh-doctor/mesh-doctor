// SPDX-License-Identifier: GPL-3.0-or-later
// Making a new case from the app (API 1.5): a template, its mesh size and the case's name, whether the mesh fits in
// the memory of the engine's computer, then POST /jobs (a `case` job), and the new job's details on the Jobs screen.
// The demo can't start jobs: it says so and gives the command that does the same in a terminal.
import { FolderPlus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { TextWithCode } from "@/components/shared/InlineCode";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Segmented } from "@/components/ui/misc";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useCases, useJobs, useMachine, useStartJob, useTemplates } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive, type TemplateSize } from "@/engine/types";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD, GB, JobDialog, Note } from "./dialogParts";
import { OLD_ENGINE_CASES, checkCaseName, newCaseCommand, suggestName, takenCaseNames } from "./caseStart";
import { stepMemory } from "./repairStart";

/** The New case dialog. It is made afresh each time it opens, so nothing picked or typed last time stays. */
export function NewCaseDialog({ open, onOpenChange, preset }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template and mesh size picked when it opens (Try it on the Ahmed body's), else the first template's own. */
  preset?: { template: string; size: TemplateSize["name"] };
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <NewCaseForm onDone={() => onOpenChange(false)} preset={preset} />
    </JobDialog>
  );
}

function NewCaseForm({ onDone, preset }: { onDone: () => void; preset?: { template: string; size: TemplateSize["name"] } }) {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const templates = useTemplates();
  const cases = useCases();
  const jobs = useJobs();
  const machine = useMachine();
  const start = useStartJob();
  const id = useId();

  const list = templates.data?.items ?? [];
  const [picked, setPicked] = useState<string | null>(preset?.template ?? null);
  const template = list.find((t) => t.name === picked) ?? list[0] ?? null;
  // The size picked, while the template has it; else the template's own.
  const [sized, setSized] = useState<TemplateSize["name"] | null>(preset?.size ?? null);
  const size = template?.sizes.find((s) => s.name === sized) ?? template?.sizes.find((s) => s.name === template.size)
    ?? template?.sizes[0] ?? null;
  const taken = useMemo(() => takenCaseNames(cases.data?.items, jobs.data?.items), [cases.data, jobs.data]);
  // The name follows the template and its size until you type one of your own.
  const [typed, setTyped] = useState<string | null>(null);
  const suggested = template && size && cases.data ? suggestName(template, size.name, taken) : null;
  const name = typed ?? suggested ?? "";
  const check = cases.data ? checkCaseName(name, cases.data.items, jobs.data?.items ?? []) : { problem: null, again: null };

  const memory = stepMemory("snappy", size?.cells ?? null, machine.data);
  const busy = jobs.data?.items.find((j) => isActive(j.state));
  const demo = mode === "demo";
  const computer = demo ? "the demo engine's computer" : "your engine's computer";
  const Computer = demo ? "The demo engine's computer" : "Your engine's computer";
  const old = templates.isError && !templates.data && asEngineError(templates.error).code === "not-found";
  const ready = !demo && !!template && !!size && !!cases.data && !check.problem && !busy && !start.isPending;

  const submit = () => {
    if (!ready || !template || !size) return;
    start.mutate(
      { kind: "case", params: { template: template.name, size: size.name, name, replace: check.again !== null } },
      { onSuccess: (job) => { onDone(); void navigate(to(`/jobs?job=${encodeURIComponent(job.id)}`)); } },
    );
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>New case</DialogTitle>
      <DialogDescription>
        The engine copies a template into its cases folder under a new name, makes its geometry and meshes it on one
        core: a few minutes. The case then shows on Cases, ready for a repair and an A/B test. A case you made is never
        changed.
      </DialogDescription>

      {old ? (
        <p className="mt-5 text-sm text-muted-foreground"><TextWithCode text={OLD_ENGINE_CASES} /></p>
      ) : templates.isError ? (
        <ErrorPanel compact className="mt-4" error={templates.error} onRetry={() => templates.refetch()}
          retrying={templates.isFetching} />
      ) : templates.isPending ? (
        <p role="status" className="mt-5 text-sm text-muted-foreground">Asking the engine for its templates…</p>
      ) : !template || !size ? (
        <div className="mt-5">
          <Note tone="info">
            The engine has no templates: they are the examples folder of its Mesh Doctor folder, which is missing there.
          </Note>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-template`} className="text-sm font-medium">Template</label>
            <select id={`${id}-template`} className={FIELD} value={template.name} onChange={(e) => setPicked(e.target.value)}>
              {list.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{template.about}</p>
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Mesh</span>
            {template.sizes.length > 1 && (
              <Segmented label="Mesh" value={size.name} onChange={setSized}
                options={template.sizes.map((s) => ({ value: s.name, label: s.label }))} />
            )}
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">About {formatInt(size.cells)} cells</span>: {size.about}.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">Name of the new case</label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setTyped(e.target.value.trim())}
              disabled={!cases.data}
              placeholder={cases.data ? undefined : "…"}
              aria-invalid={check.problem ? true : undefined}
              aria-describedby={`${id}-name-hint`}
              autoComplete="off"
              spellCheck={false}
              className={cn("font-mono text-[13px]", check.problem && "border-danger")}
            />
            <p id={`${id}-name-hint`} className={cn("text-xs", check.problem ? "text-danger" : "text-muted-foreground")}>
              {check.problem ?? (check.again
                ? `A new case with this name ${check.again.state === "failed" ? "failed" : "was cancelled"} before its `
                  + "mesh was made. Making it again deletes what it left first."
                : cases.isError
                  ? "The cases didn't load, so the engine can't be sure this name is new."
                  : "Its folder in the engine's cases folder.")}
            </p>
          </div>

          <div className="space-y-2">
            {memory ? (
              memory.fits ? (
                <Note tone="ok">
                  Its mesh needs about <GB value={memory.need} /> of memory; {computer} has <GB value={memory.have} />
                  {memory.limited ? " (its RAM limit)" : ""}.
                </Note>
              ) : (
                <Note tone="warn">
                  Its mesh needs about <GB value={memory.need} /> of memory, more than {computer} can give it: a job may
                  use 90&nbsp;% of its <GB value={memory.have} />{memory.limited ? " (its RAM limit)" : ""}. The engine
                  refuses a mesh that won&apos;t fit in its free memory.
                </Note>
              )
            ) : (
              <Note tone="info">
                {Computer} doesn&apos;t say how much memory it has, so the memory isn&apos;t checked here; the engine
                checks it when the case starts.
              </Note>
            )}
            {busy && !demo && (
              <Note tone="warn">
                {JOB_KIND_LABEL[busy.kind] ?? busy.kind} {busy.name} is {busy.state === "queued" ? "waiting to start" : "running"}.
                The engine runs one big job at a time, to keep memory safe: make this case when it has finished.
              </Note>
            )}
          </div>

          {demo && !check.problem && name && (
            <div className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
              <p className="text-[13px]">
                The demo can&apos;t start jobs. With your own engine paired, Make case runs this on your computer; in a
                WSL or Linux terminal, this command does the same:
              </p>
              <CopyCommand command={newCaseCommand(template, size.name, name)} />
            </div>
          )}
        </div>
      )}

      {start.isError && <ErrorPanel compact className="mt-4" error={start.error} />}

      <DialogActions>
        {demo || old ? (
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        ) : (
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={!ready}>
              <FolderPlus aria-hidden />
              {start.isPending ? "Starting…" : check.again ? "Make it again" : "Make case"}
            </Button>
          </>
        )}
      </DialogActions>
    </form>
  );
}
