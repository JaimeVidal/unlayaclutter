## 2024-11-10 - Protect local servers from web CSRF

**Vulnerability:** A local Python server bound to `127.0.0.1` had `Access-Control-Allow-Origin: *` which allowed any website to make cross-origin requests to it. While typically safe if there are no side effects, it's a dangerous pattern for a local service.
**Learning:** Even if a server is bound to localhost, web browsers allow public websites to send requests to `localhost`/`127.0.0.1` (CSRF or Cross-Origin Read Blocking bypass). Returning `Access-Control-Allow-Origin: *` enables any website to read responses from the local server.
**Prevention:** For local servers intended to be used by browser extensions, always restrict CORS to `chrome-extension://` and `moz-extension://` origins instead of `*`.
