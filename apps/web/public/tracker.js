/*!
 * Crm-A Console web tracker (~3KB, no dependencies).
 *
 * Install:
 *   <script src="https://<your-console-host>/tracker.js"
 *           data-write-key="cra_wk_..." defer></script>
 *
 * Usage:
 *   crma.track("Page View", { url: location.pathname })   // custom events
 *   crma.identify("ada@example.com", { name: "Ada" })     // identity resolution
 *
 * Behavior: anonymous events are tagged with a first-party cookie id and
 * sent to /api/events/collect; identify() links the anonymous profile to a
 * real person server-side (history follows). Page views are tracked
 * automatically (initial load + pushState navigations).
 */
(function () {
  "use strict";

  var script = document.currentScript || (function () {
    var s = document.querySelectorAll("script[data-write-key]");
    return s[s.length - 1];
  })();
  if (!script) return;

  var WRITE_KEY = script.getAttribute("data-write-key") || "";
  var ENDPOINT =
    script.getAttribute("data-endpoint") ||
    new URL(script.src).origin + "/api/events/collect";
  var IDENTIFY_ENDPOINT = ENDPOINT.replace(/\/collect$/, "/identify");
  var COOKIE = "cra_anon_id";
  var QUEUE_KEY = "cra_queue_v1";

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function getAnonId() {
    var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]+)"));
    if (m) return decodeURIComponent(m[1]);
    var id = uuid();
    var days = 365;
    document.cookie =
      COOKIE + "=" + encodeURIComponent(id) +
      "; path=/; max-age=" + days * 86400 + "; SameSite=Lax";
    return id;
  }

  var ANON_ID = getAnonId();
  var identifiedEmail = null;

  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveQueue(q) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch (e) { /* storage full/blocked — drop */ }
  }

  function send(url, payload, keepalive) {
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      var ok = navigator.sendBeacon(
        url,
        new Blob([body], { type: "application/json" })
      );
      if (ok) return Promise.resolve(true);
    }
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-write-key": WRITE_KEY },
      body: body,
      keepalive: !!keepalive,
      credentials: "omit",
    }).then(function (res) {
      return res.ok;
    }).catch(function () {
      return false;
    });
  }

  function flush() {
    var q = loadQueue();
    if (!q.length) return;
    var remaining = [];
    var chain = Promise.resolve();
    q.forEach(function (item) {
      chain = chain.then(function () {
        return send(ENDPOINT, item).then(function (ok) {
          if (!ok) remaining.push(item);
        });
      });
    });
    chain.then(function () {
      saveQueue(remaining);
    });
  }

  function enqueue(item) {
    var q = loadQueue();
    q.push(item);
    saveQueue(q);
  }

  function track(type, properties) {
    var payload = {
      anonymousId: ANON_ID,
      type: type,
      occurredAt: new Date().toISOString(),
      properties: properties || {},
      writeKey: WRITE_KEY,
    };
    if (identifiedEmail) payload.email = identifiedEmail;
    send(ENDPOINT, payload).then(function (ok) {
      if (!ok) enqueue(payload);
    });
  }

  function pageview() {
    track("Page View", {
      url: location.pathname + location.search,
      title: document.title,
      referrer: document.referrer || undefined,
    });
  }

  function identify(email, traits) {
    if (!email || typeof email !== "string") return;
    identifiedEmail = email.trim().toLowerCase();
    send(IDENTIFY_ENDPOINT, {
      anonymousId: ANON_ID,
      email: identifiedEmail,
      traits: traits || {},
      writeKey: WRITE_KEY,
    }).then(function () {
      flush(); // replay anything queued while anonymous under the new identity
    });
  }

  // Auto-track SPA navigations.
  var origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    pageview();
  };
  window.addEventListener("popstate", pageview);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });

  window.crma = {
    track: track,
    identify: identify,
    anonymousId: ANON_ID,
  };

  pageview();
  flush();
})();
