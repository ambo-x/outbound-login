/**
 * Shared utilities for all frontend pages.
 * Load via: <script src="/js/shared.js"></script>
 *
 * All functions are plain `function` declarations for global hoisting.
 */

// ─── HTML Escape ───

// Escapes for BOTH text and double/single-quoted attribute contexts. The old
// textContent/innerHTML trick left quotes unescaped, so scraped values (names,
// companies) interpolated into title="..."/data-*="..." could break out of
// the attribute. Explicit replacement covers every sink in one place.
var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
}

// Whitelist http(s) URLs for href attributes. Scraped/AI-extracted URLs land
// in hrefs — escaping alone does not stop a javascript: URL from executing on
// click. Returns null for anything that is not plain http(s).
function safeHttpUrl(url) {
  if (typeof url !== 'string') return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

// ─── Routing ───

// With Vercel cleanUrls the login page serves at '/login'; a direct hit to
// '/login.html' still reaches the client before Vercel's 308 redirect, so
// treat both as the login page (mirrors the dual-form allowlist in middleware.ts).
function isLoginPath() {
  var p = window.location.pathname;
  return p === '/login' || p === '/login.html';
}

// ─── Toast Notifications ───

function showToast(message, type) {
  var containerId = 'shared-toast-container';
  var container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  var baseClasses = 'px-4 py-2.5 rounded-lg text-sm font-medium border transition-opacity duration-300 max-w-md';
  if (type === 'error') {
    toast.className = baseClasses + ' bg-red-50 text-red-600 border-red-200';
  } else if (type === 'warn') {
    toast.className = baseClasses + ' bg-amber-50 text-amber-700 border-amber-200';
  } else {
    toast.className = baseClasses + ' bg-green-50 text-green-600 border-green-200';
  }

  toast.textContent = message;
  container.appendChild(toast);

  // Keep warnings AND errors visible longer than success toasts — both carry
  // something the user needs to read and act on; success is fire-and-forget.
  var ttl = (type === 'warn' || type === 'error') ? 8000 : 4000;
  setTimeout(function () {
    toast.style.opacity = '0';
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, ttl);
}

// ─── Sender Reconnect Banner ───
//
// A sender whose Unipile connection is dead (e.g. after a workspace/API-key
// swap, or a LinkedIn credential expiry) can no longer send. GET
// /api/accounts/health reports per-channel connection health derived LIVE from
// Unipile; this renders a compact amber banner — one line per affected sender —
// into #reconnect-banner-slot and links into the reconnect flow. Fail-open:
// any error renders no banner.

// Mirror canManageAccount on the accounts page: owners manage every sender;
// members manage only accounts they created. Used to avoid nudging (and
// 403-ing) a member about a sender they cannot reconnect. Fails open to
// "visible" only when the Clerk helpers aren't available (never for a resolved
// member), matching the prior behaviour.
function canManageSenderAccount(acct) {
  try {
    if (typeof getClerkOrgRole === 'function' && getClerkOrgRole() === 'owner') return true;
    if (typeof getClerkUserId === 'function') {
      return !!(acct && acct.created_by) && acct.created_by === getClerkUserId();
    }
  } catch (e) { /* fall through */ }
  return true;
}

// Filter the /api/accounts/health accounts array down to active, manageable
// senders with a channel that needs reconnecting. Returns
// [{ id, display_name, channels }].
function reconnectNeededList(healthAccounts) {
  var out = [];
  (healthAccounts || []).forEach(function (a) {
    if (!a || a.active === false) return; // don't nag about deactivated senders
    if (!canManageSenderAccount(a)) return; // members: only their own senders
    var conn = a.connection || {};
    var channels = [];
    if (conn.linkedin === 'reconnect_needed') channels.push('linkedin');
    if (conn.whatsapp === 'reconnect_needed') channels.push('whatsapp');
    if (channels.length) out.push({ id: a.id, display_name: a.display_name, channels: channels });
  });
  return out;
}

function ensureReconnectBannerStyles() {
  if (document.getElementById('rc-banner-styles')) return;
  var style = document.createElement('style');
  style.id = 'rc-banner-styles';
  style.textContent =
    '.rc-banner{display:flex;flex-direction:column;}' +
    '.rc-banner-row{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
      'padding:8px 16px;background:#FEFCE8;border-bottom:1px solid #FDE68A;font-size:13px;color:#92400E;}' +
    '.rc-banner-msg{display:flex;align-items:center;gap:6px;min-width:0;}' +
    '.rc-banner-msg strong{font-weight:700;}' +
    '.rc-banner-actions{display:flex;gap:6px;flex:none;}' +
    '.rc-banner-chan{color:#B45309;}' +
    '.rc-banner-btn{flex:none;font:inherit;font-size:12px;font-weight:700;color:#fff;background:#CA8A04;' +
      'border:none;border-radius:6px;padding:5px 12px;cursor:pointer;text-decoration:none;line-height:1.4;}' +
    '.rc-banner-btn:hover{background:#A16207;}';
  document.head.appendChild(style);
}

function reconnectChannelLabel(c) { return c === 'whatsapp' ? 'WhatsApp' : 'LinkedIn'; }

// Render the banner into #reconnect-banner-slot. `list` is reconnectNeededList()
// output. When `onReconnect(id, provider)` is supplied (accounts page), each
// Reconnect button calls it in-page; otherwise the button links to /accounts.
function renderReconnectBanner(list, onReconnect) {
  var slot = document.getElementById('reconnect-banner-slot');
  if (!slot) return;
  if (!list || !list.length) { slot.innerHTML = ''; return; }
  ensureReconnectBannerStyles();

  var rows = list.map(function (item) {
    var channels = item.channels || [];
    var chans = channels.map(reconnectChannelLabel).join(' & ');
    var actions;
    if (onReconnect) {
      // One button per dead channel so the action matches the label — a sender
      // with both slots dead gets "Reconnect LinkedIn" + "Reconnect WhatsApp"
      // (reconnect is per-channel), never a single button that fixes only one.
      actions = channels.map(function (c) {
        var lbl = channels.length > 1 ? ('Reconnect ' + reconnectChannelLabel(c)) : 'Reconnect';
        return '<button type="button" class="rc-banner-btn" data-rc-id="' + esc(item.id) +
          '" data-rc-provider="' + esc(c) + '">' + esc(lbl) + '</button>';
      }).join('');
    } else {
      actions = '<a class="rc-banner-btn" href="/accounts">Reconnect</a>';
    }
    return '<div class="rc-banner-row">' +
      '<span class="rc-banner-msg">⚠️&nbsp;<strong>' + esc(item.display_name) + '</strong>&nbsp;needs reconnecting' +
      (chans ? ' <span class="rc-banner-chan">(' + esc(chans) + ')</span>' : '') +
      '</span><span class="rc-banner-actions">' + actions + '</span></div>';
  }).join('');
  slot.innerHTML = '<div class="rc-banner">' + rows + '</div>';

  if (onReconnect) {
    var btns = slot.querySelectorAll('[data-rc-id]');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          onReconnect(b.getAttribute('data-rc-id'), b.getAttribute('data-rc-provider') || undefined);
        });
      })(btns[i]);
    }
  }
}

