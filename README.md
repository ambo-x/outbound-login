# outbound-login

Static Clerk sign-in page for `outbound.fajrrr.com`, served via GitHub Pages.

The Outbound Fajrrr app itself was shut down 2026-09-04 (Vercel + Supabase
cancelled; full backup exists locally). This repo keeps the domain presentable:
the Clerk widget still authenticates (Clerk instance is alive and
`clerk.outbound.fajrrr.com` still points at Clerk), and signed-in users land on
a static "app is offline" notice (`dashboard.html`).

Files are copied from the Blitz repo's `public/` (login page + assets). The
Clerk publishable key in `login.html` is public by design and only works on
this domain. All other paths 404-redirect to `/login`.
