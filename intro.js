(() => {
  'use strict';

  const root = document.documentElement;
  if (!root.classList.contains('intro-active')) return;

  const intro = document.getElementById('pageIntro');
  const logo = document.getElementById('introLogo');
  const skip = document.getElementById('skipIntro');
  const shell = document.querySelector('.app-shell');
  if (!intro || !logo || !skip || !shell) {
    root.classList.remove('intro-active', 'intro-exiting');
    window.clearTimeout(window.inventoryIntroFallback);
    return;
  }

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let finished = false;
  let still = motion.matches;
  let playbackTimer;
  let loadTimer;
  let exitTimer;

  function cleanup() {
    window.clearTimeout(playbackTimer);
    window.clearTimeout(loadTimer);
    window.clearTimeout(exitTimer);
    window.clearTimeout(window.inventoryIntroFallback);
    root.classList.remove('intro-active', 'intro-exiting');
    intro.hidden = true;
    intro.setAttribute('aria-hidden', 'true');
    shell.inert = false;
    shell.removeAttribute('aria-hidden');
    logo.removeEventListener('load', onLoad);
    logo.removeEventListener('error', onError);
    skip.removeEventListener('click', finish);
    document.removeEventListener('keydown', onKey);
    motion.removeEventListener('change', onMotionChange);
    window.removeEventListener('pagehide', onPageHide);
  }

  function finish() {
    if (finished) return;
    finished = true;
    window.clearTimeout(playbackTimer);
    window.clearTimeout(loadTimer);
    window.clearTimeout(window.inventoryIntroFallback);
    const restoreFocus = intro.contains(document.activeElement);
    shell.inert = false;
    shell.removeAttribute('aria-hidden');
    intro.setAttribute('aria-hidden', 'true');
    skip.disabled = true;
    root.classList.add('intro-exiting');
    if (restoreFocus) document.getElementById('pageTitle')?.focus({ preventScroll: true });
    if (motion.matches) cleanup();
    else exitTimer = window.setTimeout(cleanup, 340);
  }

  function onLoad() {
    if (finished) return;
    window.clearTimeout(loadTimer);
    window.clearTimeout(playbackTimer);
    playbackTimer = window.setTimeout(finish, still || motion.matches ? 900 : 5100);
  }

  function onError() {
    if (finished) return;
    window.clearTimeout(loadTimer);
    if (still) { finish(); return; }
    still = true;
    logo.src = logo.dataset.stillSrc;
    loadTimer = window.setTimeout(finish, 1500);
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
    if (event.key === 'Tab' && !finished) { event.preventDefault(); skip.focus({ preventScroll: true }); }
  }

  function onMotionChange() { finish(); }
  function onPageHide() { finished = true; cleanup(); }

  intro.hidden = false;
  shell.inert = true;
  shell.setAttribute('aria-hidden', 'true');
  logo.addEventListener('load', onLoad);
  logo.addEventListener('error', onError);
  skip.addEventListener('click', finish);
  document.addEventListener('keydown', onKey);
  motion.addEventListener('change', onMotionChange);
  window.addEventListener('pagehide', onPageHide);
  loadTimer = window.setTimeout(onError, 3000);
  if (logo.complete && logo.naturalWidth > 0) onLoad();
})();
