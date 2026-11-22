// SPDX-License-Identifier: GPL-3.0-or-later
import { Outlet, ScrollRestoration, type Location } from "react-router";

/** Where the scroll position of a page is remembered. A page opened from outside the site (a typed, shared or
 *  bookmarked link) has no key of its own: React Router calls them all "default", so a shared link to a step
 *  (/how-it-works#judge) would open where some other page was left in this tab. Those are remembered by address. */
function scrollKey(location: Location): string {
  return location.key === "default" ? `${location.pathname}${location.search}${location.hash}` : location.key;
}

/** Around every page: a new page starts at its top, or at the section a link names (/#how), and Back
 *  returns to where you were. */
export function RootLayout() {
  return (
    <>
      <ScrollRestoration getKey={scrollKey} />
      <Outlet />
    </>
  );
}
