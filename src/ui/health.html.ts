// src/ui/health.html.ts
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderHealthHtml(payload: any) {
  const ok = !!payload?.db?.connected;
  const dot = ok ? "#31e981" : "#ff476c";
  const status = ok ? "Connected" : "Disconnected";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ZIPO Health</title>
  <style>
    body{margin:0;font-family:ui-sans-serif,system-ui;background:#0B1020;color:rgba(255,255,255,.92);}
    .wrap{max-width:900px;margin:0 auto;padding:40px 18px;}
    .card{border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px 18px 16px;
          background:rgba(255,255,255,.06);backdrop-filter:blur(10px);}
    .row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;}
    .h{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800;letter-spacing:-.01em;margin:0;}
    .dot{width:10px;height:10px;border-radius:999px;background:${dot};box-shadow:0 0 18px ${dot};}
    .k{color:rgba(255,255,255,.65);font-size:12px;}
    .v{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:12px;}
    pre{margin:14px 0 0;border-radius:14px;padding:14px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.10);overflow:auto;}
    a{color:rgba(150,190,255,.95);text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1 class="h"><span class="dot"></span> ZIPO Health • DB ${status}</h1>
      <div class="row">
        <div><div class="k">Service</div><div class="v">${escapeHtml(
          String(payload.service ?? "")
        )}</div></div>
        <div><div class="k">Now</div><div class="v">${escapeHtml(
          String(payload.now ?? "")
        )}</div></div>
        <div><div class="k">Uptime</div><div class="v">${escapeHtml(
          String(payload.uptimeSec ?? "")
        )}s</div></div>
        <div><div class="k">DB Latency</div><div class="v">${escapeHtml(
          String(payload.db?.latencyMs ?? "—")
        )} ms</div></div>
      </div>
      <div class="row">
        <div class="k">Need JSON?</div>
        <div class="v"><a href="/api/health?format=json">/api/health?format=json</a></div>
      </div>
      <pre class="v">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </div>
  </div>
</body>
</html>`;
}
