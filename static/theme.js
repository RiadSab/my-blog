// Light/dark switch. The page follows the system theme until the visitor
// picks one; the choice is saved, and the inline script in <head> applies
// it before the page paints so there is no flash of the wrong theme.
(function () {
  var root = document.documentElement;
  var button = document.querySelector(".theme-toggle");
  var meta = document.querySelector('meta[name="theme-color"]');
  // Blog only: the dark code-highlighting stylesheet follows the switch too.
  var codeDark = document.getElementById("code-dark");
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  if (!button) return;

  function current() {
    return root.dataset.theme || (systemDark.matches ? "dark" : "light");
  }

  function sync() {
    var dark = current() === "dark";
    var label = dark ? "Switch to light theme" : "Switch to dark theme";
    button.setAttribute("aria-label", label);
    button.title = label;
    if (meta) meta.content = dark ? "#2a201d" : "#d3d2c8";
    if (codeDark) {
      codeDark.media = root.dataset.theme
        ? (dark ? "all" : "not all")
        : "(prefers-color-scheme: dark)";
    }
  }

  button.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (e) {}
    sync();
  });

  systemDark.addEventListener("change", sync);
  sync();
})();
