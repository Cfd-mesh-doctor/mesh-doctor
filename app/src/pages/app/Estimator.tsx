// SPDX-License-Identifier: GPL-3.0-or-later
// The size estimator inside the app: the public page's form, with the memory and the solver ranks of the computer
// the engine runs on filled in (GET /machine). An engine too old to say keeps the example's values, and says so.
import { skipToken, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page";
import { Card } from "@/components/ui/card";
import { api } from "@/engine/client";
import { useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { DEFAULTS } from "@/estimate/estimate";
import { machineFields } from "@/estimate/machine";
import { formatInt } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { EstimateForm } from "@/pages/estimate/Estimate";

// The copied link isn't this screen's address but the site's estimator's, with these values in it: say so.
const KEEPS = "The address keeps your changes, and Copy link gives a link to this estimate that anyone can open.";

export function Estimator() {
  useTitle("Size estimator");
  const { transport, mode } = useEngine();
  const machine = useQuery({
    queryKey: [transport?.scope, "machine"],
    queryFn: transport ? ({ signal }) => api.machine(transport, signal) : skipToken,
    staleTime: 5 * 60_000,
  });
  const fields = machine.data ? machineFields(machine.data) : {};
  const known = [
    fields.ram !== undefined && `${fields.ram} GB of memory${fields.limited ? " (its RAM limit)" : ""}`,
    fields.cores !== undefined && `${formatInt(fields.cores)} cores`,
  ].filter((x) => x !== false);

  let about: string;
  if (machine.isError) {
    const e = asEngineError(machine.error);
    about = e.code === "not-found"
      ? "Your engine is older than this page and doesn't say what its computer has, so these are the example's " +
        `values. Update Mesh Doctor (git pull) and restart it to fill them in. ${KEEPS}`
      : `The engine didn't say what its computer has (${e.message}), so these are the example's values. ${KEEPS}`;
  } else if (known.length === 0) {
    about = `The engine can't tell its computer's memory or cores, so these are the example's values. ${KEEPS}`;
  } else {
    const who = mode === "demo" ? "the demo engine's computer" : "your engine's computer";
    about = `From ${who}: ${known.join(" and ")}${known.length < 2 ? "; the rest is the example's" : ""}. ${KEEPS}`;
  }

  return (
    <>
      <PageHeader
        title="Size estimator"
        description={
          "Will a case fit in this computer's memory, how long will the solve take, and what would a cloud machine " +
          "cost? Rough answers (±30\u00a0%) from measured runs. The memory and the cores come from " +
          `${mode === "demo" ? "the demo's engine" : "your engine"}.`
        }
      />
      {machine.isPending ? (
        <Card className="p-5">
          <p role="status" className="text-sm text-muted-foreground">Asking the engine about its computer…</p>
        </Card>
      ) : (
        <EstimateForm
          defaults={{ ...DEFAULTS, ram: fields.ram ?? DEFAULTS.ram, cores: fields.cores ?? DEFAULTS.cores }}
          about={about}
          reset={known.length ? "Back to this computer" : "Back to the example"}
        />
      )}
    </>
  );
}
