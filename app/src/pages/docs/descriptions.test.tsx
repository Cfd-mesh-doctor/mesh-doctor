// SPDX-License-Identifier: GPL-3.0-or-later
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTitle } from "@/lib/useTitle";
import { pageAt } from "@/test/pages";
import { renderScreen } from "@/test/render";
import { ON_SITE } from "./entries";

const SITE = "The site's own description.";
const meta = () => document.querySelector<HTMLMetaElement>('meta[name="description"]');

beforeEach(() => {
  const tag = document.createElement("meta");
  tag.name = "description";
  tag.content = SITE;
  document.head.append(tag);
});
afterEach(() => meta()?.remove());

function Titled({ title, about }: { title?: string; about?: string }) {
  useTitle(title, about);
  return null;
}

describe("a page's description for search results", () => {
  it("is the page's own while it shows, and the site's again on a page without one", () => {
    const { rerender } = render(<Titled title="Limits" about="What it is not." />);
    expect(document.title).toBe("Limits · Mesh Doctor");
    expect(meta()?.content).toBe("What it is not.");
    rerender(<Titled title="Jobs" />);
    expect(document.title).toBe("Jobs · Mesh Doctor");
    expect(meta()?.content).toBe(SITE);
  });

  const listed = ON_SITE.flatMap((d) => (d.page ? [[d.title, d.page, d.about] as const] : []));
  it.each(listed)("%s (%s) is described as the Docs page describes it", async (_, path, about) => {
    const Page = await pageAt(path);
    renderScreen(<Page />, { path });
    expect(meta()?.content).toBe(about);
  });
});