// Fetch health + render the banner. For pages (e.g. the dashboard) that don't
// otherwise load account data. Fail-open: no banner on any error.
async function loadReconnectBanner(onReconnect) {
  try {
    var data = await fetchWithAuth('/api/accounts/health');
    if (data && data.success) {
      renderReconnectBanner(reconnectNeededList(data.data.accounts), onReconnect);
    }
  } catch (e) {
    /* fail-open — the banner is best-effort */
  }
}

// ─── Error Toast ───
//
// One place that decides HOW an error is shown, based on whether the user can
// actually do something about it:
//
//   • User-fixable (validation / business rules — any 4xx, or a network drop):
//     show the specific reason as-is, e.g. "Daily limit cannot exceed 15".
//   • Technical fault (an unexpected exception, or any 5xx from the server):
//     never show scary internals. Show one calm message asking the user to
//     screenshot the screen and send it to their administrator, and log the
//     real error to the console for support.
//
// `action` is a short human phrase for what was being attempted, e.g.
// "Saving the account" or "Loading campaigns". Pass the caught error as `err`.
function toastError(action, err) {
  // Always keep the real error in the console for support/debugging.
  console.error(action ? '[' + action + ']' : '[error]', err);

  // Numeric status set by fetchWithAuth: 0 = network, 4xx = client, 5xx = server.
  // No status = either a deliberate userError() (a known, user-actionable
  // condition whose message should be shown as-is) or an unexpected JS
  // exception (a fault the user can't fix — hide behind the admin message).
  var status = err && typeof err.status === 'number' ? err.status : null;
  var technical = status === null ? !(err && err.userFacing) : status >= 500;

  if (technical) {
    showToast(
      (action ? action + " didn't work. " : 'Something went wrong. ') +
        'Please take a screenshot of this screen and send it to your administrator.',
      'error'
    );
    return;
  }

  // User-fixable: surface the specific reason, minus any internal "[Service]"
  // prefix that leaks vendor names (e.g. "[Unipile] LinkedIn invite limit…").
  var reason = err && err.message ? String(err.message).replace(/^\[[^\]]+\]\s*/, '') : 'Request failed';
  showToast(reason, 'error');
}

