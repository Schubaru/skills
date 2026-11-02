import { next } from '@vercel/edge'
import { createRemoteJWKSet, jwtVerify } from 'jose'

// Email+OTP gate for the whole preview. Nothing — HTML, JS, assets — is served
// without a valid gate cookie, which is only ever minted from a live,
// signature-verified Supabase session (see POST /__gate/session below). The
// login page served here is self-contained: it runs Supabase's email-OTP flow
// with plain fetch, seeds the session where supabase-js expects it, then
// reloads into the app. Who may sign in is enforced server-side by the
// Before User Created hook + access_rules table (supabase/auth-access.sql).
//
// Env (Vercel → Project Settings → Environment Variables):
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — same values the app uses.
//   GATE_SECRET — random secret the gate cookie is HMAC-signed with.
//     Rotating it signs everyone out (the old SITE_PASSWORD-change lever).
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const GATE_SECRET = process.env.GATE_SECRET

const COOKIE_NAME = 'rv_auth'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days — matches the old password cookie

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'))
}

let hmacKey: Promise<CryptoKey> | null = null
function getHmacKey(): Promise<CryptoKey> {
  if (!hmacKey) {
    hmacKey = crypto.subtle.importKey('raw', enc.encode(GATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ])
  }
  return hmacKey
}

async function mintCookie(email: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ e: email, t: Math.floor(Date.now() / 1000) })))
  const sig = await crypto.subtle.sign('HMAC', await getHmacKey(), enc.encode(payload))
  return `${payload}.${b64url(new Uint8Array(sig))}`
}

/** The signed-in email, or null. Old password-era cookie values fail the HMAC
 *  and read as absent, so stale cookies just land on the new login page. */
async function verifyCookie(value: string): Promise<string | null> {
  const dot = value.indexOf('.')
  if (dot < 0) return null
  const payload = value.slice(0, dot)
  try {
    const sig = Uint8Array.from(b64urlDecode(value.slice(dot + 1)), (c) => c.charCodeAt(0))
    const ok = await crypto.subtle.verify('HMAC', await getHmacKey(), sig, enc.encode(payload))
    if (!ok) return null
    const { e, t } = JSON.parse(b64urlDecode(payload)) as { e?: string; t?: number }
    if (typeof e !== 'string' || typeof t !== 'number') return null
    if (Math.floor(Date.now() / 1000) - t > COOKIE_MAX_AGE) return null
    return e
  } catch {
    return null
  }
}

// Supabase's JWKS (the project signs sessions with an asymmetric ES256 key).
// Module scope: jose caches the fetched keys across warm invocations.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  return jwks
}

function setCookieHeader(value: string, maxAge: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
}

