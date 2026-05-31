// HTTP/HTTPS security audit — Node port of KaliGPT web_request_framework.
// Post-deploy smoke test, live project audit, header/cookie/CORS hygiene
// check. Used by the devops/cybersecurity advisor + chiefs.

const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "No HSTS — required to prevent downgrade attacks",
  "content-security-policy": "No CSP — XSS protection is critical",
  "x-content-type-options": "Should be 'nosniff' — prevents MIME sniffing",
  "x-frame-options": "Missing — clickjacking risk",
  "referrer-policy": "Controls referrer leakage",
  "permissions-policy": "Browser feature restriction",
};

export interface SecurityFinding {
  severity: "high" | "medium" | "low" | "info";
  category: string;
  message: string;
}

export interface ScanResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  reason: string;
  isHttps: boolean;
  redirects: number;
  contentType: string;
  contentLength: number;
  responseTimeMs: number;
  serverHeaders: Record<string, string>;
  missingSecurityHeaders: string[];
  findings: SecurityFinding[];
  cookies: Array<{
    name: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: string | null;
  }>;
  cors: {
    allowOrigin: string | null;
    allowCredentials: boolean;
    overlyPermissive: boolean;
  };
  fingerprint: {
    server: string | null;
    poweredBy: string | null;
    techLeaks: string[];
  };
  bodyPreview: string;
  errors?: string[];
}

function parseSetCookie(headerValue: string): Array<{
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}> {
  // Set-Cookie multi-header — the Headers API joins into a single string.
  // Naive split: comma, but a date may contain a comma. Safer:
  // each cookie separated by ;, name=value at the first =.
  const cookies: ReturnType<typeof parseSetCookie> = [];
  // Split by newline-like delimiter if multiple headers; fall back to single.
  const lines = headerValue.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const line of lines) {
    const parts = line.split(";").map((p) => p.trim());
    const first = parts[0] ?? "";
    const eq = first.indexOf("=");
    if (eq < 0) continue;
    const name = first.slice(0, eq);
    let secure = false;
    let httpOnly = false;
    let sameSite: string | null = null;
    for (const p of parts.slice(1)) {
      const lo = p.toLowerCase();
      if (lo === "secure") secure = true;
      else if (lo === "httponly") httpOnly = true;
      else if (lo.startsWith("samesite=")) sameSite = p.split("=")[1] ?? null;
    }
    cookies.push({ name, secure, httpOnly, sameSite });
  }
  return cookies;
}

