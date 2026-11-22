// SPDX-License-Identifier: GPL-3.0-or-later
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPIED_FOR } from "@/lib/useCopy";
import { CopyBlock } from "./CopyBlock";
import { copyBlockLabel } from "./copyBlockLabel";

const CODE = "meshdoctor serve\nmeshdoctor pair --open";

afterEach(() => { vi.useRealTimers(); });

describe("a code block's copy button", () => {
  it("copies the whole block as written, says so for a moment, then is ready again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime }); // its clipboard stands in for the browser's
    render(<CopyBlock code={CODE} />);
    expect(screen.getByText(/meshdoctor pair/).closest("pre")?.textContent).toBe(CODE);

    await user.click(screen.getByRole("button", { name: "Copy the 2 lines starting “meshdoctor serve”" }));
    expect(await navigator.clipboard.readText()).toBe(CODE);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(COPIED_FOR); });
    expect(screen.getByRole("button", { name: /^Copy the 2 lines/ })).toBeInTheDocument();
  });

  it("names what it copies by the block's first line, in single spaces, shortened when long", () => {
    expect(copyBlockLabel('{"kind": "repair"}')).toBe('Copy “{"kind": "repair"}”');
    expect(copyBlockLabel("\n  clients      CLI\n  engine\n")).toBe("Copy the 3 lines starting “clients CLI”");
    expect(copyBlockLabel(`${"x".repeat(50)}\ny`)).toBe(`Copy the 2 lines starting “${"x".repeat(40)}…”`);
  });
});