// Build an Error that toastError surfaces verbatim: a KNOWN, user-actionable
// condition (e.g. "nothing was queued because the state changed elsewhere")
// rather than an unexpected fault. Without this marker a status-less Error is
// classified technical and hidden behind "contact your administrator" — which
// turned benign races into false alarms (see toastError).
function userError(message) {
  var e = new Error(message);
  e.userFacing = true;
  return e;
}

// ─── Busy Guard ───

// Wraps an async action so a second invocation while the first is still in
// flight is silently ignored (per-wrapped-function flag). If any argument is a
// button element — or an event whose currentTarget is a button — that button
// is also disabled while the action runs and restored when it settles.
function withBusyGuard(fn) {
  var busy = false;
  return async function () {
    if (busy) return;
    var btn = null;
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a && a.tagName === 'BUTTON') { btn = a; break; }
      if (a && a.currentTarget && a.currentTarget.tagName === 'BUTTON') { btn = a.currentTarget; break; }
    }
    busy = true;
    if (btn) btn.disabled = true;
    try {
      return await fn.apply(this, arguments);
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  };
}

// ─── Auth bounce tracking (401 redirect loop-breaker) ───

// Sliding window of recent hard-401 redirects, persisted in sessionStorage so
// it survives the page → login.html navigation. login.html consults
// isAuthBounceLooping() before auto-activating a single org; a successful
// authenticated response clears the counter.
var AUTH_BOUNCE_KEY = 'auth-bounce-times';
var AUTH_BOUNCE_WINDOW_MS = 30000;
var AUTH_BOUNCE_LIMIT = 2;

function readAuthBounces() {
  try {
    var raw = sessionStorage.getItem(AUTH_BOUNCE_KEY);
    var times = raw ? JSON.parse(raw) : [];
    var cutoff = Date.now() - AUTH_BOUNCE_WINDOW_MS;
    return times.filter(function (t) { return typeof t === 'number' && t >= cutoff; });
  } catch (_e) {
    return [];
  }
}

function recordAuthBounce() {
  try {
    var times = readAuthBounces();
    times.push(Date.now());
    sessionStorage.setItem(AUTH_BOUNCE_KEY, JSON.stringify(times));
  } catch (_e) { /* storage unavailable — degrade to pre-loop-breaker behavior */ }
}

function isAuthBounceLooping() {
  return readAuthBounces().length >= AUTH_BOUNCE_LIMIT;
}

function clearAuthBounce() {
  try { sessionStorage.removeItem(AUTH_BOUNCE_KEY); } catch (_e) { /* ignore */ }
}

// ─── Clerk Auth ───

async function getClerkToken(forceRefresh) {
  if (!window.Clerk || !window.Clerk.session) {
    throw new Error('Not authenticated');
  }
  // skipCache forces Clerk to mint a fresh JWT — used to recover from a 401
  // caused by an expired cached token (a transient refresh blip).
  return await window.Clerk.session.getToken(forceRefresh ? { skipCache: true } : undefined);
}

// A 401 caused by a stale/expired token is transient and worth one silent retry
// with a fresh token. A 401 about the org/role/session is a genuine failure to
// surface as-is. Server messages originate in lib/clerk-auth.ts.
function isStaleTokenError(message) {
  if (!message) return false;
  return /expired|invalid or expired token|token missing user id|bearer header/i.test(message);
}

// ─── Authenticated Fetch Wrapper ───

async function fetchWithAuth(url, options) {
  return fetchWithAuthAttempt(url, options, false);
}

