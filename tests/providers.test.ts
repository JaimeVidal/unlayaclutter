import assert from "node:assert/strict";
import test from "node:test";
import {
  ENDPOINT,
  LOCAL_ENDPOINT,
  TYPESAFE_ENDPOINT,
  evaluate,
  evaluationCall,
  evaluationRequest,
  rulesFromAnswers,
} from "../lib/jev";
import type { Snapshot } from "../lib/model";
import { providerNeedsKey, resolveProvider, smokeCredentials } from "../lib/providers";

const snapshot: Snapshot = {
  url: "https://example.com/article?token=private",
  context: { key: "synthetic", kind: "article", label: "article", origin: "https://example.com" },
  candidates: [
    {
      id: "e0",
      selector: "div.ad-banner",
      tag: "div",
      signals: "advertisement",
      text: "Advertisement",
      position: "static",
      count: 1,
    },
  ],
};
const result = (confidence = 0.95, probability = 0.96) => ({
  model: "jev-1.13.0",
  usage: { input_tokens: 100, output_tokens: 20 },
  answers: {
    e0: {
      type: "choice",
      choice: "ad",
      confidence,
      probabilities: {
        ad: probability,
        keep: 1 - probability,
        cookie: 0,
        promotion: 0,
        newsletter: 0,
        social: 0,
        uncertain: 0,
      },
    },
  },
});

test("TypeSafe construction uses System One, Bearer and jev-latest only", () => {
  const call = evaluationCall(snapshot, "synthetic-test-key", "typesafe");
  assert.equal(call.url, TYPESAFE_ENDPOINT);
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, {
    Authorization: "Bearer synthetic-test-key",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(String(call.init.body));
  assert.deepEqual(body, { ...evaluationRequest(snapshot), model: "jev-latest" });
  assert.ok(!String(call.init.body).includes("token=private"));
  assert.ok(!String(call.init.body).includes("synthetic-test-key"));
  assert.ok(call.init.signal instanceof AbortSignal);
});

test("Gateway construction retains v4 headers, default route and no TypeSafe model field", () => {
  const call = evaluationCall(snapshot, "synthetic-test-key");
  assert.equal(call.url, ENDPOINT);
  assert.deepEqual(call.init.headers, {
    Authorization: "Bearer synthetic-test-key",
    "Content-Type": "application/json",
    "ai-gateway-protocol-version": "0.0.1",
    "ai-gateway-auth-method": "api-key",
    "ai-evaluation-model-specification-version": "4",
    "ai-model-id": "typesafe-ai/jev",
  });
  assert.deepEqual(JSON.parse(String(call.init.body)), evaluationRequest(snapshot));
  assert.equal(JSON.parse(String(call.init.body)).model, undefined);
});

test("stored provider resolution defaults missing/unknown values to local inference", () => {
  for (const input of [undefined, null, "unknown", "", {}, 1])
    assert.equal(resolveProvider(input), "local");
  assert.equal(resolveProvider("vercel"), "vercel");
  assert.equal(resolveProvider("typesafe"), "typesafe");
  assert.equal(resolveProvider("local"), "local");
});

test("local provider needs no key and hosted providers still do", () => {
  assert.equal(providerNeedsKey("local"), false);
  assert.equal(providerNeedsKey("vercel"), true);
  assert.equal(providerNeedsKey("typesafe"), true);
});

test("local construction targets loopback, sends no credential and no model field", () => {
  const call = evaluationCall(snapshot, "", "local");
  assert.equal(call.url, LOCAL_ENDPOINT);
  assert.ok(call.url.startsWith("http://127.0.0.1:"));
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, { "Content-Type": "application/json" });
  assert.equal(new Headers(call.init.headers).has("Authorization"), false);
  assert.equal(JSON.parse(String(call.init.body)).model, undefined);
  assert.deepEqual(JSON.parse(String(call.init.body)), evaluationRequest(snapshot));
  assert.ok(!String(call.init.body).includes("token=private"));
});

test("local gate is looser than the hosted one, matching Laya's entropy-scaled confidence", () => {
  // Laya reports 0.74 confidence at a 0.90 winning probability; the hosted gate would reject it.
  assert.deepEqual(rulesFromAnswers(result(0.74, 0.9), snapshot.candidates, "vercel"), []);
  assert.equal(rulesFromAnswers(result(0.74, 0.9), snapshot.candidates, "local").length, 1);
  // Still gated: below the knee measured by `npm run calibrate`.
  assert.deepEqual(rulesFromAnswers(result(0.19, 0.39), snapshot.candidates, "local"), []);
  assert.deepEqual(rulesFromAnswers(result(0.9, 0.55), snapshot.candidates, "local"), []);
});

