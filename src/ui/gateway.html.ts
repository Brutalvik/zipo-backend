// src/ui/gateway.html.ts
export type ApiEndpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function methodClass(m: ApiEndpoint["method"]) {
  switch (m) {
    case "GET":
      return "m-get";
    case "POST":
      return "m-post";
    case "PUT":
      return "m-put";
    case "PATCH":
      return "m-patch";
    case "DELETE":
      return "m-del";
  }
}

export function renderGatewayHtml(opts: {
  dbConnected: boolean;
  dbLatencyMs?: number | null;
  version: string;
  endpoints: ApiEndpoint[];
  nowIso: string;
  user?: {
    name?: string;
    email?: string;
    picture?: string;
    role?: string;
  };
}) {
  const { dbConnected, dbLatencyMs, version, endpoints, nowIso, user } = opts;

  const statusText = dbConnected ? "Connected" : "Disconnected";
  const statusClass = dbConnected ? "ok" : "bad";
  const latencyText =
    dbConnected && typeof dbLatencyMs === "number" ? `${dbLatencyMs} ms` : "—";

  const accordionItems = endpoints
    .map((e, idx) => {
      const needsId = e.path.includes(":id");
      const safeId = `acc_${idx}`;
      return `
      <div class="accItem" data-path="${esc(e.path)}" data-method="${
        e.method
      }" data-needs-id="${needsId ? "1" : "0"}">
        <button class="accHead" type="button" aria-expanded="false" aria-controls="${safeId}">
          <span class="method ${methodClass(e.method)}">${e.method}</span>
          <span class="accPath"><code>${esc(e.path)}</code></span>
          <span class="accDesc">${esc(e.description)}</span>
          <span class="chev" aria-hidden="true">▾</span>
        </button>

        <div id="${safeId}" class="accBody" hidden>
          ${
            needsId
              ? `
            <div class="accTools">
              <div class="field">
                <div class="fieldLabel">Car ID</div>
                <input class="input" data-role="carId" placeholder="paste car uuid here..." />
              </div>

              ${
                e.path.endsWith("/availability")
                  ? `
                <div class="field">
                  <div class="fieldLabel">Start</div>
                  <input class="input" data-role="start" placeholder="YYYY-MM-DD" />
                </div>
                <div class="field">
                  <div class="fieldLabel">End</div>
                  <input class="input" data-role="end" placeholder="YYYY-MM-DD" />
                </div>
              `
                  : ``
              }

              <button class="btn runBtn" type="button">Run</button>
              <button class="btn openModalBtn" type="button">Open in modal</button>
            </div>

            <div class="accResult">
              <div class="hintSmall">Provide the inputs above, then press <span class="kbd">Run</span>.</div>
              <pre class="jsonPre"><code class="jsonCode">// waiting...</code></pre>
            </div>
          `
              : `
            <div class="accTools">
              <button class="btn openModalBtn" type="button">Open in modal</button>
              <button class="btn runInlineBtn" type="button">Fetch here</button>
            </div>

            <div class="accResult">
              <pre class="jsonPre"><code class="jsonCode">// expand + click Fetch here, or Open in modal</code></pre>
            </div>
          `
          }
        </div>
      </div>
    `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ZIPO API Gateway</title>
  <meta name="theme-color" content="#0B1020" />
  <style>
    :root{
      --bg0:#070A12;
      --bg1:#0B1020;
      --card: rgba(255,255,255,.06);
      --stroke: rgba(255,255,255,.10);
      --stroke2: rgba(255,255,255,.16);
      --text: rgba(255,255,255,.92);
      --muted: rgba(255,255,255,.68);
      --shadow: 0 22px 70px rgba(0,0,0,.55);
      --r: 22px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
    }

    * { box-sizing: border-box; }
    body{
      margin:0;
      font-family: var(--sans);
      color: var(--text);
      background:
        radial-gradient(1000px 600px at 20% -10%, rgba(80,120,255,.28), transparent 60%),
        radial-gradient(900px 650px at 110% 20%, rgba(160,90,255,.24), transparent 60%),
        radial-gradient(800px 550px at 30% 120%, rgba(0,220,255,.18), transparent 60%),
        linear-gradient(180deg, var(--bg0), var(--bg1));
      min-height: 100vh;
      overflow-x:hidden;
    }

    body:before{
      content:"";
      position:fixed;
      inset:0;
      background-image:
        linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: radial-gradient(ellipse at 30% 10%, black 0%, transparent 65%);
      pointer-events:none;
    }

    .wrap{
      max-width: 1100px;
      margin: 0 auto;
      padding: 42px 18px 60px;
    }

    .hero{
      display:flex;
      gap: 18px;
      align-items: stretch;
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .card{
      background: linear-gradient(180deg, var(--card), rgba(255,255,255,.03));
      border: 1px solid var(--stroke);
      border-radius: var(--r);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .brand{
      flex: 1 1 520px;
      padding: 26px 26px 22px;
      position: relative;
      overflow:hidden;
    }

    .brand:after{
      content:"";
      position:absolute;
      inset:-1px;
      background: radial-gradient(700px 250px at 30% 0%, rgba(120,170,255,.24), transparent 60%),
                  radial-gradient(600px 220px at 90% 30%, rgba(180,110,255,.18), transparent 55%);
      pointer-events:none;
    }

    .title{
      position:relative;
      z-index:1;
      display:flex;
      align-items: center;
      gap: 12px;
    }

    .logo{
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(120,170,255,.95), rgba(170,110,255,.92));
      box-shadow: 0 14px 40px rgba(120,170,255,.22);
      border: 1px solid rgba(255,255,255,.22);
      display:grid;
      place-items:center;
      font-weight: 900;
      letter-spacing: .06em;
      color: rgba(10,10,20,.9);
      user-select:none;
    }

    h1{
      margin: 0;
      font-size: 34px;
      line-height: 1.05;
      letter-spacing: -0.02em;
    }

    .subtitle{
      position:relative;
      z-index:1;
      margin-top: 10px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
      max-width: 68ch;
    }

    .meta{
      position:relative;
      z-index:1;
      margin-top: 16px;
      display:flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .chip{
      border: 1px solid var(--stroke2);
      background: rgba(255,255,255,.06);
      padding: 8px 10px;
      border-radius: 999px;
      font-size: 12px;
      color: rgba(255,255,255,.82);
      display:flex;
      gap: 8px;
      align-items:center;
    }

    .dot{
      width: 10px;
      height: 10px;
      border-radius: 50%;
      box-shadow: 0 0 0 4px rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.20);
    }
    .dot.ok{ background: #31e981; box-shadow: 0 0 22px rgba(49,233,129,.55), 0 0 0 4px rgba(49,233,129,.10); }
    .dot.bad{ background: #ff476c; box-shadow: 0 0 22px rgba(255,71,108,.52), 0 0 0 4px rgba(255,71,108,.10); }

    .statusCard{
      flex: 0 1 320px;
      padding: 20px;
      min-width: 280px;
      display:flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
    }

    .statusRow{
      display:flex;
      align-items:center;
      justify-content: space-between;
      gap: 12px;
    }
    .label{
      color: var(--muted);
      font-size: 12px;
    }
    .value{
      font-size: 13px;
      color: rgba(255,255,255,.86);
      font-family: var(--mono);
    }
    .big{
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.01em;
      display:flex;
      align-items:center;
      gap: 10px;
    }

    .tableCard{
      margin-top: 18px;
      padding: 18px;
      overflow:hidden;
    }

    .tableHead{
      display:flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .tableHead h2{
      margin:0;
      font-size: 16px;
      letter-spacing: -0.01em;
    }

    .hint{
      color: var(--muted);
      font-size: 12px;
    }

    .method{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width: 64px;
      padding: 6px 10px;
      border-radius: 999px;
      font-weight: 800;
      letter-spacing: .06em;
      font-size: 11px;
      font-family: var(--mono);
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06);
    }

    .m-get   { background: rgba(0, 210, 255, .16); border-color: rgba(0, 210, 255, .35); }
    .m-post  { background: rgba(49, 233, 129, .16); border-color: rgba(49, 233, 129, .35); }
    .m-put   { background: rgba(255, 205, 0, .16); border-color: rgba(255, 205, 0, .38); }
    .m-patch { background: rgba(180, 110, 255, .16); border-color: rgba(180, 110, 255, .38); }
    .m-del   { background: rgba(255, 71, 108, .16); border-color: rgba(255, 71, 108, .38); }

    .footer{
      margin-top: 16px;
      color: rgba(255,255,255,.55);
      font-size: 12px;
      display:flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn{
      cursor:pointer;
      user-select:none;
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06);
      padding: 8px 10px;
      border-radius: 12px;
      font-size: 12px;
      color: rgba(255,255,255,.88);
      display:inline-flex;
      gap: 8px;
      align-items:center;
      text-decoration:none;
      transition: transform .12s ease, background .12s ease;
    }
    .btn:hover{ transform: translateY(-1px); background: rgba(255,255,255,.085); }
    .btn:active{ transform: translateY(0px); }
    .kbd{
      font-family: var(--mono);
      padding: 3px 7px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.20);
      color: rgba(255,255,255,.82);
      font-size: 11px;
    }

    /* ---------- Accordion ---------- */
    .accWrap{
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 16px;
      overflow:hidden;
      background: rgba(255,255,255,.04);
    }

    .accItem + .accItem{
      border-top: 1px solid rgba(255,255,255,.08);
    }

    .accHead{
      width:100%;
      display:grid;
      grid-template-columns: 90px 1.2fr 1.6fr 24px;
      gap: 10px;
      align-items:center;
      padding: 12px 12px;
      background: transparent;
      border: 0;
      text-align:left;
      color: inherit;
      cursor:pointer;
    }

    .accHead:hover{
      background: rgba(255,255,255,.035);
    }

    .accPath code{
      font-family: var(--mono);
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 10px;
      background: rgba(0,0,0,.22);
      border: 1px solid rgba(255,255,255,.10);
      color: rgba(255,255,255,.90);
    }

    .accDesc{
      color: rgba(255,255,255,.70);
      font-size: 13px;
    }

    .chev{
      justify-self:end;
      opacity:.75;
      transition: transform .18s ease;
      font-size: 14px;
    }

    .accItem[data-open="1"] .chev{
      transform: rotate(180deg);
    }

    .accBody{
      padding: 12px 12px 14px;
      background: rgba(0,0,0,.12);
    }

    .accTools{
      display:flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: end;
      margin-bottom: 10px;
    }

    .field{
      display:flex;
      flex-direction: column;
      gap: 6px;
      min-width: 220px;
      flex: 1 1 220px;
    }
    .fieldLabel{
      color: rgba(255,255,255,.62);
      font-size: 12px;
    }
    .input{
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06);
      color: rgba(255,255,255,.92);
      padding: 10px 10px;
      border-radius: 12px;
      outline: none;
      font-family: var(--mono);
      font-size: 12px;
    }
    .input:focus{
      border-color: rgba(120,170,255,.45);
      box-shadow: 0 0 0 4px rgba(120,170,255,.12);
    }

    .hintSmall{
      color: rgba(255,255,255,.60);
      font-size: 12px;
      margin-bottom: 10px;
    }

    .jsonPre{
      margin:0;
      border-radius: 14px;
      padding: 14px;
      background: rgba(0,0,0,.25);
      border: 1px solid rgba(255,255,255,.10);
      overflow:auto;
    }
    .jsonCode{
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.55;
      color: rgba(255,255,255,.86);
      white-space: pre;
    }

    /* JSON syntax colors */
    .j-key{ color: rgba(0,210,255,.95); }
    .j-str{ color: rgba(49,233,129,.92); }
    .j-num{ color: rgba(255,205,0,.92); }
    .j-bool{ color: rgba(180,110,255,.95); }
    .j-null{ color: rgba(255,71,108,.92); }
    .j-punc{ color: rgba(255,255,255,.55); }

    /* ---------- Modal ---------- */
    .modalOverlay{
      position:fixed;
      inset:0;
      background: rgba(0,0,0,.55);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display:none;
      align-items:center;
      justify-content:center;
      padding: 18px;
      z-index: 9999;
    }
    .modalOverlay.open{ display:flex; }

    .modal{
      width: min(980px, 100%);
      max-height: min(78vh, 780px);
      overflow:hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.06);
      box-shadow: 0 30px 90px rgba(0,0,0,.65);
    }

    .modalTop{
      display:flex;
      align-items:center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 12px;
      border-bottom: 1px solid rgba(255,255,255,.10);
      background: rgba(0,0,0,.18);
    }

    .modalTitle{
      display:flex;
      gap: 10px;
      align-items:center;
      font-weight: 800;
      letter-spacing: -.01em;
      font-size: 14px;
    }

    .modalBody{
      padding: 12px;
      overflow:auto;
      max-height: calc(min(78vh, 780px) - 54px);
    }

    .modalCard{
      border:1px solid rgba(255,255,255,.12);
      border-radius:18px;
      padding: 16px;
      background: rgba(255,255,255,.06);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .modalRow{
      display:flex;
      justify-content:space-between;
      gap:12px;
      flex-wrap:wrap;
      margin-top:12px;
    }

    .modalH{
      display:flex;
      align-items:center;
      gap:10px;
      font-size:16px;
      font-weight:800;
      letter-spacing:-.01em;
      margin:0;
    }

    .xBtn{
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06);
      color: rgba(255,255,255,.9);
      border-radius: 12px;
      padding: 8px 10px;
      cursor:pointer;
      font-size: 12px;
    }
    .xBtn:hover{ background: rgba(255,255,255,.085); }

    @media (max-width: 820px){
      .accHead{
        grid-template-columns: 84px 1fr 24px;
        grid-template-areas:
          "m p c"
          "m d c";
      }
      .accHead .method{ grid-area:m; }
      .accHead .accPath{ grid-area:p; }
      .accHead .accDesc{ grid-area:d; }
      .accHead .chev{ grid-area:c; }
    }

    @media (max-width: 640px){
      h1{ font-size: 28px; }
      .brand{ padding: 20px; }
    }

    .userWrap{
      position:absolute;
      top:22px;
      right:22px;
      z-index:5;
    }
    
    .user{
      display:flex;
      align-items:center;
      gap:10px;
      padding:10px 12px;
      border-radius:16px;
      border:1px solid rgba(255,255,255,.14);
      background:rgba(255,255,255,.08);
      backdrop-filter:blur(10px);
      -webkit-backdrop-filter:blur(10px);
    }
    
    .avatar{
      width:36px;
      height:36px;
      border-radius:50%;
      object-fit:cover;
      border:1px solid rgba(255,255,255,.22);
    }
    
    .avatar.fallback{
      display:grid;
      place-items:center;
      background:rgba(255,255,255,.14);
    }
    
    .avatar svg{
      width:18px;
      height:18px;
      fill:white;
      opacity:.85;
    }
    
    .user{
      display:flex;
      align-items:center;
      gap:12px;
    }
    
    .avatar{
      width:36px;
      height:36px;
      border-radius:50%;
      object-fit:cover;
    }
    
    .avatar.fallback{
      display:grid;
      place-items:center;
      background:rgba(255,255,255,.12);
    }
    
    .avatar svg{
      width:18px;
      fill:white;
      opacity:.8;
    }
    
    .meta{
      display:flex;
      flex-direction:column;
      line-height:1.2;
    }
    
    .meta .name{
      font-size:13px;
      font-weight:600;
      display:flex;
      align-items:center;
      gap:6px;
    }
    
    .meta .email{
      font-size:11px;
      opacity:.6;
    }
    
    /* ---------- Badges ---------- */
    .badge{
      font-size:9px;
      padding:3px 6px;
      border-radius:999px;
      letter-spacing:.08em;
      font-weight:700;
    }
    
    .badge.admin{
      background:linear-gradient(135deg,#a855f7,#6366f1);
      color:white;
      box-shadow:0 0 10px rgba(168,85,247,.5);
    }
    
    .badge.user{
      background:rgba(255,255,255,.12);
      color:rgba(255,255,255,.85);
      border:1px solid rgba(255,255,255,.18);
    }
    
    /* ---------- Logout ---------- */
    .logoutBtn{
      margin-left:8px;
      padding:6px 10px;
      font-size:12px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,.16);
      background:rgba(255,255,255,.06);
      color:white;
      text-decoration:none;
    }
    .logoutBtn:hover{
      background:rgba(255,255,255,.1);
    }
    
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <section class="card brand">
        <div class="title">
          <div class="logo">Z</div>
          <div>
            <h1>Zipo API Gateway</h1>
            <div class="subtitle">
              API hub for Zipo. Endpoints below are live and ready.
              DB status updates automatically.
            </div>
          </div>
        </div>

        <div class="meta">
          <div class="chip">
            <span class="dot ${statusClass}"></span>
            <span><strong>DB:</strong> <span id="dbStatusText">${statusText}</span></span>
          </div>
          <div class="chip">
            <span class="label">Latency</span>
            <span class="value" id="dbLatency">${esc(latencyText)}</span>
          </div>
          <div class="chip">
            <span class="label">Version</span>
            <span class="value">${esc(version)}</span>
          </div>
          <div class="chip">
            <span class="label">Now</span>
            <span class="value" id="nowText" data-iso="${esc(nowIso)}">—</span>
          </div>
        </div>
      </section>

      <aside class="card statusCard">
        <div class="big">
          <span class="dot ${statusClass}" id="dbDot"></span>
          <span id="dbBigText">Database ${statusText}</span>
        </div>

        <div class="statusRow">
          <div class="label">Health endpoint</div>
          <button class="btn" id="openHealthModal" type="button">
            Open <span class="kbd">/api/health</span>
          </button>
        </div>

        <div class="statusRow">
          <div class="label">Quick test</div>
          <button class="btn" id="btnRefresh" type="button">
            Refresh status <span class="kbd">R</span>
          </button>
        </div>

        <div class="statusRow">
          <div class="label">Tip</div>
          <div class="value">Use <span class="kbd">curl</span> or Postman</div>
        </div>
      </aside>
      ${
        user
          ? `
      <div class="userWrap">
      <div class="user">
      ${
        user?.picture
          ? `<img src="${user.picture}" class="avatar"/>`
          : `<div class="avatar fallback">
               <svg viewBox="0 0 24 24">
                 <path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12zm0 2.4c-3.3 0-9.8 1.7-9.8 5v2.4h19.6v-2.4c0-3.3-6.5-5-9.8-5z"/>
               </svg>
             </div>`
      }
    
      <div class="meta">
        <div class="name">
          ${user?.name ?? "User"}
          ${
            user?.role === "admin"
              ? `<span class="badge admin">ADMIN</span>`
              : `<span class="badge user">USER</span>`
          }
        </div>
        <div class="email">${user?.email ?? ""}</div>
      </div>
    
      <a href="/logout" class="logoutBtn">Logout</a>
    </div>
      </div>
      `
          : ""
      }
    </div>

    <section class="card tableCard">
      <div class="tableHead">
        <h2>Available Endpoints</h2>
        <div class="hint"></div>
      </div>

      <div class="accWrap">
        ${accordionItems}
      </div>

      <div class="footer">
        <div>© Zipo • Local Gateway UI</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn" id="openCarsModal" type="button">Open <span class="kbd">/api/cars</span></button>
          <button class="btn" id="openFiltersModal" type="button">Open <span class="kbd">/api/cars/filters</span></button>
        </div>
      </div>
    </section>
  </div>

  <!-- Modal -->
  <div class="modalOverlay" id="modalOverlay" role="dialog" aria-modal="true" aria-hidden="true">
    <div class="modal" role="document">
      <div class="modalTop">
        <div class="modalTitle" id="modalTitle">ZIPO • Response</div>
        <button class="xBtn" id="closeModal" type="button">Close <span class="kbd">Esc</span></button>
      </div>
      <div class="modalBody" id="modalBody">
        <div class="modalCard">
          <pre class="jsonPre"><code class="jsonCode">// ...</code></pre>
        </div>
      </div>
    </div>
  </div>

  <script>
    // ---------- Date format: "14 JAN 2025 01:36:43 PM" ----------
    function formatLocalPretty(iso) {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, "0");
      const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

      const day = pad(d.getDate());
      const mon = months[d.getMonth()];
      const year = d.getFullYear();

      let hours = d.getHours();
      const minutes = pad(d.getMinutes());
      const seconds = pad(d.getSeconds());
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hh = pad(hours);

      return \`\${day} \${mon} \${year} \${hh}:\${minutes}:\${seconds} \${ampm}\`;
    }

    // ---------- JSON syntax highlight ----------
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function highlightJson(obj) {
      const json = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
      const esc = escapeHtml(json);

      // token approach
      return esc.replace(
        /("(?:\\\\u[a-fA-F0-9]{4}|\\\\[^u]|[^\\\\"])*"\\s*:)|("(?:\\\\u[a-fA-F0-9]{4}|\\\\[^u]|[^\\\\"])*")|\\b(true|false)\\b|\\b(null)\\b|-?\\b\\d+(?:\\.\\d+)?(?:[eE][+\\-]?\\d+)?\\b|[{}\\[\\],]/g,
        (match, key, str, bool, nul) => {
          if (key) return '<span class="j-key">' + key + '</span>';
          if (str) return '<span class="j-str">' + str + '</span>';
          if (bool) return '<span class="j-bool">' + match + '</span>';
          if (nul) return '<span class="j-null">' + match + '</span>';
          if (/^[{}\\[\\],]$/.test(match)) return '<span class="j-punc">' + match + '</span>';
          // number
          return '<span class="j-num">' + match + '</span>';
        }
      );
    }

    // ---------- Modal helpers ----------
    const overlay = document.getElementById("modalOverlay");
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const closeModalBtn = document.getElementById("closeModal");

    function openModal(title, htmlContent) {
      modalTitle.textContent = title;
      modalBody.innerHTML = htmlContent;
      overlay.classList.add("open");
      overlay.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden", "true");
    }

    closeModalBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    // ---------- Fetch helpers ----------
    async function fetchJson(path) {
      const res = await fetch(path, { cache: "no-store", headers: { accept: "application/json" } });
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    }

    function renderModalJsonCard(titleLine, data) {
      return \`
        <div class="modalCard">
          <h1 class="modalH">\${titleLine}</h1>
          <div class="modalRow">
            <div><div class="label">Tip</div><div class="value">Click outside or press <span class="kbd">Esc</span> to close</div></div>
          </div>
          <pre class="jsonPre"><code class="jsonCode">\${highlightJson(data)}</code></pre>
        </div>
      \`;
    }

    function renderHealthModal(payload) {
      const ok = !!payload?.db?.connected;
      const dot = ok ? "#31e981" : "#ff476c";
      const status = ok ? "Connected" : "Disconnected";

      // Same "health.html.ts" style but as modal card content
      return \`
        <div class="modalCard">
          <h1 class="modalH"><span style="width:10px;height:10px;border-radius:999px;background:\${dot};box-shadow:0 0 18px \${dot};display:inline-block"></span>
            ZIPO Health • DB \${status}
          </h1>

          <div class="modalRow">
            <div><div class="label">Service</div><div class="value">\${escapeHtml(payload.service ?? "")}</div></div>
            <div><div class="label">Now</div><div class="value">\${escapeHtml(payload.now ?? "")}</div></div>
            <div><div class="label">Uptime</div><div class="value">\${escapeHtml(String(payload.uptimeSec ?? ""))}s</div></div>
            <div><div class="label">DB Latency</div><div class="value">\${escapeHtml(String(payload.db?.latencyMs ?? "—"))} ms</div></div>
          </div>

          <div class="modalRow">
            <div class="label">Need raw JSON?</div>
            <div class="value"><span class="kbd">/api/health?format=json</span></div>
          </div>

          <pre class="jsonPre"><code class="jsonCode">\${highlightJson(payload)}</code></pre>
        </div>
      \`;
    }

    // ---------- Status refresh ----------
    async function refreshStatus() {
      try {
        const { data } = await fetchJson("/api/health?format=json");
        const ok = !!data.db?.connected;
        const latency = typeof data.db?.latencyMs === "number" ? data.db.latencyMs + " ms" : "—";

        const dot = document.getElementById("dbDot");
        const txt = document.getElementById("dbStatusText");
        const big = document.getElementById("dbBigText");
        const lat = document.getElementById("dbLatency");

        if (ok) {
          dot.classList.remove("bad"); dot.classList.add("ok");
          txt.textContent = "Connected";
          big.textContent = "Database Connected";
        } else {
          dot.classList.remove("ok"); dot.classList.add("bad");
          txt.textContent = "Disconnected";
          big.textContent = "Database Disconnected";
        }
        lat.textContent = latency;

        const nowEl = document.getElementById("nowText");
        if (nowEl && data.now) nowEl.textContent = formatLocalPretty(data.now);
      } catch (e) {
        const dot = document.getElementById("dbDot");
        const txt = document.getElementById("dbStatusText");
        const big = document.getElementById("dbBigText");
        const lat = document.getElementById("dbLatency");
        dot.classList.remove("ok"); dot.classList.add("bad");
        txt.textContent = "Disconnected";
        big.textContent = "Database Disconnected";
        lat.textContent = "—";
      }
    }

    document.getElementById("btnRefresh").addEventListener("click", refreshStatus);
    window.addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "r") refreshStatus(); });

    // format server-rendered "Now" immediately
    const nowEl = document.getElementById("nowText");
    if (nowEl) {
      const iso = nowEl.getAttribute("data-iso");
      if (iso) nowEl.textContent = formatLocalPretty(iso);
    }

    // auto refresh on load + every 10s
    refreshStatus();
    setInterval(refreshStatus, 10000);

    // ---------- Modal triggers ----------
    document.getElementById("openHealthModal").addEventListener("click", async () => {
      openModal("ZIPO • Health", renderModalJsonCard("Loading…", { loading: true }));
      const { data } = await fetchJson("/api/health?format=json");
      openModal("ZIPO • Health", renderHealthModal(data));
    });

    document.getElementById("openCarsModal").addEventListener("click", async () => {
      openModal("ZIPO • /api/cars", renderModalJsonCard("Loading…", { loading: true }));
      const { data } = await fetchJson("/api/cars");
      openModal("ZIPO • /api/cars", renderModalJsonCard("Response", data));
    });

    document.getElementById("openFiltersModal").addEventListener("click", async () => {
      openModal("ZIPO • /api/cars/filters", renderModalJsonCard("Loading…", { loading: true }));
      const { data } = await fetchJson("/api/cars/filters");
      openModal("ZIPO • /api/cars/filters", renderModalJsonCard("Response", data));
    });

    // ---------- Accordion behavior: fetch ONLY on expand ----------
    const accItems = document.querySelectorAll(".accItem");

    function setInlineResult(item, obj) {
      const code = item.querySelector(".jsonCode");
      if (!code) return;
      code.innerHTML = highlightJson(obj);
    }

    function setInlineText(item, text) {
      const code = item.querySelector(".jsonCode");
      if (!code) return;
      code.textContent = text;
    }

    accItems.forEach((item) => {
      const head = item.querySelector(".accHead");
      const body = item.querySelector(".accBody");
      const needsId = item.getAttribute("data-needs-id") === "1";
      const pathTpl = item.getAttribute("data-path");

      let fetchedOnExpand = false;

      head.addEventListener("click", async () => {
        const open = item.getAttribute("data-open") === "1";
        if (open) {
          item.setAttribute("data-open", "0");
          head.setAttribute("aria-expanded", "false");
          body.hidden = true;
          return;
        }

        item.setAttribute("data-open", "1");
        head.setAttribute("aria-expanded", "true");
        body.hidden = false;

        // only fetch on expand if endpoint does NOT require :id
        if (!needsId && !fetchedOnExpand) {
          fetchedOnExpand = true;
          try {
            setInlineText(item, "// fetching...");
            const { data } = await fetchJson(pathTpl);
            setInlineResult(item, data);
          } catch (e) {
            setInlineResult(item, { error: "Fetch failed", message: String(e?.message ?? e) });
          }
        }
      });

      const openModalBtn = item.querySelector(".openModalBtn");
      if (openModalBtn) {
        openModalBtn.addEventListener("click", async () => {
          // build final path
          let path = pathTpl;

          if (needsId) {
            const carId = item.querySelector('input[data-role="carId"]')?.value?.trim();
            if (!carId) {
              openModal("ZIPO • Error", renderModalJsonCard("Missing input", { error: "Please enter a Car ID first." }));
              return;
            }
            path = path.replace(":id", encodeURIComponent(carId));

            if (pathTpl.endsWith("/availability")) {
              const start = item.querySelector('input[data-role="start"]')?.value?.trim();
              const end = item.querySelector('input[data-role="end"]')?.value?.trim();
              const qs = new URLSearchParams();
              if (start) qs.set("start", start);
              if (end) qs.set("end", end);
              const s = qs.toString();
              if (s) path += "?" + s;
            }
          }

          openModal("ZIPO • " + path, renderModalJsonCard("Loading…", { loading: true }));
          const { data } = await fetchJson(path);
          openModal("ZIPO • " + path, renderModalJsonCard("Response", data));
        });
      }

      const runInlineBtn = item.querySelector(".runInlineBtn");
      if (runInlineBtn) {
        runInlineBtn.addEventListener("click", async () => {
          try {
            setInlineText(item, "// fetching...");
            const { data } = await fetchJson(pathTpl);
            setInlineResult(item, data);
          } catch (e) {
            setInlineResult(item, { error: "Fetch failed", message: String(e?.message ?? e) });
          }
        });
      }

      const runBtn = item.querySelector(".runBtn");
      if (runBtn) {
        runBtn.addEventListener("click", async () => {
          const carId = item.querySelector('input[data-role="carId"]')?.value?.trim();
          if (!carId) {
            setInlineResult(item, { error: "Missing input", message: "Please enter a Car ID first." });
            return;
          }

          let path = pathTpl.replace(":id", encodeURIComponent(carId));

          if (pathTpl.endsWith("/availability")) {
            const start = item.querySelector('input[data-role="start"]')?.value?.trim();
            const end = item.querySelector('input[data-role="end"]')?.value?.trim();
            const qs = new URLSearchParams();
            if (start) qs.set("start", start);
            if (end) qs.set("end", end);
            const s = qs.toString();
            if (s) path += "?" + s;
          }

          try {
            setInlineText(item, "// fetching...");
            const { data } = await fetchJson(path);
            setInlineResult(item, data);
          } catch (e) {
            setInlineResult(item, { error: "Fetch failed", message: String(e?.message ?? e) });
          }
        });
      }
    });
  </script>
</body>
</html>`;
}
