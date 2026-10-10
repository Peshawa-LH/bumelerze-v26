// Bumelerze website: the one script, shared by every page, loaded with
// `defer`. Everything here is progressive enhancement: each page works and
// reads correctly with it turned off. No dependencies, no trackers, no
// cookies; the only network requests are the two public earthquake feeds
// the live card reads (USGS and EMSC), the same ones the app reads.
(function () {
  "use strict";

  let reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------- language menu
  // A native <details>; this only closes it on an outside click or Escape.
  function closeMenus(except) {
    document
      .querySelectorAll("details.lang-menu[open], details.nav-menu[open]")
      .forEach(function (d) {
        if (d !== except) d.removeAttribute("open");
      });
  }
  document.addEventListener("click", function (e) {
    closeMenus(
      e.target.closest && e.target.closest("details.lang-menu, details.nav-menu"),
    );
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenus(null);
  });

  // ------------------------------------------- seismic line, draw-in once
  let lines = document.querySelectorAll(".act-line");
  if (lines.length && !reduceMotion && "IntersectionObserver" in window) {
    document.documentElement.classList.add("js-draw");
    const lineObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          // Also when it was scrolled past too fast to be seen intersecting.
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            entry.target.classList.add("is-drawn");
            lineObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    lines.forEach(function (l) {
      lineObserver.observe(l);
    });
  }

  // ------------------------------------------------------------ live card
  // A small carousel: the latest earthquake near Kurdistan, then up to three
  // significant earthquakes worldwide, each linking to its page in the app.
  const dataEl = document.getElementById("site-data");
  const liveRoot = document.querySelector("[data-live-root]");
  if (dataEl && liveRoot) {
    liveCard(JSON.parse(dataEl.textContent), liveRoot);
  }

  function liveCard(data, root) {
    const body = root.querySelector("[data-live]");
    // Same region rule as the app's Home feed: the region box
    // (src/features/events/config.ts REGION_BBOX), magnitude 3 and up, the
    // 180-day fetch window.
    const box = { minLat: 33.0, maxLat: 38.5, minLon: 41.0, maxLon: 48.5 };
    const inBox = (e) =>
      e.lat >= box.minLat &&
      e.lat <= box.maxLat &&
      e.lon >= box.minLon &&
      e.lon <= box.maxLon;
    const start = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    const usgs =
      "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=1&minmagnitude=3" +
      "&minlatitude=" +
      box.minLat +
      "&maxlatitude=" +
      box.maxLat +
      "&minlongitude=" +
      box.minLon +
      "&maxlongitude=" +
      box.maxLon +
      "&starttime=" +
      start;
    const emsc =
      "https://www.seismicportal.eu/fdsnws/event/1/query?format=json&orderby=time&limit=1&minmag=3" +
      "&minlat=" +
      box.minLat +
      "&maxlat=" +
      box.maxLat +
      "&minlon=" +
      box.minLon +
      "&maxlon=" +
      box.maxLon +
      "&starttime=" +
      start;
    // The app's Significant list for the world: the USGS M4.5+ week feed,
    // sig = 100 x magnitude + PAGER bonus, kept at 600 and up
    // (src/features/events/normalize.ts, config.ts SIGNIFICANCE_THRESHOLDS).
    const world =
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
    const alertBonus = { green: 0, yellow: 100, orange: 200, red: 300 };

    function getJson(url, ms) {
      const ctrl = "AbortController" in window ? new AbortController() : null;
      const timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
      }, ms || 6000);
      return fetch(url, ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .finally(function () {
          clearTimeout(timer);
        });
    }

    const fromUsgsFeature = function (f) {
      return {
        id: f.id,
        t: f.properties.time,
        mag: f.properties.mag,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        src: "USGS",
        place: f.properties.place || "",
        sig: Math.round(100 * f.properties.mag + (alertBonus[f.properties.alert] || 0)),
      };
    };

    const regional = Promise.allSettled([
      getJson(usgs).then(function (j) {
        const f = j && j.features && j.features[0];
        return f && f.properties.mag != null ? fromUsgsFeature(f) : null;
      }),
      getJson(emsc).then(function (j) {
        const f = j && j.features && j.features[0];
        if (!f || f.properties.mag == null) return null;
        const p = f.properties;
        return {
          id: p.unid,
          t: Date.parse(p.time),
          mag: p.mag,
          lat: p.lat,
          lon: p.lon,
          src: "EMSC",
          place: p.flynn_region || "",
        };
      }),
    ]).then(function (results) {
      const u = results[0].status === "fulfilled" ? results[0].value : null;
      const e = results[1].status === "fulfilled" ? results[1].value : null;
      let pick = u && e ? (e.t > u.t ? e : u) : u || e;
      // The app's merge rule: the same quake from two networks is shown
      // once, USGS first (16 s, 50 km).
      if (pick === e && u && Math.abs(u.t - e.t) <= 16000 && km(u, e) <= 50) pick = u;
      return pick && isFinite(pick.t) ? pick : null;
    });

    const significant = getJson(world)
      .then(function (j) {
        return (j.features || [])
          .filter(function (f) {
            return f.properties.mag != null;
          })
          .map(fromUsgsFeature)
          .filter(function (ev) {
            return ev.sig >= 600 && !inBox(ev);
          })
          .sort(function (a, b) {
            return b.sig - a.sig || b.t - a.t;
          })
          .slice(0, 3);
      })
      .then(function (list) {
        if (!list.length) return list;
        // Region names for far events, in the page language (the app's
        // Flinn-Engdahl table); without it the network's own place text.
        return getJson(data.fe, 5000)
          .then(function (fe) {
            list.forEach(function (ev) {
              ev.region = feName(fe, ev.lat, ev.lon);
            });
            return list;
          })
          .catch(function () {
            return list;
          });
      });

    Promise.allSettled([regional, significant]).then(function (res) {
      const slides = [];
      const near = res[0].status === "fulfilled" ? res[0].value : null;
      if (near) slides.push({ ev: near, label: data.labelNear });
      if (res[1].status === "fulfilled") {
        res[1].value.forEach(function (ev) {
          if (
            near &&
            (ev.id === near.id ||
              (Math.abs(ev.t - near.t) <= 16000 && km(ev, near) <= 50))
          )
            return;
          slides.push({ ev: ev, label: data.labelWorld });
        });
      }
      if (!slides.length) fail();
      else render(slides);
    });

    function fail() {
      body.textContent = "";
      const label = el("p", "live-label", data.labelNear);
      body.appendChild(label);
      const p = el("p", "live-fallback", data.fallback);
      body.appendChild(p);
      body.setAttribute("aria-busy", "false");
    }

    function digits(s) {
      s = String(s);
      return data.digits === "arab"
        ? s.replace(/[0-9]/g, function (d) {
            return "٠١٢٣٤٥٦٧٨٩"[d];
          })
        : s;
    }

    function fill(tpl, vars) {
      return tpl.replace(/\{\{(\w+)\}\}/g, function (_, k) {
        return vars[k];
      });
    }

    function placeLine(ev) {
      let best = null;
      data.cities.forEach(function (c) {
        const d = km(ev, { lat: c[1], lon: c[2] });
        if (!best || d < best.d) best = { c: c, d: d };
      });
      if (!best || best.d > 300) return ev.region || ev.place;
      const dist = best.d >= 10 ? Math.round(best.d) : Math.round(best.d * 10) / 10;
      const dir =
        data.dirs[Math.round(bearing({ lat: best.c[1], lon: best.c[2] }, ev) / 45) % 8];
      return fill(data.place, {
        distance: "⁨" + digits(dist) + " " + data.km + "⁩",
        direction: dir,
        city: best.c[0],
      });
    }

    function ago(t) {
      const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
      const unit = mins < 60 ? "minute" : mins < 1440 ? "hour" : "day";
      const value =
        unit === "minute"
          ? mins
          : unit === "hour"
            ? Math.round(mins / 60)
            : Math.round(mins / 1440);
      const locale = data.lang === "kmr" ? "ku" : data.lang;
      try {
        if (
          window.Intl &&
          Intl.RelativeTimeFormat &&
          Intl.RelativeTimeFormat.supportedLocalesOf(locale).length
        ) {
          return digits(
            new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(
              -value,
              unit,
            ),
          );
        }
      } catch {
        /* fall through to the app's own wording */
      }
      return fill(data.rel[unit[0]], { value: digits(value) });
    }

    function slideEl(s, i, total) {
      const ev = s.ev;
      const wrap = el("div", "live-slide", "");
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-roledescription", "slide");
      wrap.setAttribute(
        "aria-label",
        fill(data.slide, { n: digits(i + 1), total: digits(total) }),
      );
      const label = el("p", "live-label", "");
      label.appendChild(el("span", "live-dot", ""));
      label.lastChild.setAttribute("aria-hidden", "true");
      label.appendChild(document.createTextNode(s.label));
      const a = document.createElement("a");
      a.className = "live-card";
      a.href = data.app + "event/" + encodeURIComponent(ev.id);
      const meta = el("span", "live-meta", "");
      const time = document.createElement("time");
      time.dateTime = new Date(ev.t).toISOString();
      time.textContent = ago(ev.t);
      const src = document.createElement("bdi");
      src.textContent = ev.src;
      meta.appendChild(time);
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(src);
      const open = el("span", "live-open", data.open + " ");
      open.appendChild(el("span", "arrow", ""));
      open.lastChild.setAttribute("aria-hidden", "true");
      [
        el("span", "live-mag", fill(data.mag, { value: digits(ev.mag.toFixed(1)) })),
        el("span", "live-place", placeLine(ev)),
        meta,
        open,
      ].forEach(function (n) {
        a.appendChild(n);
      });
      wrap.appendChild(label);
      wrap.appendChild(a);
      return wrap;
    }

    function render(slides) {
      body.textContent = "";
      body.setAttribute("aria-busy", "false");
      const track = el("div", "live-track", "");
      const nodes = slides.map(function (s, i) {
        const n = slideEl(s, i, slides.length);
        n.hidden = i > 0;
        track.appendChild(n);
        return n;
      });
      body.appendChild(track);
      if (slides.length < 2) return;

      root.setAttribute("aria-roledescription", "carousel");
      let index = 0;
      let timer = null;
      const controls = el("div", "live-controls", "");
      const prev = el("button", "live-step live-prev", "");
      prev.type = "button";
      prev.setAttribute("aria-label", data.prev);
      const next = el("button", "live-step live-next", "");
      next.type = "button";
      next.setAttribute("aria-label", data.next);
      const dots = el("div", "live-dots", "");
      const dotEls = slides.map(function (s, i) {
        const d = el("button", "live-dot-btn", "");
        d.type = "button";
        d.setAttribute(
          "aria-label",
          fill(data.slide, { n: digits(i + 1), total: digits(slides.length) }),
        );
        d.addEventListener("click", function () {
          show(i, true);
        });
        dots.appendChild(d);
        return d;
      });
      prev.addEventListener("click", function () {
        show((index - 1 + nodes.length) % nodes.length, true);
      });
      next.addEventListener("click", function () {
        show((index + 1) % nodes.length, true);
      });
      controls.appendChild(prev);
      controls.appendChild(dots);
      controls.appendChild(next);
      body.appendChild(controls);

      function show(i, byUser) {
        index = i;
        nodes.forEach(function (n, k) {
          n.hidden = k !== i;
        });
        dotEls.forEach(function (d, k) {
          d.setAttribute("aria-current", k === i ? "true" : "false");
        });
        // Announce only changes the reader asked for, never auto-advance.
        track.setAttribute("aria-live", byUser ? "polite" : "off");
        if (byUser) stop();
      }
      function stop() {
        if (timer) clearInterval(timer);
        timer = null;
      }
      function startAuto() {
        if (reduceMotion || timer) return;
        timer = setInterval(function () {
          show((index + 1) % nodes.length, false);
        }, 7000);
      }
      root.addEventListener("mouseenter", stop);
      root.addEventListener("mouseleave", startAuto);
      root.addEventListener("focusin", stop);
      root.addEventListener("focusout", function (e) {
        if (!root.contains(e.relatedTarget)) startAuto();
      });
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stop();
        else startAuto();
      });
      show(0, false);
      startAuto();
    }
  }

  /** Flinn-Engdahl region name for a point, from the per-language table the
   * build writes (data/fe-<lang>.json); same lookup as the app's
   * src/features/geo/fe-region.ts. */
  function feName(fe, lat, lon) {
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const lonValue = lon === -180 ? 180 : lon;
    const absLon = Math.trunc(Math.abs(lonValue));
    const absLat = Math.trunc(Math.abs(lat));
    const quadrant = lat >= 0 ? (lonValue >= 0 ? 0 : 1) : lonValue >= 0 ? 2 : 3;
    const row = fe.grid[quadrant * 91 + absLat];
    if (!row) return null;
    let found = 0;
    for (let i = 0; i < row.length; i += 4) {
      if (parseInt(row.slice(i, i + 2), 36) > absLon) break;
      found = parseInt(row.slice(i + 2, i + 4), 36);
    }
    return found >= 1 ? fe.names[found - 1] || null : null;
  }

  function el(tag, cls, text) {
    let n = document.createElement(tag);
    n.className = cls;
    n.textContent = text;
    return n;
  }

  function rad(d) {
    return (d * Math.PI) / 180;
  }

  function km(a, b) {
    let dLat = rad(b.lat - a.lat);
    let dLon = rad(b.lon - a.lon);
    let h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) *
        Math.cos(rad(b.lat)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearing(from, to) {
    let y = Math.sin(rad(to.lon - from.lon)) * Math.cos(rad(to.lat));
    let x =
      Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) -
      Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lon - from.lon));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  // -------------------------------------------------------- support page
  // Search filters the questions as you type (question and answer text, in
  // the page language) and a #group or #question link opens its item. All
  // progressive enhancement: without script every question is visible.
  const faqItems = Array.from(document.querySelectorAll(".faq-item"));
  if (faqItems.length) {
    const norm = (s) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[يى]/g, "ی")
        .replace(/ك/g, "ک")
        .replace(/[ةە]/g, "ه")
        .replace(/ـ/g, "")
        .replace(/\s+/g, " ");
    const index = faqItems.map((el) => ({ el, text: norm(el.textContent) }));
    const groups = Array.from(document.querySelectorAll("[data-faq-group]"));
    const empty = document.querySelector("[data-faq-empty]");
    const box = document.querySelector("[data-faq-search-wrap]");
    const input = document.querySelector("[data-faq-search]");
    if (box && input) {
      box.hidden = false;
      input.addEventListener("input", function () {
        const words = norm(input.value.trim()).split(" ").filter(Boolean);
        let shown = 0;
        index.forEach(function (item) {
          const match = words.every(function (w) {
            return item.text.includes(w);
          });
          item.el.hidden = !match;
          if (match) shown += 1;
        });
        groups.forEach(function (g) {
          g.hidden = !g.querySelector(".faq-item:not([hidden])");
        });
        if (empty) empty.hidden = shown > 0;
        // A short list of matches opens, so the answer is right there.
        if (words.length && shown <= 3) {
          index.forEach(function (item) {
            if (!item.el.hidden) item.el.open = true;
          });
        }
      });
    }
    const openFromHash = function () {
      const id = decodeURIComponent(location.hash.slice(1));
      const target = id && document.getElementById(id);
      if (target && target.tagName === "DETAILS") {
        target.open = true;
        target.scrollIntoView({ block: "start" });
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
  }

  // ------------------------------------------------------------ felt strip
  // A demonstration only: choosing a picture shows the app's "thank you"
  // tick. Nothing is sent anywhere.
  let felt = document.querySelector("[data-felt]");
  if (felt) {
    let sent = felt.querySelector("[data-felt-sent]");
    felt.querySelectorAll(".felt-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        felt.querySelectorAll(".felt-btn").forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        sent.classList.remove("is-on");
        void sent.offsetWidth; // restart the tick animation
        sent.querySelector(".felt-thanks").textContent = sent.getAttribute("data-thanks");
        sent.querySelector(".felt-note").textContent = sent.getAttribute("data-note");
        sent.classList.add("is-on");
      });
    });
  }

  // -------------------------------------------------------------- waveform
  // Three gentle seismograph traces with a small quake arriving now and
  // then, a little later on each trace. Runs only while on screen, and is a
  // still picture under prefers-reduced-motion.
  let canvas = document.querySelector("canvas[data-wave]");
  if (canvas && canvas.getContext) waveform(canvas);

  function waveform(cv) {
    let ctx = cv.getContext("2d");
    let colors = ["#fff5e8", "#f2b632", "#e8898c"];
    let W = 0;
    let H = 0;
    let dpr = 1;
    let traces = [[], [], []];
    let tick = 0;
    let quakeAt = 90;
    let running = false;
    let visible = false;
    let raf = 0;

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = cv.clientWidth || 640;
      W = Math.round(w * dpr);
      H = Math.round(w * (300 / 640) * dpr);
      cv.width = W;
      cv.height = H;
      let n = Math.ceil(W / (2 * dpr));
      traces = traces.map(function (t) {
        while (t.length < n) t.unshift(0);
        return t.slice(t.length - n);
      });
    }

    function sample(i) {
      let noise = (Math.random() - 0.5) * 0.09 + Math.sin(tick / (7 + i)) * 0.025;
      let since = tick - quakeAt - i * 9;
      let quake = 0;
      if (since > 0 && since < 260) {
        let env = Math.min(1, since / 6) * Math.exp(-since / 55);
        quake =
          env * 0.85 * Math.sin(since * (0.55 - i * 0.07)) * (0.8 + Math.random() * 0.4);
      }
      return noise + quake;
    }

    function step() {
      tick += 1;
      if (tick - quakeAt > 300) quakeAt = tick + 60 + Math.floor(Math.random() * 80);
      traces.forEach(function (t, i) {
        t.push(sample(i));
        t.shift();
      });
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      let band = H / 3;
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = "rgba(255,245,232,0.08)";
      for (let g = 1; g < 3; g++) {
        ctx.beginPath();
        ctx.moveTo(0, band * g);
        ctx.lineTo(W, band * g);
        ctx.stroke();
      }
      traces.forEach(function (t, i) {
        let mid = band * i + band / 2;
        ctx.beginPath();
        ctx.lineWidth = 1.6 * dpr;
        ctx.strokeStyle = colors[i];
        for (let x = 0; x < t.length; x++) {
          let y = mid - t[x] * band * 0.55;
          if (x === 0) ctx.moveTo(0, y);
          else ctx.lineTo(x * 2 * dpr, y);
        }
        ctx.stroke();
      });
    }

    function loop() {
      if (!running) return;
      step();
      step();
      draw();
      raf = requestAnimationFrame(loop);
    }

    function setRunning(on) {
      if (on === running) return;
      running = on;
      if (on) raf = requestAnimationFrame(loop);
      else cancelAnimationFrame(raf);
    }

    size();
    // Fill the traces once so the first (or only) frame already shows a quake.
    quakeAt = 40;
    for (let k = 0; k < traces[0].length; k++) step();
    draw();

    window.addEventListener("resize", function () {
      size();
      draw();
    });

    if (reduceMotion || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      setRunning(visible && !document.hidden);
    }).observe(cv);
    document.addEventListener("visibilitychange", function () {
      setRunning(visible && !document.hidden);
    });
  }
})();
