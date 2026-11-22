// SPDX-License-Identifier: GPL-3.0-or-later
import type { NavigateOptions } from "react-router";

/**
 * How a field whose words live in the address (the Docs and Troubleshooting searches' ?q=, the estimator's fields)
 * writes them there as they're typed: in place of the current entry, so Back leaves the page rather than taking a
 * letter off; without scrolling; and at once. React Router otherwise updates the page in a transition, a moment
 * later, and a field drawn from the address meanwhile shows what it held before, so fast typing lost letters:
 * "SIGKILL patchField" came out as "pad" (e2e/typing.spec.ts).
 */
export const ADDRESS_FIELD: NavigateOptions = { replace: true, preventScrollReset: true, flushSync: true };
