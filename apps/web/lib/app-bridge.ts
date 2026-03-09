/**
 * DenchClaw App Bridge SDK.
 *
 * This module generates the client-side SDK script that gets injected into
 * app iframes, providing `window.dench` for app-to-DenchClaw communication.
 *
 * Protocol:
 *   App -> Parent: { type: "dench:request", id, method, params }
 *   Parent -> App: { type: "dench:response", id, result, error }
 */

export function generateBridgeScript(): string {
  return `
(function() {
  if (window.dench) return;

  var _pendingRequests = {};
  var _requestId = 0;

  function sendRequest(method, params) {
    return new Promise(function(resolve, reject) {
      var id = ++_requestId;
      _pendingRequests[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: "dench:request",
        id: id,
        method: method,
        params: params
      }, "*");

      setTimeout(function() {
        if (_pendingRequests[id]) {
          _pendingRequests[id].reject(new Error("Request timeout: " + method));
          delete _pendingRequests[id];
        }
      }, 30000);
    });
  }

  window.addEventListener("message", function(event) {
    if (!event.data || event.data.type !== "dench:response") return;
    var pending = _pendingRequests[event.data.id];
    if (!pending) return;
    delete _pendingRequests[event.data.id];
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
    } else {
      pending.resolve(event.data.result);
    }
  });

  window.dench = {
    db: {
      query: function(sql) { return sendRequest("db.query", { sql: sql }); },
      execute: function(sql) { return sendRequest("db.execute", { sql: sql }); }
    },
    files: {
      read: function(path) { return sendRequest("files.read", { path: path }); },
      list: function(dir) { return sendRequest("files.list", { dir: dir }); }
    },
    app: {
      getManifest: function() { return sendRequest("app.getManifest"); },
      getTheme: function() { return sendRequest("app.getTheme"); }
    },
    agent: {
      send: function(message) { return sendRequest("agent.send", { message: message }); }
    }
  };
})();
`;
}

/**
 * Wraps raw HTML content with the bridge SDK script tag.
 * Used when serving HTML files to inject the SDK automatically.
 */
export function injectBridgeIntoHtml(html: string): string {
  const script = `<script>${generateBridgeScript()}</script>`;

  // Try to inject before </head>
  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}\n</head>`);
  }

  // Try to inject after <head>
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n${script}`);
  }

  // Fallback: prepend to the HTML
  return `${script}\n${html}`;
}
