// ==UserScript==
// @name         Masked City Wire HUD Check-Ins
// @namespace    https://maskedcity.com/
// @version      1.0.2
// @description  Persist active Wire task check-ins in the HUD with countdown progress bars.
// @author       lvl11evelyn
// @match        https://maskedcity.com/*
// @match        https://www.maskedcity.com/*
// @updateURL    https://github.com/lvl11evelyn/mc-wiretimers/raw/refs/heads/main/wire-hud-checkins.user.js
// @downloadURL  https://github.com/lvl11evelyn/mc-wiretimers/raw/refs/heads/main/wire-hud-checkins.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEY = "wireHudCheckins:v1";
  const NOTE_STORE_KEY = "wireHudNotes:v1";
  const CONTROL_STORE_KEY = "wireHudDistrictControl:v1";
  const PENDING_NOTE_KEY = "wireHudPendingNote:v1";
  const TICK_MS = 1000;
  const FEED_SCAN_MS = 30000;
  // Known Hero-aligned Wire titles. Villain-side mirror titles may differ and
  // are still learned locally from the board when encountered.
  const KNOWN_JOB_STARS = {
    "Armored Truck Ambush": 4,
    "Auction House": 4,
    "Back Office Job": 3,
    "Bank Siege": 4,
    "Bolt Cutters": 1,
    "Buyer and Seller": 2,
    "Chop Shop": 2,
    "Citywide Blackout": 5,
    "Collection Day": 2,
    "Convoy Split": 4,
    "Dispensary Raid": 3,
    "Evidence Room": 4,
    "Hijacked Load": 3,
    "Machine Ripped Out": 2,
    "Night Shift": 2,
    "Penthouse Job": 4,
    "Petty Theft Call": 1,
    "Porch Pirates": 1,
    "Protection Racket": 3,
    "Robbery in Progress": 2,
    "Second-Story Man": 2,
    "Site Security": 1,
    "Skimmer Sweep": 2,
    "Smash and Grab": 3,
    "Snatch and Run": 1,
    "Someone Is Watching": 3,
    "Stop the Train": 5,
    "The Bullion Run": 5,
    "The Count Room": 4,
    "The Crown Job": 5,
    "The Federal Transfer": 5,
    "The Loan Exhibit": 4,
    "The Tower Job": 5,
    "Till Jumper": 1,
    "Under the Car": 1,
    "Walk-Out": 1,
    "War in the Street": 5,
    "Working the Gala": 3,
  };

  let timerId = null;
  let lastFeedScanAt = 0;
  let answerClickListenerBound = false;

  function readNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function getExpectedCheckins(stars) {
    return stars >= 4 ? 2 : 1;
  }

  function normalizeDistrict(value) {
    const slug = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[_\s]+/g, "-");

    const names = {
      downtown: "Downtown",
      heights: "Heights",
      industrial: "Industrial",
      "mid-city": "Mid-City",
      midcity: "Mid-City",
      slums: "Slums",
    };

    return names[slug] || String(value || "").trim();
  }

  function abbreviateDistrict(value) {
    const district = normalizeDistrict(value);
    const abbreviations = {
      Downtown: "D",
      Heights: "H",
      Industrial: "I",
      "Mid-City": "M",
      Slums: "S",
    };

    return abbreviations[district] || district;
  }

  function getPlayerAlignment() {
    const raw = document.documentElement.dataset.align || document.body?.dataset.align || "";
    const align = raw.toLowerCase();
    return align === "hero" || align === "villain" ? align : null;
  }

  function readControlState() {
    try {
      const state = JSON.parse(localStorage.getItem(CONTROL_STORE_KEY) || "null");
      return state && state.districts ? state : { authorityAt: 0, districts: {} };
    } catch {
      localStorage.removeItem(CONTROL_STORE_KEY);
      return { authorityAt: 0, districts: {} };
    }
  }

  function writeControlState(state) {
    localStorage.setItem(CONTROL_STORE_KEY, JSON.stringify(state));
  }

  function buildControlRecord({ district, heroPct, villainPct, controller, status, source, at }) {
    const hero = readNumber(heroPct);
    const villain = readNumber(villainPct);
    const normalizedStatus = status === "siege" ? "siege" : "controlled";

    return {
      district: normalizeDistrict(district),
      heroPct: hero,
      villainPct: villain,
      controller: controller === "hero" || controller === "villain" ? controller : null,
      status: normalizedStatus,
      source,
      updatedAt: at || Date.now(),
    };
  }

  function saveAuthorityRecords(records, source) {
    if (!records.length) return;

    const state = readControlState();
    const now = Date.now();
    state.authorityAt = now;

    records.forEach((record) => {
      state.districts[normalizeDistrict(record.district)] = {
        ...record,
        source,
        updatedAt: now,
      };
    });

    writeControlState(state);
  }

  function getDistrictControl(district) {
    return readControlState().districts[normalizeDistrict(district)] || null;
  }

  function classifyDistrict(control) {
    if (!control) return "";
    if (control.status === "siege") return "⚔️";

    if (control.controller === "hero") return "🛡️";
    if (control.controller === "villain") return "🏴‍☠️";
    return "";
  }

  function getNoteKey(note) {
    return [note.title || "", note.district || "", note.minutes || ""]
      .map((part) => String(part).trim().toLowerCase())
      .join("|");
  }

  function readSavedNotes() {
    try {
      return JSON.parse(localStorage.getItem(NOTE_STORE_KEY) || "{}");
    } catch {
      localStorage.removeItem(NOTE_STORE_KEY);
      return {};
    }
  }

  function getSeededNotes() {
    return Object.entries(KNOWN_JOB_STARS).map(([title, stars]) => ({ title, stars }));
  }

  function getKnownNotes() {
    return getSeededNotes().concat(Object.values(readSavedNotes()));
  }

  function findKnownNoteByTitle(title) {
    const normalizedTitle = String(title || "").trim().toLowerCase();
    if (!normalizedTitle) return null;

    const matches = getKnownNotes().filter((note) => {
      return String(note.title || "").trim().toLowerCase() === normalizedTitle && note.stars;
    });

    const starCounts = new Set(matches.map((note) => note.stars));
    return starCounts.size === 1 ? matches[0] : null;
  }

  function buildRosterExport() {
    const byTitle = new Map();

    getKnownNotes().forEach((note) => {
      const title = String(note.title || "").trim();
      if (!title || !note.stars) return;

      if (!byTitle.has(title)) byTitle.set(title, new Set());
      byTitle.get(title).add(note.stars);
    });

    return Array.from(byTitle.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, stars]) => {
        const values = Array.from(stars).sort((a, b) => a - b);
        return `${title}: ${values.join("/")}★`;
      })
      .join("\n");
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied ? Promise.resolve() : Promise.reject(new Error("Copy failed"));
  }

  function exportRoster(button) {
    const text = buildRosterExport() || "No Wire board jobs have been learned yet.";
    copyText(text)
      .then(() => {
        button.dataset.state = "copied";
        button.setAttribute("aria-label", "Wire roster copied");
        setTimeout(() => {
          button.dataset.state = "";
          button.setAttribute("aria-label", "Copy learned Wire roster");
        }, 1400);
      })
      .catch(() => {
        button.dataset.state = "failed";
        button.setAttribute("aria-label", "Copy failed");
        setTimeout(() => {
          button.dataset.state = "";
          button.setAttribute("aria-label", "Copy learned Wire roster");
        }, 1800);
      });
  }

  function readStoredJob() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    } catch {
      localStorage.removeItem(STORE_KEY);
      return null;
    }
  }

  function writeStoredJob(job) {
    localStorage.setItem(STORE_KEY, JSON.stringify(job));
  }

  function readPendingNote() {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_NOTE_KEY) || "null");
    } catch {
      sessionStorage.removeItem(PENDING_NOTE_KEY);
      return null;
    }
  }

  function writePendingNote(note) {
    sessionStorage.setItem(PENDING_NOTE_KEY, JSON.stringify(note));
  }

  function scanBoardNotes() {
    const notes = Array.from(document.querySelectorAll(".wb-note[data-stars][data-district]"));
    if (!notes.length) return;

    const saved = readSavedNotes();

    notes.forEach((node) => {
      const note = {
        id: node.dataset.wbNote || "",
        title: node.dataset.title || node.querySelector(".wb-note__title")?.textContent?.trim() || "",
        district: node.dataset.district || "",
        stars: readNumber(node.dataset.stars),
        minutes: readNumber(node.dataset.minutes),
        low: readNumber(node.dataset.low),
        high: readNumber(node.dataset.high),
      };

      if (!note.district || !note.stars || !note.minutes) return;
      saved[getNoteKey(note)] = note;

      node.addEventListener("click", () => writePendingNote(note), { passive: true });
    });

    localStorage.setItem(NOTE_STORE_KEY, JSON.stringify(saved));
  }

  function scanCityDistricts() {
    const records = Array.from(document.querySelectorAll(".district-panel")).map((panel) => {
      const district = normalizeDistrict(panel.querySelector(".district-name")?.textContent || "");
      const title = panel.querySelector(".district-war")?.getAttribute("title") || "";
      const match = title.match(/(\d+)%\s*Hero\s*\/\s*(\d+)%\s*Villain(?:\s*—\s*(Hero|Villain)\s+controlled)?/i);

      if (!district || !match) return null;

      return buildControlRecord({
        district,
        heroPct: match[1],
        villainPct: match[2],
        controller: match[3]?.toLowerCase() || null,
        status: panel.classList.contains("is-siege") || /siege/i.test(title) ? "siege" : "controlled",
        source: "city",
      });
    }).filter(Boolean);

    saveAuthorityRecords(records, "city");
  }

  function scanWatchtowerDistricts() {
    const records = Array.from(document.querySelectorAll(".wt-cell[data-district]")).map((cell) => {
      const controller = cell.querySelector(".wt-cell__who")?.textContent?.trim()?.toLowerCase();
      if (controller !== "hero" && controller !== "villain") return null;

      return buildControlRecord({
        district: cell.dataset.district,
        controller,
        status: /siege/i.test(cell.textContent) || /siege/i.test(cell.title) ? "siege" : "controlled",
        source: "watchtower",
      });
    }).filter(Boolean);

    saveAuthorityRecords(records, "watchtower");
  }

  function parseRelativeTime(text) {
    const value = String(text || "").trim().toLowerCase();
    if (!value || value.includes("just now")) return Date.now();

    const match = value.match(/(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)/);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2][0];
    const scale = unit === "d" ? 86400000 : unit === "h" ? 3600000 : 60000;
    return Date.now() - amount * scale;
  }

  function scanFeedEvents(force = false) {
    const now = Date.now();
    if (!force && now - lastFeedScanAt < FEED_SCAN_MS) return;
    lastFeedScanAt = now;

    const state = readControlState();
    let changed = false;

    document.querySelectorAll('.rs-feed-item[data-type="war"], .war-feed-item').forEach((item) => {
      const text = item.querySelector(".rs-feed-text, .war-feed-item__text")?.textContent || item.textContent || "";
      const siegeMatch = text.match(/([^.!]+?)\s+is\s+(?:now\s+)?under\s+siege/i);
      const match = text.match(/The\s+(Heroes|Villains)\s+have\s+taken\s+([^!]+)!/i);
      if (!match && !siegeMatch) return;

      const eventAt = parseRelativeTime(item.querySelector(".rs-feed-time, .war-feed-item__time")?.textContent);
      if (!eventAt || eventAt <= (state.authorityAt || 0)) return;

      const district = normalizeDistrict(match ? match[2] : siegeMatch[1]);
      const controller = match ? (match[1].toLowerCase().startsWith("hero") ? "hero" : "villain") : null;
      const current = state.districts[district];
      if (current && current.updatedAt >= eventAt) return;

      state.districts[district] = buildControlRecord({
        district,
        controller: controller || current?.controller || null,
        status: siegeMatch ? "siege" : "controlled",
        source: "feed",
        at: eventAt,
      });
      changed = true;
    });

    if (changed) writeControlState(state);
  }

  function findMatchingNote(job, checkins) {
    const pending = readPendingNote();
    const saved = readSavedNotes();
    const minutes = Math.round((job.ends - job.starts) / 60000);
    const base = {
      title: job.querySelector(".wb-job__title")?.textContent?.trim() || "",
      district: job.querySelector(".wb-bar__k")?.textContent?.trim() || "",
      minutes,
    };

    if (
      pending &&
      pending.district === base.district &&
      pending.minutes === minutes &&
      (!pending.title || !base.title || pending.title === base.title)
    ) {
      return pending;
    }

    const exact = saved[getNoteKey(base)];
    if (exact) return exact;

    const titleMatch = findKnownNoteByTitle(base.title);
    if (titleMatch) return titleMatch;

    return Object.values(saved).find((note) => {
      return note.district === base.district && note.minutes === minutes && getExpectedCheckins(note.stars) === checkins.length;
    }) || null;
  }

  function hydrateJobMetadata(job) {
    if (!job) return job;

    const saved = readSavedNotes();
    const notes = Object.values(saved);
    const checkinCount = (job.checkins || []).length;
    const district = normalizeDistrict(job.district);
    const minutes = readNumber(job.minutes) || Math.round((job.ends - job.starts) / 60000);
    const title = String(job.title || "").trim();

    const exactNote = notes.find((item) => item.title === title && normalizeDistrict(item.district) === district && item.minutes === minutes);
    const titleNote = findKnownNoteByTitle(title);
    const timingNote = notes.find((item) => normalizeDistrict(item.district) === district && item.minutes === minutes && getExpectedCheckins(item.stars) === checkinCount);
    const note = exactNote || titleNote || timingNote;

    if (!note) return job;

    return {
      ...job,
      district: job.district || note.district,
      stars: note.stars || job.stars,
      minutes: note.minutes || job.minutes,
      low: exactNote || timingNote ? note.low || job.low : job.low,
      high: exactNote || timingNote ? note.high || job.high : job.high,
    };
  }

  function readJobFromPage() {
    const job = document.querySelector(".wb-job[data-starts][data-ends]");
    if (!job) return null;

    const storedJob = readStoredJob();
    const starts = Number(job.dataset.starts);
    const ends = Number(job.dataset.ends);
    const checkins = Array.from(job.querySelectorAll(".wb-checkin[data-at]"))
      .slice(0, 2)
      .map((node, index) => {
        const checkinIndex = readNumber(node.dataset.wbCheckin);
        const itemIndex = checkinIndex === null ? index + 1 : checkinIndex + 1;
        const at = Number(node.dataset.at);
        const state = node.dataset.state || "waiting";
        const existing = storedJob?.checkins?.find((item) => item.index === itemIndex || item.at === at);
        const answeredAt = state === "answered" ? existing?.answeredAt || Date.now() : existing?.answeredAt || null;

        return {
          index: itemIndex,
          at,
          state,
          answeredAt,
        };
      })
      .filter((item) => Number.isFinite(item.at));

    if (!Number.isFinite(starts) || !Number.isFinite(ends) || !checkins.length) {
      return null;
    }

    const note = findMatchingNote(job, checkins);
    const fallbackDistrict = job.querySelector(".wb-bar__k")?.textContent?.trim() || "";

    return {
      title: job.querySelector(".wb-job__title")?.textContent?.trim() || "Wire Task",
      district: fallbackDistrict || note?.district || "",
      stars: note?.stars || null,
      minutes: note?.minutes || Math.round((ends - starts) / 60000),
      low: note?.low || null,
      high: note?.high || null,
      starts,
      ends,
      checkins,
    };
  }

  function loadJob() {
    const pageJob = readJobFromPage();
    if (pageJob) {
      writeStoredJob(pageJob);
      return pageJob;
    }

    const storedJob = hydrateJobMetadata(readStoredJob());
    if (storedJob) writeStoredJob(storedJob);
    return storedJob;
  }

  function markCheckinAnswered(answerIndex) {
    const job = loadJob();
    if (!job?.checkins?.length) return;

    const targetIndex = Number(answerIndex) + 1;
    let changed = false;

    job.checkins = job.checkins.map((item) => {
      if (item.index !== targetIndex || item.answeredAt) return item;
      changed = true;
      return {
        ...item,
        state: "answered",
        answeredAt: Date.now(),
      };
    });

    if (changed) {
      writeStoredJob(job);
      render(job);
    }
  }

  function clearJob() {
    localStorage.removeItem(STORE_KEY);
    document.querySelector(".wire-hud")?.remove();
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function ensureStyles() {
    if (document.getElementById("wireHudStyles")) return;

    const style = document.createElement("style");
    style.id = "wireHudStyles";
    style.textContent = `
      .wire-hud {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 190px;
        max-width: 340px;
        padding: 5px 8px;
        border: 1px solid rgba(95, 180, 255, 0.28);
        background: rgba(8, 13, 24, 0.78);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 14px rgba(26, 147, 255, 0.14);
        color: var(--on-accent) !important;
        font-family: var(--font-ui);
        font-size: 13px;
        font-weight: 400;
        line-height: 1;
        text-transform: uppercase;
      }

      .wire-hud__list {
        display: grid;
        gap: 3px;
        width: 100%;
      }

      .wire-hud__row {
        display: grid;
        grid-template-columns: max-content minmax(64px, 1fr) max-content;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .wire-hud__row--task {
        grid-template-columns: max-content minmax(64px, 1fr) max-content 18px;
      }

      .wire-hud__label {
        color: #94caff;
      }

      .wire-hud__track {
        height: 8px;
        overflow: hidden;
        background: rgba(255,255,255,0.13);
        border: 1px solid rgba(255,255,255,0.12);
      }

      .wire-hud__fill {
        width: 0%;
        height: 100%;
        display: block;
        background: linear-gradient(90deg, #20e3ff, #ffd43b);
        transition: width 220ms linear;
      }

      .wire-hud__time {
        min-width: 38px;
        text-align: right;
        color: #fff;
      }

      .wire-hud__export {
        width: 16px;
        height: 16px;
        display: inline-grid;
        place-items: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: #94caff;
        cursor: pointer;
        font: inherit;
        line-height: 1;
      }

      .wire-hud__export:hover,
      .wire-hud__export[data-state="copied"] {
        color: #42ff83;
      }

      .wire-hud__export[data-state="failed"] {
        color: #ff6868;
      }

      .wire-hud__row--task .wire-hud__label {
        color: #ffd86b;
      }

      .wire-hud__row--task .wire-hud__fill {
        background: linear-gradient(90deg, #ffb020, #20e3ff);
      }

      .wire-hud__row.is-ready .wire-hud__fill {
        width: 100%;
        background: #42ff83;
      }

      .wire-hud__row.is-ready .wire-hud__time {
        color: #42ff83;
      }

      .wire-hud__row.is-answered .wire-hud__fill {
        width: 100%;
        background: #94caff;
      }

      .wire-hud__row.is-answered .wire-hud__time {
        color: #94caff;
      }

      @media (max-width: 980px) {
        .wire-hud {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureHud() {
    const wireAnchor = document.querySelector('nav.v2-nav a[href="/wire"]');
    if (wireAnchor) {
      ensureStyles();

      let widget = document.querySelector(".wire-hud");
      if (!widget) {
        widget = document.createElement("div");
        widget.className = "wire-hud";
        widget.setAttribute("aria-live", "polite");
        widget.innerHTML = '<div class="wire-hud__list"></div>';
      }

      if (wireAnchor.nextElementSibling !== widget) {
        wireAnchor.after(widget);
      }

      return widget;
    }

    const hud = document.querySelector("header.hud");
    if (!hud) return null;

    let widget = document.querySelector(".wire-hud");
    if (widget) return widget;

    ensureStyles();
    widget = document.createElement("div");
    widget.className = "wire-hud";
    widget.setAttribute("aria-live", "polite");
    widget.innerHTML = '<div class="wire-hud__list"></div>';

    const ident = hud.querySelector(".ident");
    hud.insertBefore(widget, ident || hud.querySelector(".hud__tools") || null);
    return widget;
  }

  function render(job) {
    const now = Date.now();
    scanFeedEvents();

    if (!job || !Number.isFinite(job.ends) || now >= job.ends) {
      clearJob();
      return;
    }

    const widget = ensureHud();
    if (!widget) return;

    const list = widget.querySelector(".wire-hud__list");
    const stars = readNumber(job.stars);
    const expectedCheckins = stars ? getExpectedCheckins(stars) : 2;
    const activeCheckins = (job.checkins || [])
      .slice(0, expectedCheckins)
      .filter((item) => Number.isFinite(item.at) && item.at <= job.ends);

    if (!activeCheckins.length) {
      clearJob();
      return;
    }

    const checkinRows = activeCheckins.map((item) => {
        const ready = now >= item.at;
        const answered = Number.isFinite(item.answeredAt);
        const total = Math.max(1, item.at - job.starts);
        const elapsed = Math.max(0, Math.min(total, now - job.starts));
        const percent = ready ? 100 : (elapsed / total) * 100;
        const label = `Check-In #${item.index}:`;
        const readyElapsed = (answered ? item.answeredAt : now) - item.at;
        const time = ready ? `+${formatRemaining(readyElapsed)}` : formatRemaining(item.at - now);
        const stateClass = answered ? " is-answered" : ready ? " is-ready" : "";

        return `
          <div class="wire-hud__row${stateClass}">
            <span class="wire-hud__label">${label}</span>
            <span class="wire-hud__track"><span class="wire-hud__fill" style="width:${percent.toFixed(2)}%"></span></span>
            <span class="wire-hud__time">${time}</span>
          </div>
        `;
      });

    const taskTotal = Math.max(1, job.ends - job.starts);
    const taskElapsed = Math.max(0, Math.min(taskTotal, now - job.starts));
    const taskPercent = (taskElapsed / taskTotal) * 100;
    const controlLabel = classifyDistrict(getDistrictControl(job.district));
    const fallbackStars = !stars && activeCheckins.length === 2 ? "4-5★" : "";
    const taskLabel = [abbreviateDistrict(job.district), stars ? `${stars}★` : fallbackStars, controlLabel].filter(Boolean).join(" ") || "Wire Task";
    const taskRow = `
      <div class="wire-hud__row wire-hud__row--task">
        <span class="wire-hud__label">${taskLabel}:</span>
        <span class="wire-hud__track"><span class="wire-hud__fill" style="width:${taskPercent.toFixed(2)}%"></span></span>
        <span class="wire-hud__time">${formatRemaining(job.ends - now)}</span>
        <button type="button" class="wire-hud__export" data-wire-export aria-label="Copy learned Wire roster" title="Copy learned Wire roster">⤵️</button>
      </div>
    `;

    list.innerHTML = checkinRows.concat(taskRow).join("");
  }

  function start() {
    if (!answerClickListenerBound) {
      answerClickListenerBound = true;
      document.addEventListener("click", (event) => {
        const exportButton = event.target.closest("[data-wire-export]");
        if (exportButton) {
          event.preventDefault();
          exportRoster(exportButton);
          return;
        }

        const button = event.target.closest("[data-wb-answer]");
        if (button) markCheckinAnswered(button.dataset.wbAnswer);
      }, true);
    }

    scanBoardNotes();
    scanCityDistricts();
    scanWatchtowerDistricts();
    scanFeedEvents(true);
    render(loadJob());

    clearInterval(timerId);
    timerId = setInterval(() => render(loadJob()), TICK_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
