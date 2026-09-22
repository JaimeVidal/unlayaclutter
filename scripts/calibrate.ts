// Threshold calibration for the local Laya provider.
//
// Builds a labelled page, runs it through unclutter's OWN candidate collector (so only elements
// that would really reach the model are scored), asks the local server, and sweeps the gate.
//
//   npm run server        # in another terminal
//   npm run calibrate
import { JSDOM } from "jsdom";
import { collectCandidates } from "../lib/dom";
import { evaluationRequest } from "../lib/jev";
import { pageContext } from "../lib/page-context";
import type { Category } from "../lib/model";

type Fixture = { cls: string; text: string; fixed?: boolean; tag?: string; gold: Category };

// gold "keep" means hiding this element is a false positive.
const FIXTURES: Fixture[] = [
  { cls: "ad-banner", text: "Advertisement: save 30% on unrelated travel packages.", gold: "ad" },
  { cls: "ad-unit reserved-space", text: "", gold: "ad" },
  { cls: "adsbygoogle", text: "Ads by Google", gold: "ad" },
  { cls: "ad-slot-container", text: "", tag: "iframe", gold: "ad" },
  {
    cls: "sponsored-content",
    text: "Sponsored: 10 gadgets you need in 2026",
    tag: "aside",
    gold: "ad",
  },
  { cls: "ad-leaderboard", text: "", gold: "ad" },
  {
    cls: "sponsored-recommendations",
    text: "You may also like: 15 celebrities who vanished",
    gold: "ad",
  },
  {
    cls: "cookie-consent-overlay",
    text: "We value your privacy. Accept all cookies or manage your preferences.",
    fixed: true,
    gold: "cookie",
  },
  {
    cls: "cookie-banner",
    text: "This site uses cookies to improve your experience. Accept Reject Manage",
    fixed: true,
    gold: "cookie",
  },
  {
    cls: "consent-modal",
    text: "Your Privacy Choices. We and our partners store and access information on a device.",
    fixed: true,
    gold: "cookie",
  },
  { cls: "consent-backdrop", text: "", fixed: true, gold: "cookie" },
  {
    cls: "newsletter-signup",
    text: "Get our weekly newsletter. Enter your email to subscribe.",
    gold: "newsletter",
  },
  {
    cls: "newsletter-modal",
    text: "Never miss a story. Sign up for our daily briefing.",
    fixed: true,
    gold: "newsletter",
  },
  {
    cls: "newsletter-inline",
    text: "Sign up to First Edition, our free daily newsletter.",
    gold: "newsletter",
  },
  { cls: "share-buttons", text: "Share on Facebook Twitter LinkedIn", gold: "social" },
  { cls: "social-follow", text: "Follow us on Instagram and TikTok", gold: "social" },
  { cls: "social-links", text: "Follow us on social media for the latest updates", gold: "social" },
  {
    cls: "promo-banner",
    text: "Black Friday: 50% off everything. Shop now!",
    fixed: true,
    gold: "promotion",
  },
  {
    cls: "app-promo",
    text: "Get the app for a better experience. Download now.",
    fixed: true,
    gold: "promotion",
  },
  {
    cls: "promo-countdown",
    text: "Offer ends in 02:14:09. Save 40% on annual plans.",
    gold: "promotion",
  },
  {
    cls: "upsell-modal",
    text: "Upgrade to Pro for unlimited access. Start free trial.",
    fixed: true,
    gold: "promotion",
  },
  // Hard negatives that survive the collector's own filter.
  { cls: "cookie-policy-link", text: "Read our cookie policy and privacy notice.", gold: "keep" },
  {
    cls: "newsletter-archive",
    text: "Browse past issues of our newsletter that you subscribed to.",
    gold: "keep",
  },
  {
    cls: "sponsored-disclosure",
    text: "This article was produced independently of our advertisers.",
    gold: "keep",
  },
  {
    cls: "related-stories",
    text: "More from this section: three stories you might like",
    gold: "keep",
  },
  {
    cls: "breaking-alert",
    text: "Breaking: parliament votes to dissolve. Follow live coverage.",
    fixed: true,
    gold: "keep",
  },
  { cls: "price-ticker", text: "FTSE 100 8,214.55 +0.42%", fixed: true, gold: "keep" },
  { cls: "age-gate", text: "Confirm you are over 18 to continue.", fixed: true, gold: "keep" },
  {
    cls: "region-modal",
    text: "Choose your region: UK, US, Australia, International",
    fixed: true,
    gold: "keep",
  },
  { cls: "video-overlay", text: "Watch: the full 12-minute interview", fixed: true, gold: "keep" },
  {
    cls: "share-price-panel",
    text: "Your portfolio is up 1.2% today. View holdings.",
    tag: "aside",
    gold: "keep",
  },
  {
    cls: "subscribe-offer",
    text: "Subscribe for unlimited access from $1 a week.",
    fixed: true,
    gold: "keep",
  },
  {
    cls: "social-proof",
    text: "Join 40,000 readers who trust our reporting",
    tag: "aside",
    gold: "keep",
  },
  {
    cls: "related-products",
    text: "Customers also bought: USB-C cable, laptop stand",
    tag: "aside",
    gold: "keep",
  },
];

