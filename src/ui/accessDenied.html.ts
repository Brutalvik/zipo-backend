// src/ui/accessDenied.html.ts
export function renderAccessDeniedHtml(opts: {
  email?: string;
  name?: string;
  picture?: string;
}) {
  const { email, name, picture } = opts;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ZIPO • Access Denied</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body{
      margin:0;
      min-height:100vh;
      display:grid;
      place-items:center;
      background:
        radial-gradient(900px 600px at 20% -10%, rgba(120,170,255,.28), transparent 60%),
        radial-gradient(900px 600px at 110% 20%, rgba(180,110,255,.24), transparent 60%),
        linear-gradient(180deg, #070A12, #0B1020);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: rgba(255,255,255,.92);
    }

    .card{
      max-width:420px;
      padding:28px;
      border-radius:22px;
      background: rgba(255,255,255,.08);
      border:1px solid rgba(255,255,255,.14);
      backdrop-filter: blur(14px);
      box-shadow: 0 30px 90px rgba(0,0,0,.65);
      text-align:center;
    }

    .avatar{
      width:72px;
      height:72px;
      border-radius:50%;
      margin:0 auto 16px;
      object-fit:cover;
      border:1px solid rgba(255,255,255,.25);
    }

    h1{
      margin:0 0 8px;
      font-size:22px;
      letter-spacing:-.01em;
    }

    p{
      margin:6px 0;
      font-size:14px;
      color:rgba(255,255,255,.7);
      line-height:1.5;
    }

    .email{
      margin-top:6px;
      font-size:13px;
      opacity:.6;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas;
    }

    .actions{
      margin-top:22px;
      display:flex;
      flex-direction:column;
      gap:12px;
    }

    .btn{
      display:flex;
      align-items:center;
      justify-content:center;
      gap:12px;
      width:90%;
      padding:14px 16px;
      border-radius:14px;
      border:1px solid rgba(255,255,255,.25);
      background:rgba(255,255,255,.12);
      color:white;
      font-size:15px;
      font-weight:600;
      cursor:pointer;
      text-decoration:none;
      transition:.2s;
    }

    .btn:hover{
      background:rgba(255,255,255,.18);
      transform: translateY(-1px);
    }

    .muted{
      margin-top:14px;
      font-size:12px;
      opacity:.55;
    }

    .access {
    color:red;
    }
  </style>
</head>
<body>
  <div class="card">
    ${
      picture
        ? `<img class="avatar" src="${picture}" />`
        : `<div class="avatar" style="display:grid;place-items:center;background:rgba(255,255,255,.14);font-size:32px;">👤</div>`
    }

    <h1 class="access">Access Restricted</h1>
    ${email ? `<p>Email: ${email}</p>` : ""}
    <p>
      This gateway is limited to approved ZIPO team members.
    </p>

    ${name ? `<div class="email">${name}</div>` : ""}

    <div class="actions">
      <a href="/logout" class="btn">Try with a different account</a>
    </div>

    <div class="muted">
      If you reached this page by mistake, you can safely close this window.
    </div>
  </div>
</body>
</html>`;
}