async function fetchWithAuthAttempt(url, options, isRetry) {
  var token = await getClerkToken(isRetry);
  var headers = Object.assign({}, (options && options.headers) || {}, {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
  });

  var response;
  try {
    response = await fetch(url, Object.assign({}, options, { headers: headers }));
  } catch (_e) {
    var netErr = new Error('Network error \u2014 check your connection');
    netErr.status = 0; // 0 = couldn't reach the server (offline / DNS / CORS)
    throw netErr;
  }

  if (response.status === 401) {
    var authBody;
    try {
      authBody = await response.json();
    } catch (_e1) {
      authBody = null;
    }
    var serverMsg = authBody && authBody.error && authBody.error.message;

    // Transient stale-token 401 → retry once with a freshly minted token before
    // bothering the user, so an expired cached JWT no longer reads as an
    // organization setup problem.
    if (!isRetry && isStaleTokenError(serverMsg)) {
      return fetchWithAuthAttempt(url, options, true);
    }

    // Genuine auth/org failure (or the retry still failed) — the session is
    // unrecoverable client-side, so redirect to sign-in instead of stranding
    // the user behind error toasts. login.html honors ?next= to bounce them
    // straight back here after they sign in again.
    //
    // recordAuthBounce() guards against a redirect LOOP: a signed-in user
    // whose requests 401 for a server-side reason (broken org claim, role
    // mismatch) would otherwise ping-pong page → login → auto-activate →
    // page forever. After 2 bounces in 30s login.html stops auto-activating
    // (see isAuthBounceLooping there) and shows the org picker + error.
    if (!isLoginPath()) {
      recordAuthBounce();
      var nextPath = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/login?next=' + nextPath;
      // Navigation is in flight — never settle, so concurrent callers don't
      // flash error toasts (and don't re-set location.href) mid-redirect.
      return new Promise(function () {});
    }
    throw new Error(serverMsg || 'Authentication failed — redirecting to sign in');
  }

  if (!response.ok) {
    var body;
    try {
      body = await response.json();
    } catch (_e2) {
      var parseErr = new Error('Request failed (HTTP ' + response.status + ')');
      parseErr.status = response.status;
      throw parseErr;
    }

    var msg =
      (body && body.error && body.error.message) ||
      (body && typeof body.error === 'string' && body.error) ||
      'Request failed (HTTP ' + response.status + ')';
    // Attach status + code so callers (toastError) can tell a user-fixable 4xx
    // ("Daily limit cannot exceed 15") apart from a server fault they can't act on.
    var httpErr = new Error(msg);
    httpErr.status = response.status;
    httpErr.code = body && body.error && body.error.code;
    throw httpErr;
  }

  // Auth provably works — reset the 401 redirect loop-breaker.
  clearAuthBounce();
  return response.json();
}

// ─── Page Visibility (prevent flash before auth) ───

// Hide page content immediately on load — revealed after auth succeeds
(function() {
  // Don't hide login page
  if (isLoginPath()) return;
  document.documentElement.style.visibility = 'hidden';
})();

function revealPage() {
  document.documentElement.style.visibility = 'visible';
}

// ─── Clerk Init Helper ───
// Call this at the top of every page's script section

async function initClerk() {
  return new Promise(function(resolve, reject) {
    function tryLoad() {
      if (!window.Clerk) {
        setTimeout(tryLoad, 100);
        return;
      }
      window.Clerk.load().then(async function() {
        if (!window.Clerk.user) {
          window.location.href = '/login';
          return;
        }

        // If no active org, try auto-select (1 org) or redirect to login to pick
        if (!window.Clerk.organization) {
          try {
            var memberships = await window.Clerk.user.getOrganizationMemberships();
            if (memberships && memberships.data && memberships.data.length === 1) {
              await window.Clerk.setActive({ organization: memberships.data[0].organization.id });
            } else {
              // 0 or 2+ orgs — redirect to login for org picker / creation
              if (!isLoginPath()) {
                window.location.href = '/login';
              }
              return;
            }
          } catch (e) {
            console.error('[initClerk] Failed to activate org:', e);
            if (!isLoginPath()) {
              window.location.href = '/login';
            }
            return;
          }
        }

        revealPage();
        resolve(window.Clerk);
      }).catch(function(err) { revealPage(); reject(err); });
    }
    tryLoad();
  });
}

// Get current user info for display
function getClerkUser() {
  if (!window.Clerk || !window.Clerk.user) return null;
  return {
    firstName: window.Clerk.user.firstName,
    lastName: window.Clerk.user.lastName,
    email: window.Clerk.user.primaryEmailAddress && window.Clerk.user.primaryEmailAddress.emailAddress,
    imageUrl: window.Clerk.user.imageUrl,
  };
}

// Get current org info
function getClerkOrg() {
  if (!window.Clerk || !window.Clerk.organization) return null;
  return {
    name: window.Clerk.organization.name,
    slug: window.Clerk.organization.slug,
  };
}

