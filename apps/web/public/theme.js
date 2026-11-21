// Runs in <head> before first paint: applies the saved light/dark choice and the
// intro/outro flags, so the page never flashes the wrong theme or the wrong screen.
(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("pb-theme");
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch (e) {}
  // Just signed in (?intro): the liquid-metal logo is the very first thing painted.
  if (/[?&]intro\b/.test(location.search)) root.classList.add("intro");
  // Just signed out (/login?out): the login page flies the logo back into its card.
  if (/[?&]out\b/.test(location.search)) {
    root.classList.add("out");
    setTimeout(function () { root.classList.remove("out"); }, 2500); // never leave the page hidden
  }
})();
