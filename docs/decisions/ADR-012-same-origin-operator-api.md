# ADR-012: Same-origin operator API transport

Status: Accepted for demo/MVP
Date: 2026-09-30

## Context

The API sets host-only HttpOnly, Secure-in-production, SameSite=Strict session cookies. The web and API services use different onrender.com hosts. Since onrender.com is in the [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat), those hosts are different sites; [Strict cookies are not sent cross-site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), even with credentials included. Returning a successful verify JSON body does not prove a reusable browser session.

## Options considered

1. Weaken the session cookie to SameSite=None and depend on third-party cookie support.
2. Require a custom shared-site domain before testing operator login.
3. Use the existing Next.js server to proxy only the implemented operator endpoints on the web origin.

## Decision

Use fixed [Next.js external rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites) for the four auth routes and snapshot prepare/confirm. The browser uses relative /api/v1 URLs. The configured upstream is API_SERVER_URL, then API_INTERNAL_URL, then local loopback. It must be an HTTPS origin (or loopback HTTP), without URL credentials, path, query or fragment. Requests cannot supply the upstream destination. The API remains responsible for origin validation, one-time proof, sessions and administrator authorization; the proxy grants no role. Cookie Path=/api/v1 and Strict/HttpOnly/Secure behavior are preserved.

## Reasoning

This reuses the existing server without adding a generic public proxy, dependencies, bearer-token storage or weaker cookie attributes. Legacy NEXT_PUBLIC_API_URL no longer controls operator requests. The Blueprint can retain that unused value until its next configuration cleanup; no secret belongs there.

## Consequences

- Operator cookies are set and sent on the web origin, then forwarded server-to-server to the API.
- The upstream is part of the Next build configuration; rebuild the web service when changing it.
- Browser origin must still exactly match the API allowlist. Do not synthesize or replace an untrusted Origin.
- An extra network hop and sleeping free service can delay login.

## Risks

- The API's existing per-client limiter may group proxied users behind web-service egress. This is acceptable only for the single-operator demo; a reviewed ingress/client-identity strategy is required before scaling. Do not trust arbitrary caller-supplied forwarding headers.
- The web server now transports the HttpOnly cookie; its trusted server boundary must not log request cookies or Set-Cookie.
- The fixed proxy path is not evidence of successful live wallet login. That requires user-owned signing and session restoration checks.

## Future work

Prove login, reload/session restoration and logout with the real operator wallet; add distributed ingress limits and production deployment/custody review before a persistent pilot.
