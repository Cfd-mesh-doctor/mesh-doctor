// SPDX-License-Identifier: GPL-3.0-or-later
// The Pictures screen (GET /pictures, API 1.17): the sets, and Make pictures… with its job; a set's page with its
// notes and its pictures by kind, each fetched with the key as it comes near the screen and shown through a blob: URL,
// a picture open large with Download, Delete… after a confirmation, and a set being made, made again or not made; and
// a run's own sets on its page.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { isActive, type Job, type MachineInfo, type PictureSet, type PictureSetBrief, type Run } from "@/engine/types";
import { catchDownloads } from "@/test/downloads";
import { renderScreen } from "@/test/render";
import { PictureSetPage } from "./PictureSet";
import { Pictures, RunPicturesCard } from "./Pictures";
import { setOfJob } from "./pictureSets";

const MACHINE: MachineInfo = { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");

const SET: PictureSet = {
  case: "ahmed", set: "2000", time: "2000", mean: false, kinds: ["cuts", "vortices", "spots"], made: ago(3_600_000),
  notes: ["No spot of unphysical pressure: Cp is above -5 on every wall."],
  pictures: [
    { file: "cuts/c1_side_U.png", kind: "cuts", title: "Side cut on the centreline: speed" },
    { file: "cuts/c3_wake_Cpt.png", kind: "cuts", title: "Cross cut in the wake: total pressure coefficient Cp,t" },
    { file: "vortices/Q20000_rear34.png", kind: "vortices", title: "Vortices, Q = 20,000 1/s², from behind" },
  ],
};
const TITLES = SET.pictures.map((p) => p.title);

const pictureJob = (name: string, time: string, state: Job["state"], more: Partial<Job> = {}) => ({
  schemaVersion: "1.0", id: `20261124-120000-pictures-${name}-${state}`, kind: "pictures", name, state, runner: "local",
  params: { name, time, kinds: ["cuts", "vortices", "spots"], mean: false }, log: "x.log",
  created: ago(120_000), started: ago(120_000), finished: isActive(state) ? null : ago(60_000), ...more,
}) as Job;

const run = (name: string, more: Record<string, unknown> = {}) => ({
  name, state: "done", step: "done", iteration: 300, start: 0, end: 300, written: 300, nProcs: 4, stretches: [],
  started: ago(7_200_000), updated: ago(3_600_000), finished: ago(3_600_000), error: null,
  times: [100, 200, 300], joined: [100, 300, 200], averaging: null, ...more,
}) as unknown as Run;

/** Your own engine with these sets of pictures, jobs and runs (its sets being made are those of its active picture
 * jobs); `old`: an engine before API 1.17, which has no picture routes; `refuse`: what it answers a delete with;
 * `broken`: the picture it can't serve; `apiVersion`: what GET / says (none: an engine that doesn't say, so not one
 * that joins a split time first, API 1.19); `twoDisks`: its runs' folders on another disk than its workspace. */
function engine(o: {
  sets?: PictureSet[]; jobs?: Job[]; runs?: Run[]; old?: boolean; refuse?: EngineError; broken?: string;
  apiVersion?: string; twoDisks?: boolean;
} = {}) {
  const sets = new Map((o.sets ?? []).map((s) => [`${s.case}/${s.set}`, structuredClone(s)]));
  const posted: { path: string; body?: unknown }[] = [];
  const asked: string[] = [];
  const fetched: string[] = [];
  const latest = (name: string, set: string) => (o.jobs ?? []).find((j) => {
    const of = setOfJob(j);
    return of?.name === name && of.set === set;
  });
  const brief = (name: string, set: string, s?: PictureSet): PictureSetBrief => {
    const job = latest(name, set);
    return {
      case: name, set, time: s?.time ?? set, mean: false, kinds: s?.kinds ?? ["cuts", "vortices", "spots"],
      made: s?.made ?? null, count: s ? s.pictures.length : null, job: job ? { id: job.id, state: job.state } : null,
    };
  };
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(method: string, path: string, body?: unknown) => {
      asked.push(path);
      const [route = "", query = ""] = path.split("?");
      if (method === "POST") {
        posted.push({ path, body });
        if (route === "/jobs") {
          const p = (body as { params: { name: string; time: string } }).params;
          return pictureJob(p.name, p.time || "300", "queued") as T;
        }
        const del = /^\/pictures\/([^/]+)\/([^/]+)\/delete$/.exec(route);
        if (del) {
          if (o.refuse) throw o.refuse;
          const key = `${decodeURIComponent(del[1]!)}/${decodeURIComponent(del[2]!)}`;
          const s = sets.get(key);
          if (!s) throw new EngineError("not-found", `no set of pictures ${key}`, 404);
          sets.delete(key);
          return { case: s.case, set: s.set, deleted: s.pictures.length } as T;
        }
      }
      if (route === "/jobs") return { items: o.jobs ?? [] } as T;
      if (route === "/machine") return MACHINE as T;
      if (route === "/runs") return { items: o.runs ?? [] } as T;
      if (route === "/cases") {
        const made = Object.fromEntries((o.runs ?? []).map((r) => [r.name, { template: "ahmed-body" }]));
        const items = ["ahmed", ...Object.keys(made).filter((n) => n !== "ahmed")];
        return { items, cells: Object.fromEntries(items.map((n) => [n, 478_901])), made } as T;
      }
      if (route === "/" && o.apiVersion) {
        return { apiVersion: o.apiVersion, version: "0.4.0", jobKinds: ["repair", "solve", "pictures"] } as T;
      }
      if (route === "/disk/pictures") {
        // a time still split onto a run's processes, which a picture job joins first (API 1.19): 40 MB
        const q = new URLSearchParams(query);
        const r = (o.runs ?? []).find((x) => x.name === q.get("name"));
        const at = q.get("time") || String(Math.max(...(r?.times ?? [])));
        const split = (r?.times ?? []).some((t) => String(t) === at) && !(r?.joined ?? []).some((t) => String(t) === at);
        const join = split ? { time: at, processes: r?.nProcs, needMb: 40, freeMb: 402_339, sameDisk: !o.twoDisks } : null;
        return { needMb: 7, freeMb: 402_339, keepMb: 1024, folder: "workspace", ...(o.apiVersion ? { join } : {}) } as T;
      }
      if (o.old && route.startsWith("/pictures")) throw new EngineError("not-found", `no such API route ${route}`, 404);
      if (route === "/pictures") {
        const of = new URLSearchParams(query).get("case");
        const making = (o.jobs ?? []).filter((j) => j.kind === "pictures" && isActive(j.state))
          .map((j) => setOfJob(j)!).filter((s) => !sets.has(`${s.name}/${s.set}`)).map((s) => brief(s.name, s.set));
        const made = [...sets.values()].map((s) => brief(s.case, s.set, s));
        return { items: [...making, ...made].filter((s) => of == null || s.case === of) } as T;
      }
      const one = /^\/pictures\/([^/]+)\/([^/]+)$/.exec(route);
      if (one) {
        const [name, set] = [decodeURIComponent(one[1]!), decodeURIComponent(one[2]!)];
        const s = sets.get(`${name}/${set}`);
        if (s) return structuredClone(s) as T;
        const job = latest(name, set);
        if (job && isActive(job.state)) {
          throw new EngineError("not-ready", `the pictures ${set} of ${name} are being made: job ${job.id} is ${job.state}`, 409);
        }
        throw new EngineError("not-found", `no set of pictures ${set} of ${name}`, 404);
      }
      throw new EngineError("not-found", `no such API route ${route}`, 404);
    },
    blob: async (path: string) => {
      fetched.push(path);
      if (o.broken && path.endsWith(o.broken)) throw new EngineError("not-found", "the picture isn't there", 404);
      return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    },
  };
  return { transport, posted, asked, fetched };
}

