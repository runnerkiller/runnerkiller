import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { applyRenderPublicUrlFallback } from "../src/render-runtime-env.js";

describe("Render BRIDGE_PUBLIC_URL fallback", () => {
  test("명시적으로 설정한 주소를 덮어쓰지 않는다", () => {
    const env = {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://derived.onrender.com",
      BRIDGE_PUBLIC_URL: "https://bridge.example.com",
    };

    const result = applyRenderPublicUrlFallback(env);

    assert.equal(result.applied, false);
    assert.equal(result.source, "BRIDGE_PUBLIC_URL");
    assert.equal(env.BRIDGE_PUBLIC_URL, "https://bridge.example.com");
  });

  test("Render 공식 외부 URL을 누락된 Bridge 주소로 사용한다", () => {
    const env = {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://wildrift-report-bridge.onrender.com",
    };

    const result = applyRenderPublicUrlFallback(env);

    assert.deepEqual(result, {
      applied: true,
      source: "RENDER_EXTERNAL_URL",
      value: "https://wildrift-report-bridge.onrender.com",
    });
    assert.equal(
      env.BRIDGE_PUBLIC_URL,
      "https://wildrift-report-bridge.onrender.com",
    );
  });

  test("URL이 없으면 Render 공식 호스트명으로 HTTPS 주소를 만든다", () => {
    const env = {
      RENDER: "TRUE",
      RENDER_EXTERNAL_HOSTNAME: "wildrift-report-bridge.onrender.com",
    };

    const result = applyRenderPublicUrlFallback(env);

    assert.equal(result.applied, true);
    assert.equal(
      env.BRIDGE_PUBLIC_URL,
      "https://wildrift-report-bridge.onrender.com",
    );
  });

  test("Render가 아니거나 신뢰할 수 없는 주소는 적용하지 않는다", () => {
    const local = {
      RENDER_EXTERNAL_URL: "https://wildrift-report-bridge.onrender.com",
    };
    const untrusted = {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://evil.example",
    };
    const pathInjected = {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://safe.onrender.com/callback",
    };

    assert.equal(applyRenderPublicUrlFallback(local).applied, false);
    assert.equal(applyRenderPublicUrlFallback(untrusted).applied, false);
    assert.equal(applyRenderPublicUrlFallback(pathInjected).applied, false);
    assert.equal(local.BRIDGE_PUBLIC_URL, undefined);
    assert.equal(untrusted.BRIDGE_PUBLIC_URL, undefined);
    assert.equal(pathInjected.BRIDGE_PUBLIC_URL, undefined);
  });
});
