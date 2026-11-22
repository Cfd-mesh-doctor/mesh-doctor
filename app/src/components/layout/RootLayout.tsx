// SPDX-License-Identifier: GPL-3.0-or-later
import { Outlet, ScrollRestoration } from "react-router";

/** Around every page: a new page starts at its top, or at the section a link names (/#how), and Back
 *  returns to where you were. */
export function RootLayout() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}
