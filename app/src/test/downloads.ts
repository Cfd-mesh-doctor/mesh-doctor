// SPDX-License-Identifier: GPL-3.0-or-later
// Catches the files a page hands the browser to save (an <a download> clicked with an object URL), since jsdom has
// no object URLs and doesn't download. Call restore() when the test is done.
import { vi } from "vitest";

export interface SavedFile {
  name: string;
  type: string;
  /** whether the link was in the page when clicked (some browsers ignore a click on a link outside it) */
  inPage: boolean;
  text: () => Promise<string>;
}

/** A Blob's text through FileReader, which jsdom has (its Blob has no text()). */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("could not read the file"));
    r.readAsText(blob);
  });
}

export function catchDownloads() {
  const blobs = new Map<string, Blob>();
  const saved: SavedFile[] = [];
  const revoked: string[] = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, obj as Blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.getAttribute("href") ?? "");
    if (blob && this.download) saved.push({ name: this.download, type: blob.type, inPage: this.isConnected, text: () => blobText(blob) });
  });
  return {
    saved,
    revoked,
    /** the object URLs made and not yet let go */
    open: () => [...blobs.keys()].filter((u) => !revoked.includes(u)),
    restore: () => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
      click.mockRestore();
    },
  };
}