// Resolve the user's role in the active org. Returns 'owner' | 'member' | null.
// Clerk's `admin` / `org:admin` roles normalize to 'owner' to match the server
// (see lib/clerk-auth.ts). Returns null when Clerk hasn't loaded or no org is
// active. Use for UX-only gates — the server is the source of truth and any
// admin endpoint will 403 a member regardless.
function getClerkOrgRole() {
  if (!window.Clerk || !window.Clerk.user || !window.Clerk.organization) return null;
  var orgId = window.Clerk.organization.id;
  var memberships = window.Clerk.user.organizationMemberships || [];
  var match = memberships.find ? memberships.find(function(m) {
    return m.organization && m.organization.id === orgId;
  }) : null;
  if (!match) return null;
  var raw = match.role || 'member';
  return raw === 'admin' || raw === 'org:admin' ? 'owner' : 'member';
}

// Resolve the active Clerk user's id, or null when Clerk hasn't loaded.
// Used to decide which accounts a member owns (UX-only; server re-checks).
function getClerkUserId() {
  if (!window.Clerk || !window.Clerk.user) return null;
  return window.Clerk.user.id || null;
}

// Hide every [data-owner-only] element for members. Owner-only nav links
// (Campaigns, Settings) carry this attribute. UX-only — the server still gates
// the underlying endpoints. Called from populateUserInfo so it runs on every
// page automatically.
function applyOwnerOnlyNav() {
  if (getClerkOrgRole() === 'owner') return;
  document.querySelectorAll('[data-owner-only]').forEach(function(el) {
    el.style.display = 'none';
  });
}

// Page-level guard for admin-only pages (campaigns, settings). Redirects a
// member to the outreach queue. Call right after initClerk on those pages.
function guardOwnerOnlyPage() {
  if (getClerkOrgRole() !== 'owner') {
    window.location.replace('/outreach');
    return true;
  }
  return false;
}

// Populate user info in the nav bar (call after initClerk)
function populateUserInfo() {
  applyOwnerOnlyNav();
  var user = getClerkUser();
  if (user) {
    var el = document.getElementById('user-name');
    if (el) el.textContent = user.firstName + ' ' + (user.lastName || '');
  }
  var org = getClerkOrg();
  if (org) {
    var el2 = document.getElementById('org-name');
    if (el2) el2.textContent = org.name;
  }
  var mobileUserNameEl = document.getElementById('mobile-user-name');
  if (mobileUserNameEl && user) {
    mobileUserNameEl.textContent = user.firstName + ' ' + (user.lastName || '');
  }
  var mobileOrgNameEl = document.getElementById('mobile-org-name');
  if (mobileOrgNameEl && org) {
    mobileOrgNameEl.textContent = org.name;
  }
}

// ─── New-Role Pellet ───
// Flags contacts whose primary current role has been held < 6 months.
// Reads from extracted_data.current_roles[0].duration_years (programmatic default,
// always populated when extraction has run). Null duration → no flag.

function isNewRole(contact) {
  var roles = contact && contact.extracted_data && contact.extracted_data.current_roles;
  if (!Array.isArray(roles) || roles.length === 0) return false;
  var d = roles[0] && roles[0].duration_years;
  if (typeof d !== 'number') return false;
  return d < 0.5;
}

function newRolePelletHtml(contact) {
  if (!isNewRole(contact)) return '';
  return '<span class="ml-1 inline-block px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-medium border border-amber-200 align-middle" title="Started current role less than 6 months ago">New role</span>';
}

// ─── Low-Connections Pellet ───
// Flags contacts with fewer than 300 LinkedIn connections.
// Reads from extracted_data.connections_count (programmatic default: a number or null,
// populated at extract time). Null/unknown → no flag (hidden, not a false positive).

function isLowConnections(contact) {
  var n = contact && contact.extracted_data && contact.extracted_data.connections_count;
  if (typeof n !== 'number') return false;
  return n < 300;
}

function lowConnectionsPelletHtml(contact) {
  if (!isLowConnections(contact)) return '';
  return '<span class="ml-1 inline-block px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-medium border border-rose-200 align-middle" title="Fewer than 300 LinkedIn connections">Low network</span>';
}

// ─── Date Formatting ───

function formatDate(dateStr) {
  if (!dateStr) return '\u2013';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(dateStr));
  } catch (_e) {
    return dateStr;
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '\u2013';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(dateStr));
  } catch (_e) {
    return dateStr;
  }
}
