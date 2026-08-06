#!/usr/bin/env node

const SITE_URL = "https://runnerkiller.github.io/rift-archive/";
const BRIDGE_URL = "https://wildrift-report-bridge.onrender.com";
const REQUEST_TIMEOUT_MS = 45_000;

async function request(path, { redirect = "follow" } = {}) {
  const url = path.startsWith("http") ? path : `${BRIDGE_URL}${path}`;
  const startedAt = performance.now();
  const response = await fetch(url, {
    redirect,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "user-agent": "rift-archive-live-check/1.0" },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 200);
  }
  return {
    url,
    status: response.status,
    location: response.headers.get("location"),
    elapsedMs: Math.round(performance.now() - startedAt),
    body,
  };
}

const checks = [];

async function check(name, run, validate) {
  try {
    const result = await run();
    const detail = validate(result);
    checks.push({ name, ok: detail.ok, detail: detail.message, result });
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message, result: null });
  }
}

await check(
  "GitHub Pages",
  () => request(SITE_URL),
  (r) => ({ ok: r.status === 200, message: `HTTP ${r.status}` }),
);
await check(
  "Bridge liveness",
  () => request("/livez"),
  (r) => ({
    ok: r.status === 200 && r.body?.status === "ok",
    message: `HTTP ${r.status}, status=${r.body?.status ?? "unknown"}`,
  }),
);
await check(
  "Discord health",
  () => request("/health"),
  (r) => ({
    ok:
      r.status === 200 &&
      r.body?.status === "ok" &&
      r.body?.discord?.connected === true &&
      r.body?.config?.loaded === true,
    message: `HTTP ${r.status}, bridge=${r.body?.status ?? "unknown"}, discord=${
      r.body?.discord?.connected ?? false
    }, config=${r.body?.config?.loaded ?? false}`,
  }),
);
await check(
  "Public config",
  () => request("/api/config"),
  (r) => ({
    ok: r.status === 200 && r.body?.config?.schemaVersion === 1,
    message: `HTTP ${r.status}, schema=${r.body?.config?.schemaVersion ?? "unknown"}`,
  }),
);
await check(
  "Public reports",
  () => request("/api/reports"),
  (r) => ({
    ok: r.status === 200 && Array.isArray(r.body?.reports),
    message: `HTTP ${r.status}, reports=${r.body?.reports?.length ?? "unknown"}`,
  }),
);
await check(
  "Discord OAuth start",
  () => request("/api/auth/discord?returnTo=/rift-archive/", { redirect: "manual" }),
  (r) => ({
    ok: r.status === 302 && /^https:\/\/discord\.com\//.test(r.location ?? ""),
    message:
      r.status === 503 && r.body?.error?.code === "auth_not_configured"
        ? "OAuth environment is not configured"
        : `HTTP ${r.status}, redirect=${r.location ? "Discord" : "none"}`,
  }),
);

for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
}

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} live check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nAll live checks passed.");
}
