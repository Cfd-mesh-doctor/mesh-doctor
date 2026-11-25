// SPDX-License-Identifier: GPL-3.0-or-later
// The same picture of each of two cases, side by side, on the Compare screen: each case's sets of pictures (GET
// /pictures?case=, API 1.17), the set each shows (one both have by name first, so the same written time of each; a
// list picks another) and a picture both sets have, picked from a list: a's beside b's, a above b on a phone. Each
// picture is fetched with the engine's key once its place comes near the screen and shown through a blob: URL. A case
// with no set says so, with Make pictures… of it, and the other case's pictures show alone.
import { ImagePlus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useAppPath } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useJobs, usePicture, usePictureSet, usePictureSets } from "@/engine/hooks";
import { isActive, type Picture, type PictureKind, type PictureSet, type PictureSetBrief } from "@/engine/types";
import { useBlobSrc, useSeen } from "@/lib/blobImage";
import { cn } from "@/lib/utils";
import { firstSets, madeSets, pictureChoices, shownPicture } from "./compareView";
import { FIELD } from "./dialogParts";
import { MakePicturesDialog } from "./MakePictures";
import { kindInfo, makingPictures, setHeading, setPath, setTitle } from "./pictureSets";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** A set read here is one already made: the sets' list is what waits on a picture job. */
const NOT_MAKING = () => false;

/** One side's picture: a grey frame until its place comes near the screen and it loads, then the picture. */
function SidePicture({ s, picture }: { s: PictureSet; picture: Picture }) {
  const [near, seen] = useSeen<HTMLDivElement>();
  const q = usePicture(s.case, s.set, s.made, picture.file, seen);
  const img = useBlobSrc(q.data);
  const [state, setState] = useState<"loading" | "shown" | "broken">("loading");
  return (
    <div ref={near} className="relative aspect-video overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
      {q.isError ? (
        <div className="absolute inset-0 grid place-items-center p-3 text-center">
          <div>
            <p className="text-xs text-danger">The picture didn&apos;t load: {asEngineError(q.error).message}</p>
            <Button className="mt-2" size="sm" variant="secondary" onClick={() => void q.refetch()}
              disabled={q.isFetching}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <>
          {state === "broken" ? (
            <span className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-muted-foreground">
              This browser can&apos;t show the picture: its file isn&apos;t a PNG it can read.
            </span>
          ) : state === "loading" && <Skeleton className="absolute inset-0 size-full rounded-none" />}
          <img ref={img} alt={`${picture.title}, of ${s.case} at ${setTitle(s)}`} onLoad={() => setState("shown")}
            onError={(e) => { if (e.currentTarget.getAttribute("src")) setState("broken"); }}
            className={cn("size-full object-contain transition-opacity duration-200",
              state === "shown" ? "opacity-100" : "opacity-0")} />
        </>
      )}
    </div>
  );
}

