/**
 * Render 런타임에서 BRIDGE_PUBLIC_URL을 안전하게 보완한다.
 *
 * 이 파일은 기존 시작 명령을 바꾸지 않고 다음 환경변수로 선행 로드할 수 있다.
 *
 *   NODE_OPTIONS=--import=./src/render-runtime-env.js
 *
 * 명시적으로 설정한 BRIDGE_PUBLIC_URL이 있으면 절대 덮어쓰지 않는다. 값이 없고
 * Render가 공식 제공하는 RENDER_EXTERNAL_URL 또는 RENDER_EXTERNAL_HOSTNAME이
 * 유효한 onrender.com HTTPS 주소일 때만 보완한다.
 */

const RENDER_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.onrender\.com$/i;

function normalizeRenderOrigin(env) {
  const externalUrl = String(env.RENDER_EXTERNAL_URL ?? "").trim();
  const externalHostname = String(env.RENDER_EXTERNAL_HOSTNAME ?? "").trim();
  const candidate = externalUrl || (externalHostname ? `https://${externalHostname}` : "");

  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.port || url.pathname !== "/" || url.search || url.hash) return null;
    if (!RENDER_HOST_RE.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function applyRenderPublicUrlFallback(env = process.env) {
  const configured = String(env.BRIDGE_PUBLIC_URL ?? "").trim();
  if (configured) {
    return { applied: false, source: "BRIDGE_PUBLIC_URL", value: configured };
  }

  if (String(env.RENDER ?? "").trim().toLowerCase() !== "true") {
    return { applied: false, source: null, value: null };
  }

  const renderOrigin = normalizeRenderOrigin(env);
  if (!renderOrigin) {
    return { applied: false, source: null, value: null };
  }

  env.BRIDGE_PUBLIC_URL = renderOrigin;
  return { applied: true, source: "RENDER_EXTERNAL_URL", value: renderOrigin };
}

const result = applyRenderPublicUrlFallback();
if (result.applied) {
  console.log("Render 공개 주소를 BRIDGE_PUBLIC_URL로 자동 적용했습니다.");
}
