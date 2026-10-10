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
  let dataEl = document.getElementById("site-data");
  let liveBody = document.querySelector("[data-live]");
  if (dataEl && liveBody) {
    liveCard(JSON.parse(dataEl.textContent), liveBody);
  }

  function liveCard(data, body) {
    // Same region rule as the app's Home feed: the region box
    // (src/features/events/config.ts REGION_BBOX), magnitude 3 and up, the
    // 180-day fetch window.
    let box = { minLat: 33.0, maxLat: 38.5, minLon: 41.0, maxLon: 48.5 };
    let start = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    let usgs =
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
    let emsc =
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

    function getJson(url) {
      let ctrl = "AbortController" in window ? new AbortController() : null;
      let timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
      }, 7000);
      return fetch(url, ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .finally(function () {
          clearTimeout(timer);
        });
    }

    function first(json) {
      return json && json.features && json.features[0];
    }

    let fromUsgs = getJson(usgs).then(function (j) {
      let f = first(j);
      if (!f || f.properties.mag == null) return null;
      return {
        id: f.id,
        t: f.properties.time,
        mag: f.properties.mag,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        src: "USGS",
        place: f.properties.place || "",
      };
    });
    let fromEmsc = getJson(emsc).then(function (j) {
      let f = first(j);
      if (!f || f.properties.mag == null) return null;
      let p = f.properties;
      return {
        id: p.unid,
        t: Date.parse(p.time),
        mag: p.mag,
        lat: p.lat,
        lon: p.lon,
        src: "EMSC",
        place: p.flynn_region || "",
      };
    });

    Promise.allSettled([fromUsgs, fromEmsc]).then(function (results) {
      let u = results[0].status === "fulfilled" ? results[0].value : null;
      let e = results[1].status === "fulfilled" ? results[1].value : null;
      let pick = u && e ? (e.t > u.t ? e : u) : u || e;
      // The app's merge rule: the same quake from two networks is shown once,
      // USGS first (16 s, 50 km).
      if (pick === e && u && Math.abs(u.t - e.t) <= 16000 && km(u, e) <= 50) pick = u;
      if (!pick || !isFinite(pick.t)) {
        fail();
        return;
      }
      render(pick);
    });

    function fail() {
      body.textContent = "";
      let p = document.createElement("p");
      p.className = "live-fallback";
      p.textContent = data.fallback;
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
        let d = km(ev, { lat: c[1], lon: c[2] });
        if (!best || d < best.d) best = { c: c, d: d };
      });
      if (!best || best.d > 300) return ev.place;
      let dist = best.d >= 10 ? Math.round(best.d) : Math.round(best.d * 10) / 10;
      let dir =
        data.dirs[Math.round(bearing({ lat: best.c[1], lon: best.c[2] }, ev) / 45) % 8];
      return fill(data.place, {
        distance: "⁨" + digits(dist) + " " + data.km + "⁩",
        direction: dir,
        city: best.c[0],
      });
    }

    function ago(t) {
      let mins = Math.max(0, Math.round((Date.now() - t) / 60000));
      let unit = mins < 60 ? "minute" : mins < 1440 ? "hour" : "day";
      let value =
        unit === "minute"
          ? mins
          : unit === "hour"
            ? Math.round(mins / 60)
            : Math.round(mins / 1440);
      let locale = data.lang === "kmr" ? "ku" : data.lang;
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

    function render(ev) {
      let a = document.createElement("a");
      a.className = "live-card";
      a.href = data.app + "event/" + encodeURIComponent(ev.id);
      let mag = el(
        "span",
        "live-mag",
        fill(data.mag, { value: digits(ev.mag.toFixed(1)) }),
      );
      let place = el("span", "live-place", placeLine(ev));
      let meta = el("span", "live-meta", "");
      let time = document.createElement("time");
      time.dateTime = new Date(ev.t).toISOString();
      time.textContent = ago(ev.t);
      let src = document.createElement("bdi");
      src.textContent = ev.src;
      meta.appendChild(time);
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(src);
      let open = el("span", "live-open", data.open + " ");
      open.appendChild(el("span", "arrow", ""));
      open.lastChild.setAttribute("aria-hidden", "true");
      [mag, place, meta, open].forEach(function (n) {
        a.appendChild(n);
      });
      body.textContent = "";
      body.appendChild(a);
      body.setAttribute("aria-busy", "false");
    }
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
      if (tick - quakeAt > 420) quakeAt = tick + 120 + Math.floor(Math.random() * 160);
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