const url = "https://example.com/news/articles/c123";
const body = FIXTURES.map(
  (f) =>
    `<${f.tag ?? "div"} class="${f.cls}"${f.fixed ? ' style="position:fixed"' : ""}>${f.text}</${f.tag ?? "div"}>`,
).join("");
const html = `<!doctype html><meta property="og:type" content="article"><main data-testid="story"><article><h1>Story</h1><p>Editorial body.</p></article>${body}</main>`;
const document = new JSDOM(html, { url }).window.document;

const candidates = collectCandidates(document);
const goldFor = new Map<string, Category>();
for (const candidate of candidates) {
  const match = FIXTURES.find((f) => candidate.selector.includes(f.cls));
  if (match) goldFor.set(candidate.id, match.gold);
}
const dropped = FIXTURES.filter((f) => !candidates.some((c) => c.selector.includes(f.cls)));

console.log(`${FIXTURES.length} fixtures -> ${candidates.length} reached the model`);
console.log(
  `  filtered out before inference (${dropped.length}): ${dropped.map((d) => d.cls).join(", ") || "none"}\n`,
);

const request = evaluationRequest({ url, context: pageContext(document, url), candidates });
const response = await fetch("http://127.0.0.1:8765/v1/systemone", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request),
});
if (!response.ok) throw new Error(`server returned HTTP ${response.status}`);
const { answers } = (await response.json()) as {
  answers: Record<
    string,
    { choice: Category; probabilities: Record<string, number>; confidence: number }
  >;
};

type Row = { id: string; pred: Category; gold: Category; p: number; conf: number; cls: string };
const rows: Row[] = candidates.flatMap((candidate) => {
  const gold = goldFor.get(candidate.id);
  const answer = answers[candidate.id];
  if (!gold || !answer) return [];
  return [
    {
      id: candidate.id,
      pred: answer.choice,
      gold,
      p: answer.probabilities[answer.choice] ?? 0,
      conf: answer.confidence,
      cls: candidate.selector,
    },
  ];
});

const wantsHiding = (r: Row) => r.pred !== "keep" && r.pred !== "uncertain";
const shouldHide = (r: Row) => r.gold !== "keep" && r.gold !== "uncertain";
const total = rows.filter(shouldHide).length;

console.log("FALSE POSITIVES the model wants to hide, highest probability first:");
const risky = rows.filter((r) => !shouldHide(r) && wantsHiding(r)).sort((a, b) => b.p - a.p);
for (const r of risky)
  console.log(`  p=${r.p.toFixed(3)} conf=${r.conf.toFixed(3)}  as ${r.pred.padEnd(10)} ${r.cls}`);
if (!risky.length) console.log("  none at any threshold");

console.log("\nTRUE POSITIVES, lowest probability first:");
for (const r of rows
  .filter((r) => shouldHide(r) && wantsHiding(r))
  .sort((a, b) => a.p - b.p)
  .slice(0, 8))
  console.log(`  p=${r.p.toFixed(3)} conf=${r.conf.toFixed(3)}  as ${r.pred.padEnd(10)} ${r.cls}`);

console.log(
  `\n${"p".padStart(5)} ${"conf".padStart(5)} | ${"hidden".padStart(6)} ${"right".padStart(5)} ${"WRONG".padStart(5)} ${"missed".padStart(6)}  precision  recall`,
);
for (const [p, c] of [
  [0.9, 0.9],
  [0.85, 0.75],
  [0.8, 0.7],
  [0.75, 0.6],
  [0.7, 0.5],
  [0.65, 0.45],
  [0.6, 0.35],
  [0.5, 0.25],
  [0.4, 0.0],
  [0.0, 0.0],
] as const) {
  const hidden = rows.filter((r) => wantsHiding(r) && r.p >= p && r.conf >= c);
  const right = hidden.filter(shouldHide).length;
  const wrong = hidden.length - right;
  const precision = hidden.length ? right / hidden.length : 1;
  console.log(
    `${p.toFixed(2).padStart(5)} ${c.toFixed(2).padStart(5)} | ${String(hidden.length).padStart(6)} ${String(right).padStart(5)} ${String(wrong).padStart(5)} ${String(total - right).padStart(6)}      ${precision.toFixed(3)}   ${(right / total).toFixed(3)}`,
  );
}