const listPage = (o: Parameters<typeof engine>[0] = {}) => {
  const e = engine(o);
  return { ...renderScreen(<Pictures />, { path: "/app/pictures", transport: e.transport }), ...e };
};
const setPage = (name: string, set: string, o: Parameters<typeof engine>[0] = {}) => {
  const e = engine(o);
  const at = `/app/pictures/${name}/${set}`;
  return { ...renderScreen(<PictureSetPage />, { path: "/app/pictures/:name/:set", at, transport: e.transport }), ...e };
};

describe("the Pictures screen", () => {
  it("lists each set: its case, what it pictures, its kinds and pictures, when it was made, and one being made", async () => {
    listPage({ sets: [SET], jobs: [pictureJob("wing", "300", "running"), pictureJob("ahmed", "2000", "done")] });
    const link = await screen.findByRole("link", { name: "ahmed" });
    expect(link).toHaveAttribute("href", "/app/pictures/ahmed/2000");
    const row = within(link.closest("tr")!);
    expect(link.closest("tr")).toHaveTextContent("Written time 2000 · cuts, vortices and spots");
    expect(row.getByText("Made")).toBeInTheDocument();
    expect(row.getByText("3")).toBeInTheDocument();
    expect(row.getByText(/ago$/)).toHaveAttribute("title");
    expect(row.getByRole("link", { name: "Open the pictures of ahmed, written time 2000" }))
      .toHaveAttribute("href", "/app/pictures/ahmed/2000");
    const making = within(screen.getByRole("link", { name: "wing" }).closest("tr")!);
    expect(making.getByText(/^Written time 300/)).toBeInTheDocument();
    expect(making.getByText("Running")).toBeInTheDocument();
    expect(making.getByText("Being made")).toBeInTheDocument();
  });

  it("with no set yet, offers to make one, or to solve a case first", async () => {
    listPage();
    expect(await screen.findByRole("heading", { name: "No pictures yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Solve" })).toHaveAttribute("href", "/app/solve");
    expect(screen.getAllByRole("button", { name: "Make pictures…" })).toHaveLength(2);
  });

  it("says an engine before API 1.17 can't make pictures yet, and offers nothing it can't do", async () => {
    listPage({ old: true });
    expect(await screen.findByRole("heading", { name: "Your engine can't make pictures yet" })).toBeInTheDocument();
    expect(screen.getByText(/Update Mesh Doctor on your computer, then make them here/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make pictures…" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes pictures of a run at a written time picked, of the kinds ticked, then shows its job", async () => {
    const user = userEvent.setup();
    const { posted, asked, router } = listPage({ runs: [run("wing")] });
    await user.click((await screen.findAllByRole("button", { name: "Make pictures…" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make pictures" });
    const what = await within(dialog).findByRole("combobox", { name: "Run or case" });
    expect(what).toHaveValue("wing");
    const time = within(dialog).getByRole("combobox", { name: "Written time" });
    expect(within(time).getAllByRole("option").map((x) => x.textContent)).toEqual(["The latest (300)", "200", "100"]);
    await user.selectOptions(time, "200");
    await user.click(within(dialog).getByRole("checkbox", { name: /^Spots/ }));
    await waitFor(() => expect(dialog).toHaveTextContent(/The set of pictures needs about 7 MB of disk space/));
    expect(asked).toContain("/disk/pictures?name=wing&time=200&kinds=cuts%2Cvortices&mean=false");
    expect(dialog).toHaveTextContent(/Needs about 0\.8\sGB of memory/);
    await user.click(within(dialog).getByRole("button", { name: "Make pictures" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      path: "/jobs", body: { kind: "pictures", params: { name: "wing", time: "200", kinds: "cuts,vortices", mean: false } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/jobs"));
    expect(router.state.location.search).toBe("?job=20261124-120000-pictures-wing-queued");
  });

  it("offers a transient run's mean flow, at the times written with it", async () => {
    const user = userEvent.setup();
    const t = run("t", {
      times: [0.0002, 0.0004, 0.0006, 0.0008], joined: [0.0002, 0.0004, 0.0006, 0.0008],
      averaging: { from: 0.0003, settled: 0.0002, written: 0.0006 },
    });
    const { posted } = listPage({ runs: [t] });
    await user.click((await screen.findAllByRole("button", { name: "Make pictures…" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make pictures" });
    const time = await within(dialog).findByRole("combobox", { name: "Written time" });
    expect(within(time).getAllByRole("option")).toHaveLength(4);
    await user.click(within(dialog).getByRole("checkbox", { name: /^Its mean flow/ }));
    expect(within(time).getAllByRole("option").map((x) => x.textContent)).toEqual(["The latest (0.0006)", "0.0004"]);
    await user.click(within(dialog).getByRole("button", { name: "Make pictures" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ kind: "pictures", params: { name: "t", time: "", kinds: "cuts,vortices,spots", mean: true } });
  });

  it("offers a run's times split onto its processes, on an engine that joins one first, and counts the join", async () => {
    const user = userEvent.setup();
    const { posted, asked } = listPage({ runs: [run("wing", { joined: [300] })], apiVersion: "1.19" });
    await user.click((await screen.findAllByRole("button", { name: "Make pictures…" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make pictures" });
    const time = await within(dialog).findByRole("combobox", { name: "Written time" });
    await waitFor(() => expect(within(time).getAllByRole("option").map((x) => x.textContent))
      .toEqual(["The latest (300)", "200 (split)", "100 (split)"]));
    expect(dialog).toHaveTextContent("As its folder names it.");
    await waitFor(() => expect(dialog).toHaveTextContent(/The set of pictures needs about 7 MB of disk space/));
    expect(dialog).toHaveTextContent("The case itself is only read.");
    await user.selectOptions(time, "200");
    expect(dialog).toHaveTextContent("The run itself only gets the time joined into its folder.");
    expect(dialog).toHaveTextContent("It is split onto its 4 processes: the job joins it first, into the run's own "
      + "folder, as the solve joins its latest, and the run then lists it as joined.");
    await waitFor(() => expect(dialog).toHaveTextContent("Joining written time 200 from its 4 processes into the run's "
      + "folder and the set of pictures need about 47 MB of disk space; the disk the engine's workspace is on has"));
    expect(dialog).not.toHaveTextContent(/The set of pictures needs/);
    expect(asked).toContain("/disk/pictures?name=wing&time=200&kinds=cuts%2Cvortices%2Cspots&mean=false");
    expect(within(dialog).queryByRole("checkbox", { name: /^A cut over time/ })).toBeNull();     // API 1.20
    await user.click(within(dialog).getByRole("button", { name: "Make pictures" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ kind: "pictures", params: { name: "wing", time: "200", kinds: "cuts,vortices,spots", mean: false } });
  });

  it("offers a cut over time of a run with two or more written times, on an engine at 1.20, with its count and memory", async () => {
    const user = userEvent.setup();
    const t = run("t", { times: [0.0002, 0.0004, 0.0006, 0.0008], joined: [0.0008] });
    const { posted, asked } = listPage({ runs: [t], apiVersion: "1.20" });
    await user.click((await screen.findAllByRole("button", { name: "Make pictures…" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make pictures" });
    const over = await within(dialog).findByRole("checkbox", { name: /^A cut over time/ });
    expect(over).not.toBeChecked();                                     // made only when asked
    expect(within(dialog).queryByRole("checkbox", { name: /^The cells that set the time step/ })).toBeNull();  // 1.21
    expect(dialog).toHaveTextContent("The first cut's speed at each of its 4 written times from 0.0002 to 0.0008, "
      + "oldest first: the flow as it changes. Those split onto its processes are read as they are: none is joined for it.");
    await waitFor(() => expect(dialog).toHaveTextContent(/Needs about 0\.8\sGB of memory;/));
    await user.click(over);
    expect(dialog).toHaveTextContent(/Needs about 1\.4\sGB of memory \(the cut over time holds two of its written times at once\);/);
    const time = within(dialog).getByRole("combobox", { name: "Written time" });
    await user.selectOptions(time, "0.0004");
    expect(dialog).toHaveTextContent("at each of its 2 written times from 0.0002 to 0.0004, oldest first");
    await waitFor(() => expect(asked).toContain("/disk/pictures?name=t&time=0.0004&kinds=cuts%2Cvortices%2Cspots%2Ctimes&mean=false"));
    await user.selectOptions(time, "0.0002");                         // one written time up to it: none
    expect(within(dialog).queryByRole("checkbox", { name: /^A cut over time/ })).toBeNull();
    expect(dialog).toHaveTextContent(/Needs about 0\.8\sGB of memory;/);
    await user.selectOptions(time, "0.0004");
    expect(within(dialog).getByRole("checkbox", { name: /^A cut over time/ })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Make pictures" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({
      kind: "pictures", params: { name: "t", time: "0.0004", kinds: "cuts,vortices,spots,times", mean: false },
    });
  });

  it("offers the cells that set the time step on an engine at 1.21, made only when asked, and not of a mean flow", async () => {
    const user = userEvent.setup();
    const t = run("t", {
      times: [0.0002, 0.0004, 0.0006], joined: [0.0002, 0.0004, 0.0006],
      averaging: { from: 0.0003, settled: 0.0002, written: 0.0006 },
    });
    const { posted, asked } = listPage({ runs: [t], apiVersion: "1.21" });
    await user.click((await screen.findAllByRole("button", { name: "Make pictures…" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make pictures" });
    const fast = await within(dialog).findByRole("checkbox", { name: /^The cells that set the time step/ });
    expect(fast).not.toBeChecked();                                     // made only when asked
    expect(dialog).toHaveTextContent("The 100 cells with the highest Courant number at that written time, as a "
      + "transient plan finds them: in red with the walls from three sides, then the three fastest places close up.");
    await user.click(fast);
    await waitFor(() => expect(asked.some((q) => q.includes("kinds=cuts%2Cvortices%2Cspots%2Cfastest&mean=false")))
      .toBe(true));
    const mean = within(dialog).getByRole("checkbox", { name: /^Its mean flow/ });
    await user.click(mean);                                             // found from a time's own flow: not of its mean
    expect(within(dialog).queryByRole("checkbox", { name: /^The cells that set the time step/ })).toBeNull();
    await user.click(mean);
    expect(within(dialog).getByRole("checkbox", { name: /^The cells that set the time step/ })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Make pictures" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({
      kind: "pictures", params: { name: "t", time: "", kinds: "cuts,vortices,spots,fastest", mean: false },
    });
  });

  it("counts a join apart on the disk of the run's folder, when that isn't the workspace's", async () => {
    const user = userEvent.setup();
    listPage({ runs: [run("wing", { joined: [200] })], apiVersion: "1.19", twoDisks: true });
    await user.click((await screen.findAllByRole("button", { name: "Make pictures…" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make pictures" });
    const time = await within(dialog).findByRole("combobox", { name: "Written time" });
    await waitFor(() => expect(within(time).getAllByRole("option").map((x) => x.textContent))
      .toEqual(["The latest (300, split)", "200", "100 (split)"]));
    expect(dialog).toHaveTextContent("It is split onto its 4 processes: the job joins it first");
    await waitFor(() => expect(dialog).toHaveTextContent("Joining written time 300 from its 4 processes into the run's "
      + "folder needs about 40 MB of disk space; the disk the cases are on has"));
    expect(dialog).toHaveTextContent(/The set of pictures needs about 7 MB of disk space; the disk the engine's workspace/);
    // a case you made: its split time is read as it is
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Run or case" }), "ahmed");
    expect(dialog).toHaveTextContent("The latest with U and p, on its whole mesh or split onto its processes: a split "
      + "one is read as it is, as a case you made is only read.");
    expect(dialog).toHaveTextContent("The case itself is only read.");
  });

  it("offers a run's joined times only on an engine that doesn't join a split one, and says to update it", async () => {
    const user = userEvent.setup();
    listPage({ runs: [run("wing", { joined: [300] })] });
    await user.click((await screen.findAllByRole("button", { name: "Make pictures…" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Make pictures" });
    const time = await within(dialog).findByRole("combobox", { name: "Written time" });
    expect(within(time).getAllByRole("option").map((x) => x.textContent)).toEqual(["The latest (300)"]);
    expect(dialog).toHaveTextContent("Its other times are split onto its processes: update Mesh Doctor (git pull) and "
      + "restart it to picture them too.");
    await waitFor(() => expect(dialog).toHaveTextContent(/The set of pictures needs about 7 MB of disk space/));
    expect(dialog).not.toHaveTextContent(/Joining/);
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Run or case" }), "ahmed");
    expect(dialog).toHaveTextContent("The latest with U and p on its whole mesh. The engine says if it has none.");
  });
});

describe("a set of pictures", () => {
  let files: ReturnType<typeof catchDownloads>;
  beforeEach(() => {
    files = catchDownloads();
  });
  afterEach(() => {
    files.restore();
    vi.unstubAllGlobals();
  });

  it("shows its notes and its pictures by kind, each fetched with the key and shown through a blob: URL", async () => {
    const { fetched } = setPage("ahmed", "2000", { sets: [SET] });
    expect(await screen.findByRole("heading", { level: 1, name: "ahmed" })).toBeInTheDocument();
    expect(await screen.findByText(/^Pictures · written time 2000 · made .+ ago$/)).toBeInTheDocument();
    expect(screen.getByText(SET.notes[0]!)).toBeInTheDocument();
    const card = (title: string) => within(screen.getByRole("heading", { name: title }).closest("section")!);
    expect(card("Cuts").getAllByRole("button").map((b) => b.textContent)).toEqual(TITLES.slice(0, 2));
    expect(card("Vortices").getAllByRole("button").map((b) => b.textContent)).toEqual(TITLES.slice(2));
    expect(card("Spots").getByText("None of this kind: the notes above say why.")).toBeInTheDocument();
    await waitFor(() => expect(fetched).toHaveLength(3));
    expect(fetched).toEqual(SET.pictures.map((p) => `/pictures/ahmed/2000/${p.file}`));
    const img = card("Cuts").getByRole("button", { name: TITLES[0] }).querySelector("img")!;
    await waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:test\//));
  });

  it("opens a picture large, goes on with the arrow keys, saves it as a PNG named after its set, and closes on it", async () => {
    const user = userEvent.setup();
    setPage("ahmed", "2000", { sets: [SET] });
    await user.click(await screen.findByRole("button", { name: TITLES[0] }));
    const first = await screen.findByRole("dialog", { name: TITLES[0] });
    expect(first).toHaveTextContent("Cuts · picture 1 of 3 · ahmed, written time 2000");
    await waitFor(() => expect(within(first).getByRole("img", { name: TITLES[0] }).getAttribute("src")).toMatch(/^blob:/));
    expect(within(first).getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("dialog", { name: TITLES[1] })).toHaveTextContent("picture 2 of 3");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next" }));
    const last = await screen.findByRole("dialog", { name: TITLES[2] });
    expect(last).toHaveTextContent("Vortices · picture 3 of 3");
    expect(within(last).getByRole("button", { name: "Next" })).toBeDisabled();
    await waitFor(() => expect(within(last).getByRole("button", { name: "Download" })).toBeEnabled());
    await user.click(within(last).getByRole("button", { name: "Download" }));
    expect(files.saved).toEqual([
      expect.objectContaining({ name: "ahmed_2000_vortices_Q20000_rear34.png", type: "image/png", inPage: true }),
    ]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: TITLES[2] })).toHaveFocus();
  });

  it("fetches a picture only once it comes near the screen", async () => {
    const watched: { el: Element; seen: IntersectionObserverCallback }[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      readonly seen: IntersectionObserverCallback;
      constructor(seen: IntersectionObserverCallback) {
        this.seen = seen;
      }
      observe(el: Element) {
        watched.push({ el, seen: this.seen });
      }
      disconnect() {}
    });
    const { fetched } = setPage("ahmed", "2000", { sets: [SET] });
    const button = await screen.findByRole("button", { name: TITLES[1] });
    expect(watched).toHaveLength(3);
    expect(fetched).toEqual([]);
    const near = watched.find((w) => w.el.contains(button))!;
    act(() => near.seen([{ isIntersecting: true, target: near.el } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver));
    await waitFor(() => expect(fetched).toEqual(["/pictures/ahmed/2000/cuts/c3_wake_Cpt.png"]));
  });

  it("says when a picture doesn't load, and tries again", async () => {
    const user = userEvent.setup();
    const { fetched } = setPage("ahmed", "2000", { sets: [SET], broken: "c1_side_U.png" });
    expect(await screen.findByText("The picture didn't load: the picture isn't there")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetched.filter((p) => p.endsWith("c1_side_U.png"))).toHaveLength(2));
  });

  it("deletes the set after a confirmation, then shows the Pictures screen", async () => {
    const user = userEvent.setup();
    const { posted, router } = setPage("ahmed", "2000", { sets: [SET] });
    await user.click(await screen.findByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete the pictures of ahmed, written time 2000?" });
    expect(dialog).toHaveTextContent("This deletes its 3 pictures and its job's log from the engine's workspace. The case "
      + "and its results aren't touched, so the set can be made again.");
    await user.click(within(dialog).getByRole("button", { name: "Keep them" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Delete…" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/pictures"));
    expect(posted).toEqual([{ path: "/pictures/ahmed/2000/delete", body: undefined }]);
  });

  it("says when the engine won't delete it, and keeps the confirmation open", async () => {
    const user = userEvent.setup();
    const busy = new EngineError("busy", "the pictures 2000 of ahmed are being made: job x is running; cancel it first", 409);
    const { router } = setPage("ahmed", "2000", { sets: [SET], refuse: busy });
    await user.click(await screen.findByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/pictures/ahmed/2000");
  });

  it("says it is being made while its job runs, with its step and a link to its job", async () => {
    const job = pictureJob("wing", "300", "running", { progress: { step: "drawing the cuts" } } as Partial<Job>);
    setPage("wing", "300", { jobs: [job] });
    expect(await screen.findByRole("heading", { name: "Being made" })).toBeInTheDocument();
    expect(screen.getByText("Its job is running: drawing the cuts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Follow its job" }))
      .toHaveAttribute("href", `/app/jobs?job=${encodeURIComponent(job.id)}`);
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
  });

  it("says why a set wasn't made: its job's error, and where its log is", async () => {
    const job = pictureJob("wing", "300", "failed", { error: "pvbatch stopped: out of memory" });
    setPage("wing", "300", { jobs: [job] });
    expect(await screen.findByRole("heading", { name: "The pictures weren't made" })).toBeInTheDocument();
    expect(screen.getByText(/^pvbatch stopped: out of memory/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "its job" })).toHaveAttribute("href", `/app/jobs?job=${encodeURIComponent(job.id)}`);
  });

  it("keeps the pictures made before while a job makes it again, without Delete meanwhile, and says if that failed", async () => {
    const view = setPage("ahmed", "2000", { sets: [SET], jobs: [pictureJob("ahmed", "2000", "running")] });
    expect(await screen.findByText(/^Being made again:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TITLES[0] })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
    expect(screen.getByRole("link", { name: "Job details" })).toHaveAttribute("href", expect.stringMatching(/^\/app\/jobs\?job=/));
    view.unmount();
    setPage("ahmed", "2000", { sets: [SET], jobs: [pictureJob("ahmed", "2000", "failed")] });
    expect(await screen.findByText(/^Its newest job to make it again failed: these are the pictures made before\./))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete…" })).toBeInTheDocument();
  });

  it("shows the cells that set the time step in a section of their own: from three sides, then each place", async () => {
    const view = (v: string, words: string) => ({
      file: `fastest/fastest_${v}.png`, kind: "fastest" as const,
      title: `The cells that set the time step: the 100 with the highest Courant number, ${words}`,
    });
    const place = {
      file: "fastest/fastest_place1.png", kind: "fastest" as const,
      title: "Place 1 of the cells that set the time step, close up: 38 cells near (-0.0635, 0.18, 0.322) m, about "
        + "2.6 mm across and 2.4 mm from the wall ahmed, where the flow is up to 55 m/s",
    };
    const note = "the cells that set the time step are the 100 with the highest Courant number at written time 2000: "
      + "without them it could be 2.2 times as long";
    const pictures = [view("side", "from the side"), view("top", "from above"), view("front34", "from the front"), place];
    setPage("ahmed", "2000", { sets: [{ ...SET, kinds: ["cuts", "fastest"], notes: [note], pictures: [SET.pictures[0]!, ...pictures] }] });
    const card = within((await screen.findByRole("heading", { name: "The cells that set the time step" })).closest("section")!);
    expect(card.getByText(/^The cells with the highest Courant number at that written time, which set a transient/))
      .toBeInTheDocument();
    expect(card.getAllByRole("button").map((b) => b.textContent)).toEqual(pictures.map((p) => p.title));
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.getByText("How the engine made the set, what it found and what it left out.")).toBeInTheDocument();
  });

  it("shows a cut over time one written time at a time: a slider, the times before and after, and Play", async () => {
    const user = userEvent.setup();
    const times = ["0.0002", "0.0004", "0.0006"].map((t) => ({
      file: `times/c1_side_U_at_${t}.png`, kind: "times" as const, time: t,
      title: `Side cut on the centreline: speed, written time ${t}`,
    }));
    const { fetched } = setPage("ahmed", "2000", {
      sets: [{ ...SET, kinds: ["cuts", "times"], pictures: [SET.pictures[0]!, ...times] }],
    });
    const card = within((await screen.findByRole("heading", { name: "Over time" })).closest("section")!);
    expect(card.getByText(/The first cut's speed at each written time/)).toBeInTheDocument();
    expect(card.getByText("Written time 0.0002 · 1 of 3")).toBeInTheDocument();
    expect(card.getByRole("button", { name: times[0]!.title })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Earlier time" })).toBeDisabled();
    await waitFor(() => expect(fetched).toEqual(expect.arrayContaining(                     // the next one, ready
      ["/pictures/ahmed/2000/times/c1_side_U_at_0.0002.png", "/pictures/ahmed/2000/times/c1_side_U_at_0.0004.png"])));
    expect(fetched).not.toContain("/pictures/ahmed/2000/times/c1_side_U_at_0.0006.png");
    await user.click(card.getByRole("button", { name: "Later time" }));
    expect(card.getByText("Written time 0.0004 · 2 of 3")).toBeInTheDocument();
    const slider = card.getByRole("slider", { name: "Written time" });
    expect(slider).toHaveAttribute("aria-valuetext", "written time 0.0004, 2 of 3");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(card.getByText("Written time 0.0002 · 1 of 3")).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Play" }));
    expect(card.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    await waitFor(() => expect(card.getByText("Written time 0.0006 · 3 of 3")).toBeInTheDocument(), { timeout: 4000 });
    await waitFor(() => expect(card.getByRole("button", { name: "Play" })).toBeInTheDocument(), { timeout: 2000 });
    expect(card.getByRole("button", { name: "Later time" })).toBeDisabled();
    // it opens large; the large view moves it on, and the focus comes back to the time it shows
    await user.click(card.getByRole("button", { name: times[2]!.title }));
    expect(await screen.findByRole("dialog", { name: times[2]!.title })).toHaveTextContent("Over time · picture 4 of 4");
    await user.keyboard("{ArrowLeft}");
    await screen.findByRole("dialog", { name: times[1]!.title });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(card.getByRole("button", { name: times[1]!.title })).toHaveFocus();
    expect(card.getByText("Written time 0.0004 · 2 of 3")).toBeInTheDocument();
  });

  it("puts a mean flow's swing beside its mean speed and the speed at the same written time, from that time's set", async () => {
    const user = userEvent.setup();
    const cut = (name: string, title: string) => ({ file: `cuts/c1_side_${name}.png`, kind: "cuts" as const, title });
    const TITLE = ["Side cut: speed of the mean flow", "Side cut: how much the speed swings about its mean", "Side cut: speed"];
    const mean: PictureSet = {
      ...SET, set: "0.0006_mean", time: "0.0006", mean: true, kinds: ["cuts"], notes: [],
      pictures: [cut("U", TITLE[0]!), cut("Cp", "Side cut: pressure of the mean flow"), cut("Urms", TITLE[1]!)],
    };
    const instant: PictureSet = { ...SET, set: "0.0006", time: "0.0006", kinds: ["cuts"], notes: [], pictures: [cut("U", TITLE[2]!)] };
    const view = setPage("ahmed", "0.0006_mean", { sets: [mean, instant] });
    const card = within((await screen.findByRole("heading", { name: "Mean, swing and instant" })).closest("section")!);
    expect(card.getByText(/and the speed at written time 0\.0006, the latest instant it averages/)).toBeInTheDocument();
    await waitFor(() => expect(card.getAllByRole("button").map((b) => b.textContent)).toEqual(TITLE));
    await user.click(card.getByRole("button", { name: TITLE[2] }));
    expect(await screen.findByRole("dialog", { name: TITLE[2] })).toHaveTextContent("Cuts · picture 1 of 1 · ahmed, written time 0.0006");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(card.getByRole("button", { name: TITLE[2] })).toHaveFocus();
    await user.click(card.getByRole("button", { name: TITLE[1] }));
    expect(await screen.findByRole("dialog", { name: TITLE[1] })).toHaveTextContent("Cuts · picture 3 of 3 · ahmed, the mean flow to 0.0006 s");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(card.getByRole("button", { name: TITLE[1] })).toHaveFocus();          // not the same picture in the cuts
    view.unmount();
    setPage("ahmed", "0.0006_mean", { sets: [mean] });
    const none = within((await screen.findByRole("heading", { name: "Mean, swing and instant" })).closest("section")!);
    expect(await none.findByText("Written time 0.0006 has no pictures of its own flow yet: Make pictures… at that time, "
      + "without its mean flow, to see the instant here.")).toBeInTheDocument();
  });

  it("says when the engine has no such set", async () => {
    setPage("ahmed", "1000", { sets: [SET] });
    expect(await screen.findByRole("heading", { name: "No such set of pictures" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the sets it has" })).toHaveAttribute("href", "/app/pictures");
    expect(screen.getByText(/^Pictures · written time 1000$/)).toBeInTheDocument();
  });
});

describe("a run's pictures", () => {
  const card = (o: Parameters<typeof engine>[0]) => {
    const e = engine(o);
    return { ...e, ...renderScreen(<RunPicturesCard name="ahmed" />, { path: "/app/solve/ahmed", transport: e.transport }) };
  };

  it("are its own sets, linked to their pages, and Make pictures… of it", async () => {
    const user = userEvent.setup();
    const { asked } = card({ sets: [SET, { ...SET, case: "other" }], runs: [run("ahmed", { joined: [2000], times: [2000] })] });
    const section = (await screen.findByRole("heading", { name: "Pictures of its flow" })).closest("section")!;
    expect(await within(section).findByRole("link", { name: "Written time 2000" }))
      .toHaveAttribute("href", "/app/pictures/ahmed/2000");
    expect(section).toHaveTextContent(/cuts, vortices and spots · 3 pictures · made .+ ago/);
    expect(asked).toContain("/pictures?case=ahmed");
    expect(within(section).getAllByRole("listitem")).toHaveLength(1);
    await user.click(within(section).getByRole("button", { name: "Make pictures…" }));
    expect(await screen.findByRole("dialog", { name: "Make pictures of ahmed" })).toBeInTheDocument();
  });

  it("say when there are none yet, or when the engine is too old to make them", async () => {
    const none = card({});
    expect(await screen.findByText(/^None yet: Make pictures… draws its flow/)).toBeInTheDocument();
    none.unmount();
    card({ old: true });
    expect(await screen.findByText(/^Your engine is older than the pictures/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make pictures…" })).toBeNull();
  });
});
