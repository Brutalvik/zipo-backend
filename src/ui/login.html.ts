export function renderLoginHtml() {
  return `<!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>ZIPO • Login</title>
  <style>
    body{
      margin:0;
      min-height:100vh;
      display:grid;
      place-items:center;
      font-family:ui-sans-serif,system-ui;
      background:radial-gradient(1200px 600px at 20% -10%, #1b2550, transparent),
                 radial-gradient(900px 500px at 100% 0%, #0a7cff30, transparent),
                 #0B1020;
      color:white;
    }
    .card{
      width:100%;
      max-width:420px;
      padding:28px;
      border-radius:22px;
      border:1px solid rgba(255,255,255,.15);
      background:rgba(255,255,255,.08);
      backdrop-filter:blur(14px);
      box-shadow:0 20px 60px rgba(0,0,0,.45);
      text-align:center;
    }
    h1{
      margin:0 0 8px;
      font-size:26px;
      letter-spacing:-.02em;
    }
    p{
      margin:0 0 24px;
      color:rgba(255,255,255,.7);
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
      transform:translateY(-1px);
    }
    .logo{
      text-align:center;
      font-weight:900;
      letter-spacing:.12em;
      opacity:.9;
      margin-bottom:20px;
    }
  </style>
  </head>
  <body>
    <div class="card">
      <div class="logo">ZIPO</div>
      <h1>Welcome back</h1>
      <p>Sign in to access the ZIPO API Gateway</p>
      <a class="btn" href="/auth/google">
        <svg width="18" height="18" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.2 0 5.9 1.1 8.1 3.1l6-6C34.3 2.8 29.6 1 24 1 14.7 1 6.7 6.5 3 14.4l7 5.4C12 13.8 17.6 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.1 24.5c0-1.8-.2-3.5-.5-5H24v9.4h12.5c-.5 2.8-2.1 5.2-4.6 6.8l7.1 5.5c4.2-3.9 6.6-9.7 6.6-16.7z"/>
          <path fill="#FBBC05" d="M10 28.2c-1-2.8-1-5.8 0-8.6l-7-5.4C-.4 19.7-.4 28.3 3 33.8l7-5.6z"/>
          <path fill="#34A853" d="M24 47c5.6 0 10.3-1.8 13.7-4.9l-7.1-5.5c-2 1.3-4.5 2.1-6.6 2.1-6.4 0-12-4.3-14-10.3l-7 5.6C6.7 41.5 14.7 47 24 47z"/>
        </svg>
        Continue with Google
      </a>
    </div>
  </body>
  </html>`;
}