export interface ScanOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function scanUrl(
  rawUrl: string,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const method = (opts.method ?? "GET").toUpperCase();
  const reqHeaders = {
    "User-Agent": "Mozilla/5.0 (compatible; ArchitectScanner/1.0)",
    ...(opts.headers ?? {}),
  };
  const timeout = opts.timeoutMs ?? 15_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const start = Date.now();
  const findings: SecurityFinding[] = [];
  const errors: string[] = [];

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: opts.body,
      redirect: "follow",
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    throw new Error(`fetch error: ${(e as Error).message}`);
  }
  clearTimeout(t);
  const responseTime = Date.now() - start;

  // Header inspection — header keys lowercased.
  const serverHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => (serverHeaders[k.toLowerCase()] = v));

  // Missing security headers.
  const missing: string[] = [];
  for (const [h, msg] of Object.entries(SECURITY_HEADERS)) {
    if (!serverHeaders[h]) {
      missing.push(h);
      findings.push({
        severity: h === "content-security-policy" || h === "strict-transport-security" ? "high" : "medium",
        category: "missing-header",
        message: `${h}: ${msg}`,
      });
    }
  }

  // HTTPS check.
  const isHttps = response.url.startsWith("https://");
  if (!isHttps) {
    findings.push({
      severity: "high",
      category: "transport",
      message: "HTTPS is not used — traffic is cleartext",
    });
  }

  // Cookie analysis.
  const setCookie = serverHeaders["set-cookie"] ?? "";
  const cookies = setCookie ? parseSetCookie(setCookie) : [];
  for (const c of cookies) {
    if (!c.secure && isHttps) {
      findings.push({
        severity: "high",
        category: "cookie",
        message: `Cookie '${c.name}' has no Secure flag — may be sent cleartext even over HTTPS`,
      });
    }
    if (!c.httpOnly) {
      findings.push({
        severity: "medium",
        category: "cookie",
        message: `Cookie '${c.name}' has no HttpOnly — accessible to JS, XSS risk`,
      });
    }
    if (!c.sameSite) {
      findings.push({
        severity: "medium",
        category: "cookie",
        message: `Cookie '${c.name}' has no SameSite — CSRF risk`,
      });
    }
  }

  // CORS check.
  const allowOrigin = serverHeaders["access-control-allow-origin"] ?? null;
  const allowCredentials =
    (serverHeaders["access-control-allow-credentials"] ?? "").toLowerCase() === "true";
  const overlyPermissive = allowOrigin === "*" && allowCredentials;
  if (overlyPermissive) {
    findings.push({
      severity: "high",
      category: "cors",
      message: "CORS Allow-Origin: * + Allow-Credentials: true — credential leakage risk",
    });
  }

  // Server fingerprint.
  const serverHdr = serverHeaders["server"] ?? null;
  const poweredBy = serverHeaders["x-powered-by"] ?? null;
  const techLeaks: string[] = [];
  if (serverHdr && /\d+\.\d+/.test(serverHdr)) {
    techLeaks.push(`Server: ${serverHdr} (version disclosure)`);
    findings.push({
      severity: "low",
      category: "fingerprint",
      message: `Server header contains a version: '${serverHdr}'`,
    });
  }
  if (poweredBy) {
    techLeaks.push(`X-Powered-By: ${poweredBy}`);
    findings.push({
      severity: "low",
      category: "fingerprint",
      message: `X-Powered-By header disclosed: '${poweredBy}' — hiding it is best practice`,
    });
  }

  // Rate limit.
  if (response.status === 429) {
    findings.push({
      severity: "info",
      category: "rate-limit",
      message: "429 Too Many Requests — rate limit active (good news)",
    });
  }

  // ETag weak.
  const etag = serverHeaders["etag"];
  if (etag && etag.startsWith("W/")) {
    findings.push({
      severity: "low",
      category: "caching",
      message: `Weak ETag (${etag}) — cache poisoning risk`,
    });
  }

  // Body preview.
  let bodyText = "";
  try {
    bodyText = (await response.text()).slice(0, 500);
  } catch {
    /* may be binary */
  }

  return {
    url,
    finalUrl: response.url,
    statusCode: response.status,
    reason: response.statusText,
    isHttps,
    redirects: 0, // no count API for fetch redirect:'follow'
    contentType: serverHeaders["content-type"] ?? "",
    contentLength: parseInt(serverHeaders["content-length"] ?? "0", 10) || bodyText.length,
    responseTimeMs: responseTime,
    serverHeaders,
    missingSecurityHeaders: missing,
    findings,
    cookies,
    cors: { allowOrigin, allowCredentials, overlyPermissive },
    fingerprint: { server: serverHdr, poweredBy, techLeaks },
    bodyPreview: bodyText,
    errors: errors.length ? errors : undefined,
  };
}

// Standard hygiene URLs — security.txt, robots.txt, sitemap, stale env.
export async function scanExtras(
  baseUrl: string,
  timeoutMs = 8000,
): Promise<Record<string, { exists: boolean; status?: number }>> {
  const base = baseUrl.replace(/\/$/, "");
  const paths = [
    "/.well-known/security.txt",
    "/security.txt",
    "/robots.txt",
    "/sitemap.xml",
    "/crossdomain.xml",
    "/.env",
    "/.git/config",
    "/wp-admin",
    "/admin",
  ];
  const out: Record<string, { exists: boolean; status?: number }> = {};
  for (const p of paths) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${base}${p}`, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 ArchitectScanner" },
      });
      out[p] = { exists: r.status < 400, status: r.status };
    } catch {
      out[p] = { exists: false };
    } finally {
      clearTimeout(t);
    }
  }
  return out;
}