/** A frame for what a side shows instead of its picture. */
function Instead({ children }: { children: ReactNode }) {
  return (
    <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-border p-4 text-center">
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** One side: which case and set it is, then its picture and a link to its set; or that it has no set yet (with Make
 *  pictures… of it) or one only being made. */
function Side({ tag, name, set, doc, picture, making, onMake }: {
  tag: "a" | "b";
  name: string;
  set: string | null;
  doc: ReturnType<typeof usePictureSet>;
  picture: Picture | undefined;
  /** its first set is being made */
  making: boolean;
  onMake: () => void;
}) {
  const to = useAppPath();
  const s = set == null ? undefined : doc.data;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-xs font-semibold text-muted-foreground">{tag}</span>
        <span className="font-medium wrap-anywhere">{name}</span>
        {s && <span className="text-xs text-muted-foreground">{setTitle(s)}</span>}
      </figcaption>
      {set == null ? (
        making ? <Instead>Its first set of pictures is being made: it shows here once made.</Instead> : (
          <Instead>
            <p>No pictures of {name} yet.</p>
            <Button className="mt-2" size="sm" variant="secondary" onClick={onMake} aria-label={`Make pictures of ${name}…`}>
              <ImagePlus aria-hidden /> Make pictures…
            </Button>
          </Instead>
        )
      ) : doc.isError ? (
        <ErrorPanel compact error={doc.error} onRetry={() => void doc.refetch()} retrying={doc.isFetching} />
      ) : !s ? (
        <Skeleton className="aspect-video w-full rounded-lg" />
      ) : !picture ? (
        <Instead>Its set has no picture to show beside the other&apos;s.</Instead>
      ) : (
        <>
          <SidePicture key={`${s.set}/${s.made}/${picture.file}`} s={s} picture={picture} />
          <Link to={to(setPath(s.case, s.set))} className={cn(LINK, "mt-1.5 inline-block text-xs")}
            aria-label={`Open its set of ${name}`}>
            Open its set
          </Link>
        </>
      )}
    </figure>
  );
}

/** The pictures to pick from by kind, each kind in the order its first picture comes. */
function byKind(pictures: readonly Picture[]): [PictureKind, Picture[]][] {
  const out = new Map<PictureKind, Picture[]>();
  for (const p of pictures) out.set(p.kind, [...(out.get(p.kind) ?? []), p]);
  return [...out];
}

/** Two cases' sets of pictures and the same picture of each, side by side. */
export function ComparePicturesCard({ a, b }: { a: string; b: string }) {
  const id = useId();
  const to = useAppPath();
  const jobs = useJobs();
  const qa = usePictureSets(makingPictures(jobs.data?.items, a), a);
  const qb = usePictureSets(makingPictures(jobs.data?.items, b), b);
  const [pick, setPick] = useState<{ a?: string; b?: string }>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [make, setMake] = useState<{ name: string | null; open: boolean }>({ name: null, open: false });

  // Each side's set: the one picked while it is still made, else the first (a set of the same name in both first).
  const ready = qa.data != null && qb.data != null;
  const setsA = madeSets(qa.data?.items ?? []), setsB = madeSets(qb.data?.items ?? []);
  const [firstA, firstB] = firstSets(setsA, setsB);
  const chosen = (p: string | undefined, sets: PictureSetBrief[], first: string | null) =>
    !ready ? null : p != null && sets.some((s) => s.set === p) ? p : first;
  const setA = chosen(pick.a, setsA, firstA), setB = chosen(pick.b, setsB, firstB);
  const da = usePictureSet(a, setA ?? "", NOT_MAKING, setA != null);
  const db = usePictureSet(b, setB ?? "", NOT_MAKING, setB != null);
  const choices = pictureChoices(setA == null ? null : da.data, setB == null ? null : db.data);
  const picture = shownPicture(choices, picked);
  const beingMade = (items: readonly PictureSetBrief[] | undefined) =>
    items?.some((s) => s.made == null && s.job != null && isActive(s.job.state)) ?? false;

  const setList = (tag: "a" | "b", sets: PictureSetBrief[], value: string | null) => sets.length > 1 && value != null && (
    <div className="w-full max-w-[15rem] space-y-1.5">
      <label htmlFor={`${id}-${tag}`} className="block text-sm font-medium">{tag}&apos;s set</label>
      <select id={`${id}-${tag}`} className={FIELD} value={value}
        onChange={(e) => setPick((p) => ({ ...p, [tag]: e.target.value }))}>
        {sets.map((s) => <option key={s.set} value={s.set}>{setHeading(s)}</option>)}
      </select>
    </div>
  );

  const failed = qa.isError ? qa : qb.isError ? qb : null;
  let body: ReactNode;
  if (failed) {
    body = <ErrorPanel compact error={failed.error} onRetry={() => void failed.refetch()} retrying={failed.isFetching} />;
  } else if (!ready) {
    body = <p role="status" className="text-sm text-muted-foreground">Asking the engine for their pictures…</p>;
  } else {
    const none = setA != null && setB != null && choices?.length === 0;
    body = (
      <>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 empty:hidden">
          {setList("a", setsA, setA)}
          {setList("b", setsB, setB)}
          {picture && choices && (
            <div className="w-full max-w-md space-y-1.5">
              <label htmlFor={`${id}-picture`} className="block text-sm font-medium">Picture</label>
              <select id={`${id}-picture`} className={FIELD} value={picture.file} onChange={(e) => setPicked(e.target.value)}>
                {byKind(choices).map(([kind, ps]) => (
                  <optgroup key={kind} label={kindInfo(kind)?.label ?? kind}>
                    {ps.map((p) => <option key={p.file} value={p.file}>{p.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </div>
        {none ? (
          <p className="mt-4 text-sm text-muted-foreground">
            These two sets have no picture in common. Make both with the same kinds and the same cut list (cuts.json),
            at the same written time{setsA.length > 1 || setsB.length > 1 ? ", or pick another set of either" : ""}.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Side tag="a" name={a} set={setA} doc={da} picture={picture} making={beingMade(qa.data?.items)}
                onMake={() => setMake({ name: a, open: true })} />
              <Side tag="b" name={b} set={setB} doc={db} picture={picture} making={beingMade(qb.data?.items)}
                onMake={() => setMake({ name: b, open: true })} />
            </div>
            {picture && <p className="mt-3 text-xs text-pretty text-muted-foreground">{picture.title}</p>}
          </>
        )}
      </>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader className="block">
        <CardTitle>The same picture of each</CardTitle>
        <CardDescription>
          A picture both have, drawn by ParaView from a set of each, a&apos;s beside b&apos;s: the same cut of each shows
          where their flows part. A set of the same written time of each comes first. Every set is on the{" "}
          <Link to={to("/pictures")} className={LINK}>Pictures screen</Link>.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
      <MakePicturesDialog open={make.open} onOpenChange={(open) => setMake((m) => ({ ...m, open }))} name={make.name} />
    </Card>
  );
}