test("an unreachable local server explains how to start it instead of 'Failed to fetch'", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(evaluate(snapshot, "", "local"), /python laya_server\.py/);
});

test("evaluate POSTs to the local server and parses the same Choice payload", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, LOCAL_ENDPOINT);
    assert.equal(new Headers(init.headers).has("Authorization"), false);
    return Response.json(result(0.74, 0.9));
  });
  assert.deepEqual(await evaluate(snapshot, "", "local"), [
    { selector: "div.ad-banner", category: "ad", enabled: true },
  ]);
  assert.equal(fetch.mock.calls.length, 1);
});

test("TypeSafe response ignores top-level metadata and enforces BOTH supplied confidence gates", () => {
  assert.equal(rulesFromAnswers(result(), snapshot.candidates).length, 1);
  assert.equal(rulesFromAnswers(result(0.9, 0.9), snapshot.candidates).length, 1);
  assert.deepEqual(rulesFromAnswers(result(0.89, 0.99), snapshot.candidates), []);
  assert.deepEqual(rulesFromAnswers(result(0.99, 0.89), snapshot.candidates), []);
  for (const confidence of [NaN, Infinity, -0.1, 1.1])
    assert.throws(() => rulesFromAnswers(result(confidence), snapshot.candidates));
  const noConfidence = {
    answers: { e0: { type: "choice", choice: "ad", probabilities: { ad: 0.99 } } },
  };
  assert.equal(rulesFromAnswers(noConfidence, snapshot.candidates).length, 1);
});

test("evaluate actually POSTs to TypeSafe and parses Choice payload into rules", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-test-key");
    assert.equal(new Headers(init.headers).has("ai-model-id"), false);
    assert.equal(JSON.parse(String(init.body)).model, "jev-latest");
    return Response.json(result());
  });
  assert.deepEqual(await evaluate(snapshot, "synthetic-test-key", "typesafe"), [
    { selector: "div.ad-banner", category: "ad", enabled: true },
  ]);
  assert.equal(fetch.mock.calls.length, 1);
});

test("HTTP errors are provider aware and never echo response bodies or keys", async (t) => {
  let status = 401;
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("private upstream response", { status }),
  );
  for (const provider of ["typesafe", "vercel"] as const) {
    for (status of [401, 403, 429, 500]) {
      const advice =
        status === 429
          ? "Rate limited. Try again later."
          : status === 500
            ? "Try again later."
            : provider === "typesafe"
              ? "Check your TypeSafe API key."
              : status === 401
                ? "Check your Gateway API key."
                : "Check Gateway credits and model access.";
      await assert.rejects(evaluate(snapshot, "synthetic-test-key", provider), {
        message: `Analysis request failed: HTTP ${status}. ${advice}`,
      });
    }
  }
});

test("smoke credentials support direct aliases and reject mixed provider families", () => {
  assert.deepEqual(smokeCredentials({ JEV_KEY: " synthetic-test-key " }), {
    provider: "typesafe",
    key: "synthetic-test-key",
  });
  assert.deepEqual(smokeCredentials({ TYPESAFE_API_KEY: "synthetic-test-key" }), {
    provider: "typesafe",
    key: "synthetic-test-key",
  });
  assert.deepEqual(smokeCredentials({ AI_GATEWAY_API_KEY: "synthetic-test-key" }), {
    provider: "vercel",
    key: "synthetic-test-key",
  });
  assert.throws(
    () =>
      smokeCredentials({ JEV_KEY: "synthetic-test-key", AI_GATEWAY_API_KEY: "synthetic-test-key" }),
    /Set only one/,
  );
  assert.throws(
    () => smokeCredentials({ JEV_KEY: "first-test-value", TYPESAFE_API_KEY: "second-test-value" }),
    /differ/,
  );
  assert.deepEqual(smokeCredentials({ LAYA_LOCAL: "1" }), { provider: "local", key: "" });
  assert.throws(
    () => smokeCredentials({ LAYA_LOCAL: "1", JEV_KEY: "synthetic-test-key" }),
    /LAYA_LOCAL on its own/,
  );
  assert.throws(() => smokeCredentials({}), /Set LAYA_LOCAL/);
});
