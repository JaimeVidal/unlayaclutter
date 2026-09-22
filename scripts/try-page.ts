// Run a real page through the whole pipeline without a browser:
// fetch HTML -> unclutter's own candidate collector -> local Laya -> CSS rules.
//
//   npm run try -- https://www.theguardian.com/international
import { JSDOM } from "jsdom";
import { collectCandidates } from "../lib/dom";
import { evaluate } from "../lib/jev";
import { pageContext } from "../lib/page-context";

const urls = process.argv.slice(2);
if (!urls.length) throw new Error("Usage: npm run try -- <url> [url...]");

for (const url of urls) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await response.text();
    const document = new JSDOM(html, { url }).window.document;
    const candidates = collectCandidates(document);
    const context = pageContext(document, url);
    console.log(`\n${url}`);
    console.log(`  template: ${context.label}`);
    if (!candidates.length) {
      console.log(`  no candidates collected from ${html.length} bytes of HTML`);
      continue;
    }
    const started = performance.now();
    const rules = await evaluate({ url, context, candidates }, "", "local");
    const ms = Math.round(performance.now() - started);
    console.log(
      `  ${candidates.length} candidates -> ${rules.length} rules in ${ms} ms (${Math.round(ms / candidates.length)} ms/element)`,
    );
    for (const rule of rules) {
      console.log(`    ${rule.category.padEnd(11)} ${rule.selector.slice(0, 88)}`);
    }
  } catch (error) {
    console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}
