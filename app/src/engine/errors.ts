// SPDX-License-Identifier: GPL-3.0-or-later
// One error type for everything that can go wrong talking to the engine, and plain words for each.
import type { ApiErrorCode } from "./types";

/** The engine's own codes, plus the ones this app adds when no answer came back. */
export type ErrorCode =
  | ApiErrorCode
  | "unreachable" // nothing answered: not running, wrong port, or this site not allowed
  | "permission-denied" // the browser blocked this site from reaching apps on this computer
  | "timeout"
  | "bad-response" // an answer that isn't the engine's JSON
  | "incompatible" // an API major version this app doesn't speak
  | "aborted";

const ENGINE_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  "bad-request", "busy", "exists", "finished", "forbidden", "internal", "method-not-allowed",
  "not-enough-memory", "not-found", "not-ready", "schema-version", "too-large", "unavailable",
  "unsupported", "unsupported-media-type",
]);

export function isEngineCode(code: unknown): code is ApiErrorCode {
  return typeof code === "string" && ENGINE_CODES.has(code);
}

export class EngineError extends Error {
  readonly code: ErrorCode;
  /** HTTP status; 0 when nothing answered. */
  readonly status: number;

  constructor(code: ErrorCode, message: string, status = 0) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.status = status;
  }

  /** Worth trying again by itself: the engine may simply not be up yet. */
  get transient(): boolean {
    return this.code === "unreachable" || this.code === "timeout" || this.code === "unavailable";
  }

  /** The pairing key is missing, wrong or replaced (meshdoctor pair --new). */
  get needsPairing(): boolean {
    return this.code === "forbidden" && /pairing key/i.test(this.message);
  }
}

export function asEngineError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  return new EngineError("bad-response", e instanceof Error ? e.message : String(e));
}

export interface Explained {
  title: string;
  /** What to do, in plain words; a command, setting or file name in it goes in backticks, and shows as code. */
  hint: string;
  /** A command that fixes it, shown with a copy button. */
  command?: string;
  /**
   * docs/troubleshooting.md has this problem under this title (its Web app group quotes it), so the Troubleshooting
   * page, searched for the title, opens at it; the error panel links there. A test keeps the two lists equal.
   */
  troubleshooting?: true;
}

/** What went wrong and what to do, in plain words. */
export function explain(err: unknown, origin = globalThis.location?.origin ?? ""): Explained {
  const e = asEngineError(err);
  if (e.needsPairing) {
    return {
      title: "This browser needs pairing again",
      // The engine is answering, so its window is busy: a command typed there would wait for it to stop. And it reads
      // its key when it starts, so after a pair --new made while it runs, no link works until it restarts.
      hint: "The engine has a different pairing key, or none was sent. Ran `meshdoctor pair --new` while the engine "
        + "was running? Restart it first (Ctrl+C in its window, then `meshdoctor serve`): it reads the key only "
        + "when it starts. Then run this in a second WSL window (the engine keeps its own busy): it opens the pairing "
        + "link.",
      command: "meshdoctor pair --open",
      troubleshooting: true,
    };
  }
  switch (e.code) {
    case "unreachable":
      return {
        title: "The engine isn't answering",
        hint:
          "Start Mesh Doctor on this computer and try again. If it is running already, it may use another port, " +
          `or not allow this site (${origin || "this address"}) in its \`app_origins\` setting.`,
        command: "meshdoctor serve",
        troubleshooting: true,
      };
    case "permission-denied":
      return {
        title: "Your browser blocked the connection",
        hint:
          "This site needs permission to reach apps on your device. Click the icon at the left of the address bar, " +
          "open Site settings, allow “Apps on device” (Local network access), then try again.",
        troubleshooting: true,
      };
    case "timeout":
      return { title: "The engine took too long to answer", hint: "It may be busy starting up. Try again in a moment." };
    case "incompatible":
      return {
        title: "This engine version doesn't match the app",
        hint: e.message,
        command: "git pull",
        troubleshooting: true,
      };
    case "busy":
      return { title: "Another OpenFOAM job is running", hint: "Wait for it to finish, or cancel it on the Jobs page." };
    case "not-enough-memory":
      return {
        title: "Not enough free memory",
        hint: "Close other programs or WSL jobs, or give WSL more memory in `.wslconfig`, then try again.",
      };
    case "finished":
      return { title: "That job has already finished", hint: e.message };
    case "exists":
      return { title: "A run with that name already exists", hint: "Pick another name, or choose to replace it." };
    case "not-found":
      return { title: "Not found", hint: e.message };
    case "forbidden":
      return { title: "The engine refused this request", hint: e.message };
    case "internal":
      return { title: "The engine hit an error", hint: "Details are in the engine's window (where `meshdoctor serve` runs)." };
    case "bad-response":
      return { title: "Unexpected answer", hint: e.message || "The address may not be a Mesh Doctor engine." };
    default:
      return { title: "Something went wrong", hint: e.message };
  }
}
