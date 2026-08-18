/**
 * Bumelerze hero slider: progressive enhancement only.
 *
 * Without this file, `.hero-slider-track` is a plain native horizontally
 * scrolling, scroll-snapping element with real <a href="#slide-N">
 * dot/prev/next links: swipe, trackpad, and (once the track has focus)
 * arrow-key scrolling all already work via the browser, and the fragment
 * links already move the target slide into view. See the long comment
 * above ".hero-slider-track" in style.css for the full no-JS contract.
 *
 * What this script adds on top of that baseline:
 *   - explicit smooth/instant scrollTo() for the dot/prev/next links,
 *     respecting prefers-reduced-motion itself (an explicit `behavior`
 *     option passed to scrollTo() overrides the CSS scroll-behavior
 *     property, so the reduced-motion check has to happen here too, not
 *     only in CSS);
 *   - ArrowLeft/ArrowRight keyboard navigation while the slider has focus
 *     (in addition to the browser's native arrow-key scroll on a focused
 *     scroll container);
 *   - aria-current on the active dot, and a visually-hidden live region
 *     announcing "Slide N of TOTAL: <label>" on every change, so
 *     screen-reader users get feedback that scroll-snap alone never
 *     provides.
 *
 * No autoplay anywhere in this file, ever: see the design-decision note
 * in style.css. Nothing here is required for the slider to be usable.
 */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  function scrollBehavior() {
    return reduceMotion.matches ? "auto" : "smooth";
  }

  function initSlider(root) {
    var track = root.querySelector(".hero-slider-track");
    var slides = Array.prototype.slice.call(
      root.querySelectorAll(".hero-slide"),
    );
    var dots = Array.prototype.slice.call(root.querySelectorAll(".hero-dot"));
    var prev = root.querySelector(".hero-slider-prev");
    var next = root.querySelector(".hero-slider-next");
    var status = root.querySelector(".hero-slider-status");
    if (!track || slides.length === 0) return;

    function labelFor(index) {
      var slide = slides[index];
      return slide ? slide.getAttribute("data-slide-label") || "" : "";
    }

    function goTo(index) {
      if (index < 0) index = 0;
      if (index > slides.length - 1) index = slides.length - 1;
      var target = slides[index];
      track.scrollTo({
        left: target.offsetLeft - track.offsetLeft,
        behavior: scrollBehavior(),
      });
    }

    function currentIndex() {
      var trackRect = track.getBoundingClientRect();
      var center = trackRect.left + trackRect.width / 2;
      var closest = 0;
      var closestDist = Infinity;
      slides.forEach(function (slide, i) {
        var r = slide.getBoundingClientRect();
        var slideCenter = r.left + r.width / 2;
        var dist = Math.abs(slideCenter - center);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });
      return closest;
    }

    function setActive(index) {
      dots.forEach(function (dot, i) {
        if (i === index) {
          dot.setAttribute("aria-current", "true");
        } else {
          dot.removeAttribute("aria-current");
        }
      });
      if (status) {
        status.textContent =
          "Slide " +
          (index + 1) +
          " of " +
          slides.length +
          ": " +
          labelFor(index);
      }
    }

    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function (event) {
        event.preventDefault();
        goTo(i);
      });
    });

    if (prev) {
      prev.addEventListener("click", function (event) {
        event.preventDefault();
        goTo(currentIndex() - 1);
      });
    }
    if (next) {
      next.addEventListener("click", function (event) {
        event.preventDefault();
        goTo(currentIndex() + 1);
      });
    }

    track.setAttribute("tabindex", "0");
    track.addEventListener("keydown", function (event) {
      var isRtl = getComputedStyle(root).direction === "rtl";
      var toPrev = isRtl ? "ArrowRight" : "ArrowLeft";
      var toNext = isRtl ? "ArrowLeft" : "ArrowRight";
      if (event.key === toPrev) {
        event.preventDefault();
        goTo(currentIndex() - 1);
      } else if (event.key === toNext) {
        event.preventDefault();
        goTo(currentIndex() + 1);
      }
    });

    var ticking = false;
    track.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        setActive(currentIndex());
        ticking = false;
      });
    });

    setActive(currentIndex());
  }

  document.addEventListener("DOMContentLoaded", function () {
    var sliders = document.querySelectorAll("[data-slider]");
    Array.prototype.forEach.call(sliders, initSlider);
  });
})();
