// Harvest labelling data: real pages -> unclutter's candidate collector -> local Laya ->
// one JSONL row per element, with the model's own answer pre-filled as the starting label.
//
//   npm run harvest                       # uses scripts/sites.txt
//   npm run harvest -- https://a.com ...  # or explicit URLs
//
// Output: data/candidates.jsonl. Correct the wrong labels with `npm run label`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { collectCandidates } from "../lib/dom";
import { evaluationRequest } from "../lib/jev";
import { pageContext } from "../lib/page-context";
import type { Category } from "../lib/model";

const CONCURRENCY = 6;
const args = process.argv.slice(2);
const urls = args.length
  ? args
  : readFileSync(new URL("./sites.txt", import.meta.url), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

type Row = {
  url: string;
  template: string;
  selector: string;
  tag: string;
  signals: string;
  text: string;
  position: string;
  count: number;
  pred: Category;
  p: number;
  confidence: number;
  label: Category; // starts as the prediction; you only fix the wrong ones
  reviewed: boolean;
};

async function harvest(url: string): Promise<Row[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const document = new JSDOM(await response.text(), { url }).window.document;
  const candidates = collectCandidates(document);
  if (!candidates.length) return [];
  const context = pageContext(document, url);
  const request = evaluationRequest({ url, context, candidates });
  const inference = await fetch("http://127.0.0.1:8765/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000),
  });
  if (!inference.ok) throw new Error(`server HTTP ${inference.status}`);
  const { answers } = (await inference.json()) as {
    answers: Record<
      string,
      { choice: Category; probabilities: Record<string, number>; confidence: number }
    >;
  };
  return candidates.flatMap((c) => {
    const a = answers[c.id];
    if (!a) return [];
    return [
      {
        url,
        template: context.label,
        selector: c.selector,
        tag: c.tag,
        signals: c.signals,
        text: c.text,
        position: c.position,
        count: c.count,
        pred: a.choice,
        p: a.probabilities[a.choice] ?? 0,
        confidence: a.confidence,
        label: a.choice,
        reviewed: false,
      },
    ];
  });
}

const rows: Row[] = [];
const failures: string[] = [];
const queue = [...urls];

await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const harvested = await harvest(url);
        rows.push(...harvested);
        console.log(`  ${String(harvested.length).padStart(3)}  ${url}`);
      } catch (error) {
        failures.push(url);
        console.log(`  ERR  ${url} — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }),
);

// Least confident first: those are the rows where your correction teaches the most.
rows.sort((a, b) => a.confidence - b.confidence);
mkdirSync("data", { recursive: true });
writeFileSync("data/candidates.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const byPred = new Map<string, number>();
for (const r of rows) byPred.set(r.pred, (byPred.get(r.pred) ?? 0) + 1);
console.log(
  `\n${rows.length} elements from ${urls.length - failures.length}/${urls.length} pages -> data/candidates.jsonl`,
);
console.log(
  "  model's own distribution:",
  [...byPred]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", "),
);
if (failures.length) console.log(`  unreachable: ${failures.length}`);
console.log("\nNext: npm run label");