// No brand lockup on the gate (the reviewer, 2026-07-10) — it stays anonymous and just
// asks for an email + code (an unbranded page also leaks nothing about what's
// behind it). Same rule for error copy: one generic line, no allowlist detail.
function loginPage(): Response {
  // supabase-js hydrates its session from this exact localStorage key; the
  // /auth/v1/verify response body is the session object it expects, verbatim.
  const storageKey = `sb-${new URL(SUPABASE_URL!).hostname.split('.')[0]}-auth-token`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Protected preview</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, 'Segoe UI', Roboto, sans-serif; }
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; }
  form { display: grid; gap: 12px; width: min(320px, 85vw); text-align: center; }
  h1 { font-size: 18px; font-weight: 600; margin: 0; }
  p { margin: 0; font-size: 14px; opacity: 0.7; }
  input, button { font: inherit; padding: 10px 18px; border-radius: 9999px; }
  input { border: 1px solid #8884; text-align: inherit; }
  input:focus { outline: none; border-color: #111; box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.08); }
  button { border: none; background: #111; color: #fff; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  @media (prefers-color-scheme: dark) {
    button { background: #f5f5f5; color: #111; }
    input:focus { border-color: #f5f5f5; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15); }
  }
  .error { color: #c0392b; font-size: 14px; margin: 0; }
  /* Empty error takes no space — the button sits tight under the input and
     only moves down when a message actually appears. */
  .error:empty { display: none; }
  .linkish { background: none; color: inherit; opacity: 0.6; font-size: 13px; padding: 4px; }
  textarea { font: inherit; padding: 10px 14px; border-radius: 14px; border: 1px solid #8884; resize: vertical; }
  textarea:focus { outline: none; border-color: #111; box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.08); }
  @media (prefers-color-scheme: dark) {
    textarea:focus { border-color: #f5f5f5; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15); }
  }
  /* The ask only exists after a refusal, so every part of it starts hidden. */
  #request-step, #request-form, #req-done { display: none; width: min(320px, 85vw); }
  #request-step { gap: 12px; text-align: center; }
  #request-form { gap: 12px; }
  #code-step { display: none; }
  #code { text-align: center; letter-spacing: 0.3em; }
</style>
</head>
<body>
<form id="email-step">
  <h1>Log in</h1>
  <p>Enter your email and we&rsquo;ll send a one-time code.</p>
  <input id="email" type="email" name="email" placeholder="email@address.com" autocomplete="email" autofocus required />
  <p class="error" id="email-error"></p>
  <button id="email-btn" type="submit">Send code</button>
</form>
<div id="request-step">
  <button class="linkish" type="button" id="request-open">Request access</button>
  <form id="request-form">
    <input id="req-name" name="name" placeholder="Your name (optional)" autocomplete="name" maxlength="80" />
    <textarea id="req-note" name="message" rows="3" placeholder="A short note (optional)" maxlength="500"></textarea>
    <p class="error" id="req-error"></p>
    <button id="req-btn" type="submit">Send request</button>
  </form>
  <p id="req-done">Request sent. We&rsquo;ll email you if it&rsquo;s approved.</p>
</div>
<form id="code-step">
  <h1>Enter the code</h1>
  <p id="sent-to">We sent a 6-digit code.</p>
  <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required />
  <p class="error" id="code-error"></p>
  <button id="code-btn" type="submit">Continue</button>
  <button class="linkish" type="button" id="back">Use a different email</button>
</form>
<script>
(function () {
  var SB = ${JSON.stringify(SUPABASE_URL)};
  var KEY = ${JSON.stringify(ANON_KEY)};
  var SK = ${JSON.stringify(storageKey)};
  var email = '';
  var emailStep = document.getElementById('email-step');
  var codeStep = document.getElementById('code-step');
  var requestStep = document.getElementById('request-step');
  function post(path, body) {
    return fetch(SB + path, {
      method: 'POST',
      headers: { apikey: KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  // The press moves you to the code screen AT ONCE and the send happens
  // behind it (the reviewer, 2026-09-07: a slow send read as nothing happening, so
  // the button got pressed again). One send at a time; a failed send brings
  // the email screen back with the reason.
  var sending = false;
  emailStep.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (sending) return;
    sending = true;
    var err = document.getElementById('email-error');
    var btn = document.getElementById('email-btn');
    var codeBtn = document.getElementById('code-btn');
    err.textContent = '';
    btn.disabled = true;
    codeBtn.disabled = true;
    email = document.getElementById('email').value.trim();
    document.getElementById('sent-to').textContent = 'Sending a 6-digit code to ' + email + '\\u2026';
    emailStep.style.display = 'none';
    codeStep.style.display = 'grid';
    requestStep.style.display = 'none';
    document.getElementById('code').focus();
    var failure = '';
    // Only a REFUSAL earns the ask. A throttle or a dropped connection is not
    // a closed door, and offering to knock on one would just confuse it.
    var refused = false;
    try {
      var res = await post('/auth/v1/otp', { email: email, create_user: true });
      if (res.ok) {
        document.getElementById('sent-to').textContent = 'We sent a 6-digit code to ' + email + '.';
      } else if (res.status === 429) {
        failure = 'Too many attempts. Try again in a minute.';
      } else {
        failure = "That email isn't authorized for this preview.";
        refused = true;
      }
    } catch {
      failure = 'Network problem. Try again.';
    }
    if (failure) {
      codeStep.style.display = 'none';
      emailStep.style.display = 'grid';
      err.textContent = failure;
      if (refused) requestStep.style.display = 'grid';
    }
    codeBtn.disabled = false;
    btn.disabled = false;
    sending = false;
  });
  codeStep.addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = document.getElementById('code-error');
    var btn = document.getElementById('code-btn');
    err.textContent = '';
    btn.disabled = true;
    try {
      var res = await post('/auth/v1/verify', {
        type: 'email',
        email: email,
        token: document.getElementById('code').value.trim(),
      });
      if (res.ok) {
        var session = await res.json();
        try { localStorage.setItem(SK, JSON.stringify(session)); } catch {}
        var gate = await fetch('/__gate/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token }),
        });
        if (gate.ok) { location.reload(); return; }
        err.textContent = 'Sign-in failed. Try again.';
      } else if (res.status === 429) {
        err.textContent = 'Too many attempts. Try again in a minute.';
      } else {
        err.textContent = "That code didn't work. Check it and try again.";
      }
    } catch {
      err.textContent = 'Network problem. Try again.';
    }
    btn.disabled = false;
  });
  // Asking to be let in. Posts to the request-access Edge Function with the
  // anon key, exactly as the OTP calls above do — there is no session yet, so
  // the function is the only way a request can reach the table.
  document.getElementById('request-open').addEventListener('click', function () {
    document.getElementById('request-open').style.display = 'none';
    document.getElementById('request-form').style.display = 'grid';
    document.getElementById('req-name').focus();
  });
  document.getElementById('request-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var reqErr = document.getElementById('req-error');
    var reqBtn = document.getElementById('req-btn');
    reqErr.textContent = '';
    reqBtn.disabled = true;
    try {
      var r = await fetch(SB + '/functions/v1/request-access', {
        method: 'POST',
        headers: { apikey: KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email,
          name: document.getElementById('req-name').value.trim().slice(0, 80),
          message: document.getElementById('req-note').value.trim().slice(0, 500),
        }),
      });
      if (r.ok) {
        document.getElementById('request-form').style.display = 'none';
        document.getElementById('req-done').style.display = 'block';
      } else if (r.status === 429) {
        reqErr.textContent = "You've already asked. We'll be in touch.";
      } else {
        reqErr.textContent = "That didn't go through. Try again.";
      }
    } catch {
      reqErr.textContent = 'Network problem. Try again.';
    }
    reqBtn.disabled = false;
  });
  // Digits only, and submit on the 6th — pasting the code from the email
  // signs you in without touching the button.
  var codeInput = document.getElementById('code');
  codeInput.addEventListener('input', function () {
    var digits = codeInput.value.replace(/\\D/g, '').slice(0, 6);
    if (codeInput.value !== digits) codeInput.value = digits;
    if (digits.length === 6 && !document.getElementById('code-btn').disabled) codeStep.requestSubmit();
  });
  document.getElementById('back').addEventListener('click', function () {
    codeStep.style.display = 'none';
    emailStep.style.display = 'grid';
    document.getElementById('code').value = '';
    document.getElementById('code-error').textContent = '';
    document.getElementById('email').focus();
  });
})();
</script>
</body>
</html>`
  return new Response(html, {
    status: 401,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export default async function middleware(request: Request) {
  if (!SUPABASE_URL || !ANON_KEY || !GATE_SECRET) {
    // Fail closed: an unconfigured gate must not serve the preview.
    return new Response('Preview auth is not configured.', { status: 503, headers: { 'cache-control': 'no-store' } })
  }

  const { pathname } = new URL(request.url)

  // Exchange a live Supabase session for the 30-day gate cookie. Verifying the
  // JWT against the project's public JWKS proves the caller really signed in;
  // after that the gate is a local HMAC check, decoupled from Supabase's
  // 1-hour token expiry and refresh rotation.
  if (pathname === '/__gate/session' && request.method === 'POST') {
    try {
      const { access_token } = (await request.json()) as { access_token?: string }
      if (typeof access_token !== 'string') throw new Error('missing token')
      const { payload } = await jwtVerify(access_token, getJwks(), {
        issuer: `${SUPABASE_URL}/auth/v1`,
        algorithms: ['ES256'],
      })
      const email = payload.email
      if (typeof email !== 'string' || !email) throw new Error('no email claim')
      return new Response(null, {
        status: 204,
        headers: { 'set-cookie': setCookieHeader(await mintCookie(email), COOKIE_MAX_AGE) },
      })
    } catch {
      return new Response(null, { status: 401 })
    }
  }

  // The cookie is HttpOnly, so sign-out needs a server-side clear.
  if (pathname === '/__gate/logout' && request.method === 'POST') {
    return new Response(null, { status: 204, headers: { 'set-cookie': setCookieHeader('', 0) } })
  }

  const cookies = request.headers.get('cookie') ?? ''
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  if (match && (await verifyCookie(match[1]))) return next()

  return loginPage()
}
