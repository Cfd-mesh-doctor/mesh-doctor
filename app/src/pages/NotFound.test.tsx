// SPDX-License-Identifier: GPL-3.0-or-later
import { act, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFound, NotFoundPage, RouteError } from "./NotFound";

/** Opens an address no page has: the site's own not-found page, or an app screen's (whose sidebar lists the rest). */
function openUnknown(address: string, inApp = false) {
  const router = createMemoryRouter([{ path: "*", element: inApp ? <NotFound home="/demo" /> : <NotFoundPage /> }],
    { initialEntries: [address] });
  return render(<RouterProvider router={router} />);
}

/** Waits until the page has read its guess (it loads meantPage.ts once shown). */
async function guessed() {
  await import("./meantPage");
  await act(async () => {});
}

describe("a page that doesn't exist", () => {
  it("links the page the address most likely meant", async () => {
    openUnknown("/docs/validation.md");
    expect(await screen.findByRole("heading", { level: 1, name: "This page doesn't exist" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Accuracy check" })).toHaveAttribute("href", "/accuracy");
    const guess = screen.getByText(/Did you mean/);
    expect(guess).toHaveTextContent(/^Did you mean Accuracy check\?$/);
    expect(guess).toHaveAttribute("aria-live", "polite"); // it comes a moment after the page, so it's said when it comes
    expect(screen.getByRole("link", { name: "Back to the start" })).toHaveAttribute("href", "/");
  });

  it("guesses nothing when no page is near the address", async () => {
    const { container } = openUnknown("/nowhere");
    expect(await screen.findByRole("heading", { level: 1, name: "This page doesn't exist" })).toBeInTheDocument();
    await guessed();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    expect(container.querySelector("[aria-live='polite']")).toBeEmptyDOMElement();
  });

  it("guesses nothing on an app screen, whose sidebar lists the screens", async () => {
    const { container } = openUnknown("/demo/instal", true);
    expect(await screen.findByRole("heading", { level: 1, name: "This page doesn't exist" })).toBeInTheDocument();
    await guessed();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull(); // nor an empty live region waiting for a guess
    expect(screen.getByRole("link", { name: "Back to the start" })).toHaveAttribute("href", "/demo");
  });
});

/** Opens a page whose code fails to load, under a parent with the site's error page, as in the site's router. */
function openFailing(error: Error) {
  const router = createMemoryRouter([
    { path: "/", errorElement: <RouteError />, children: [{ index: true, lazy: async () => { throw error; } }] },
  ]);
  render(<RouterProvider router={router} />);
}

afterEach(() => vi.restoreAllMocks());

describe("a page that breaks", () => {
  it.each([
    ["Chrome and Edge", "Failed to fetch dynamically imported module: https://site.example/assets/Troubleshooting-x1.js"],
    ["Firefox", "error loading dynamically imported module: https://site.example/assets/Troubleshooting-x1.js"],
    ["Safari", "Importing a module script failed."],
  ])("says the site was updated when the page's code can't load (%s), and keeps it out of the console", async (_, message) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    openFailing(new TypeError(message));
    expect(await screen.findByRole("heading", { level: 1, name: "Mesh Doctor has been updated" })).toBeInTheDocument();
    expect(screen.getByText(/opened before the update.*Reload to get the new version/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Updated · Mesh Doctor")); // set once the page has rendered
    expect(log).not.toHaveBeenCalledWith("Mesh Doctor page error:", expect.anything());
  });

  it("asks for a report on anything else, with the error in the console", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    openFailing(new Error("Cannot read properties of undefined (reading 'cells')"));
    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong on this page" })).toBeInTheDocument();
    expect(screen.getByText(/please report it on GitHub/)).toBeInTheDocument();
    await waitFor(() => expect(log).toHaveBeenCalledWith("Mesh Doctor page error:", expect.any(Error))); // logged once shown
  });
});
