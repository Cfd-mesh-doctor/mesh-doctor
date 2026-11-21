// SPDX-License-Identifier: GPL-3.0-or-later
// Sets the colour theme before the page paints. It is a file, not inline script,
// because the site's Content-Security-Policy runs no inline script at all.
(function () {
  var dark = false;
  try {
    var t = localStorage.getItem("md-theme");
    dark = t === "dark" || ((!t || t === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
  } catch (e) {
    dark = matchMedia("(prefers-color-scheme: dark)").matches;
  }
  document.documentElement.classList.toggle("dark", dark);
})();
