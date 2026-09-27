// Language menu in the site header: a native <details> element, so it works
// without this script; this only closes it when the reader clicks elsewhere
// or presses Escape, which <details> does not do on its own.
(function () {
  function closeAll(except) {
    document.querySelectorAll("details.lang-menu[open]").forEach(function (d) {
      if (d !== except) d.removeAttribute("open");
    });
  }
  document.addEventListener("click", function (e) {
    closeAll(e.target.closest && e.target.closest("details.lang-menu"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll(null);
  });
})();
