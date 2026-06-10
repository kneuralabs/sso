# Kneuralabs SSO (`sso.kneuralabs.com`)

A static sign-in portal served from GitHub Pages. There is no server-side
component owned by this repo; the only backend is a Supabase REST table used
to share per-user application grants across devices.

## Architecture

```
index.html   – markup only (screens: id → password → dashboard/admin, etc.)
styles.css   – design tokens (light/dark), layout, responsive rules
app.js       – all behaviour (auth flow, admin console, Supabase sync)
CNAME        – custom domain for GitHub Pages
LOGO.png / og.svg – brand assets
```

### Data flow

1. **Seed users** are hardcoded in `app.js` (`USERS`) as SHA-256 password
   hashes. Runtime changes (new users, password changes, deletions) are
   stored as a *diff against the seed* in `localStorage`
   (`kn-users-overrides-v1`); `_loadUsers()` merges seed + overrides.
2. **Sign-in** hashes the entered password with `crypto.subtle` and compares
   against the merged user record — entirely client-side.
3. **App grants** (which internal apps a user may open) live in the Supabase
   table `kn_app_access`, read/written with the anon publishable key so they
   apply on every device. Local `apps` arrays are a fallback when the backend
   is unreachable, and are auto-migrated up on admin login.
4. **Token hand-off**: when opened with `?redirect=<url>` the page appends a
   base64-encoded JSON payload (`kn-auth`) to the destination URL; with
   `?redirect=postmessage` it posts the payload to the embedding parent.
   Both paths are gated by `_isTrustedOrigin()` (same-origin,
   `*.kneuralabs.com` over https, or localhost).

## Known architectural limitations (important)

This is a **client-side-only** auth flow. A static page cannot provide real
authentication, and a code-quality refactor cannot change that:

- The full user table (IDs, names, unsalted SHA-256 password hashes) ships in
  the page source. Fast unsalted hashes of human passwords are crackable
  offline; the shared default password makes this worse.
- The `kn-auth` token is **unsigned** base64 JSON. Any consumer that trusts it
  is trusting a value the user can forge in the address bar. Consuming apps
  must treat it as a hint, not proof of identity.
- The Supabase `kn_app_access` table allows **anonymous read/write**, so app
  grants are world-editable, and admin "user management" only persists in the
  admin's own browser (`localStorage`) — other devices never see new users or
  password resets.
- There is no session, expiry, logout, rate limiting, or audit trail.

The production-grade fix is architectural: move verification server-side
(e.g. Supabase Auth / an edge function) issuing short-lived **signed** tokens,
put RLS on `kn_app_access`, and store users in the database instead of source
+ localStorage. Until then, treat this page as a convenience gate, not a
security boundary.

## Development

No build step. Open `index.html` locally or push to `main` to deploy via
GitHub Pages.
