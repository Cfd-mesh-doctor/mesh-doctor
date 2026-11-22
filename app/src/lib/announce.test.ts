// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCE_DELAY, KEPT_FOR, announce } from "./announce";

const regions = () => document.querySelectorAll<HTMLElement>("body > [aria-live]");

afterEach(() => { vi.useRealTimers(); });

describe("telling a screen reader", () => {
  it("says the words in a polite live region that was in the page before them, then empties it again", () => {
    vi.useFakeTimers();
    announce("Copied to the clipboard");
    const [region] = regions();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("sr-only");
    expect(region).toBeEmptyDOMElement(); // words that arrive with the region may not be read
    vi.advanceTimersByTime(ANNOUNCE_DELAY);
    expect(region).toHaveTextContent("Copied to the clipboard");
    vi.advanceTimersByTime(KEPT_FOR);
    expect(region).toBeEmptyDOMElement();
  });

  it("says the same words again, in the same region", () => {
    vi.useFakeTimers();
    announce("Copied to the clipboard");
    vi.advanceTimersByTime(ANNOUNCE_DELAY);
    announce("Copied to the clipboard");
    const [region] = regions();
    expect(region).toBeEmptyDOMElement(); // emptied first, so the same words are new again
    vi.advanceTimersByTime(ANNOUNCE_DELAY);
    expect(region).toHaveTextContent("Copied to the clipboard");
    expect(regions()).toHaveLength(1);
  });
});
