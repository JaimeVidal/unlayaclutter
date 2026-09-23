// Build a self-contained labelling page from data/candidates.jsonl.
//
//   npm run label      # writes data/label.html and opens it
//
// Keyboard: Enter accepts the model's answer, 1-7 (or k/a/c/p/n/s/u) override it,
// Backspace goes back. Progress is kept in localStorage; Export downloads the corrected JSONL.
import { readFileSync, writeFileSync } from "node:fs";

const rows = readFileSync("data/candidates.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>unlayaclutter labeller</title>
<style>
  :root {
    --bg:#fbfbfa; --fg:#1a1a18; --muted:#6b6b66; --line:#e2e2dd; --card:#fff;
    --keep:#2f7d5f; --ad:#b4472e; --cookie:#6b5bb5; --promotion:#b57f2e;
    --newsletter:#2e6fb4; --social:#a8447f; --uncertain:#7a7a74;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme=light]) {
    --bg:#16161a; --fg:#eceae4; --muted:#96958e; --line:#2c2c32; --card:#1e1e23;
    --keep:#5fbf95; --ad:#e88468; --cookie:#a596e8; --promotion:#e0b264;
    --newsletter:#6aa6e8; --social:#dd85b8; --uncertain:#9a9a94;
  } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 ui-sans-serif,-apple-system,system-ui,sans-serif;
         display:flex; flex-direction:column; min-height:100vh; }
  header { padding:14px 16px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:center; flex-wrap:wrap }
  .bar { flex:1; min-width:140px; height:6px; background:var(--line); border-radius:99px; overflow:hidden }
  .bar > i { display:block; height:100%; background:var(--keep); transition:width .15s }
  main { flex:1; padding:16px; max-width:760px; margin:0 auto; width:100% }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:14px }
  .meta { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; font-size:12px; color:var(--muted) }
  .meta code { background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:1px 6px; font-size:12px }
  .sig { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; color:var(--muted); margin-bottom:8px; word-break:break-word }
  .txt { font-size:15px; max-height:180px; overflow:auto; white-space:pre-wrap; word-break:break-word }
  .txt:empty::before { content:"(no text — empty element)"; color:var(--muted); font-style:italic }
  .guess { display:flex; align-items:baseline; gap:10px; margin:14px 0 8px; font-size:13px; color:var(--muted) }
  .guess b { font-size:16px; color:var(--fg) }
  .opts { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px }
  button.opt { text-align:left; padding:9px 11px; border:1px solid var(--line); border-radius:9px; background:var(--card);
               color:var(--fg); font:inherit; cursor:pointer; display:flex; gap:9px; align-items:center }
  button.opt:hover { border-color:var(--muted) }
  button.opt.is-guess { border-color:currentColor; border-width:2px; padding:8px 10px }
  button.opt kbd { font:600 11px ui-monospace,monospace; background:var(--bg); border:1px solid var(--line);
                   border-radius:4px; padding:1px 5px; color:var(--muted) }
  .dot { width:9px; height:9px; border-radius:99px; flex:none }
  footer { border-top:1px solid var(--line); padding:12px 16px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;
           font-size:13px; color:var(--muted); position:sticky; bottom:0; background:var(--bg) }
  footer button { padding:7px 13px; border-radius:8px; border:1px solid var(--line); background:var(--card);
                  color:var(--fg); font:inherit; cursor:pointer }
  footer button.primary { background:var(--keep); border-color:var(--keep); color:#fff; font-weight:600 }
  .done { text-align:center; padding:48px 16px }
  .done h2 { margin:0 0 8px }
  @media (max-width:520px) { .opts { grid-template-columns:1fr 1fr } }
</style></head><body>
<header>
  <strong>Labeller</strong>
  <div class="bar"><i id="fill" style="width:0"></i></div>
  <span id="count"></span>
</header>
<main id="main"></main>
<footer>
  <button id="back">← Back</button>
  <button id="export" class="primary">Export JSONL</button>
  <span id="stat"></span>
  <span style="margin-left:auto">Enter = accept · 1-7 = override</span>
</footer>
<script>
const CATS = ["keep","ad","cookie","promotion","newsletter","social","uncertain"];
const KEYS = { k:"keep", a:"ad", c:"cookie", p:"promotion", n:"newsletter", s:"social", u:"uncertain" };
const ROWS = ${JSON.stringify(rows)};
const STORE = "unlayaclutter.labels.v1";

let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch {}
ROWS.forEach((r, i) => { if (saved[i]) { r.label = saved[i]; r.reviewed = true; } });

let at = ROWS.findIndex(r => !r.reviewed);
if (at < 0) at = ROWS.length;

function persist() {
  const out = {};
  ROWS.forEach((r, i) => { if (r.reviewed) out[i] = r.label; });
  try { localStorage.setItem(STORE, JSON.stringify(out)); } catch {}
}
function choose(cat) {
  if (at >= ROWS.length) return;
  ROWS[at].label = cat; ROWS[at].reviewed = true;
  persist(); at++; render();
}
function render() {
  const done = ROWS.filter(r => r.reviewed).length;
  const changed = ROWS.filter(r => r.reviewed && r.label !== r.pred).length;
  document.getElementById("fill").style.width = (100 * done / ROWS.length) + "%";
  document.getElementById("count").textContent = done + " / " + ROWS.length;
  document.getElementById("stat").textContent = changed + " corrections so far";
  document.getElementById("back").disabled = at === 0;
  const main = document.getElementById("main");
  if (at >= ROWS.length) {
    main.innerHTML = '<div class="done"><h2>All ' + ROWS.length + ' reviewed</h2><p>' + changed +
      " disagreed with the model. Hit Export JSONL and hand the file back to Claude.</p></div>";
    return;
  }
  const r = ROWS[at];
  main.innerHTML =
    '<div class="card">' +
      '<div class="meta"><code>' + r.tag + "</code><code>" + r.position + "</code>" +
        (r.count > 1 ? "<code>×" + r.count + "</code>" : "") +
        "<span>" + new URL(r.url).hostname + "</span><span>" + r.template + "</span></div>" +
      '<div class="sig">' + esc(r.signals) + "</div>" +
      '<div class="txt">' + esc(r.text) + "</div>" +
    "</div>" +
    '<div class="guess">model says <b style="color:var(--' + r.pred + ')">' + r.pred +
      "</b> at p=" + r.p.toFixed(3) + ", confidence " + r.confidence.toFixed(3) + "</div>" +
    '<div class="opts">' + CATS.map((c, i) =>
      '<button class="opt' + (c === r.pred ? " is-guess" : "") + '" style="color:var(--' + c + ')" data-cat="' + c + '">' +
        '<span class="dot" style="background:var(--' + c + ')"></span>' +
        '<span style="color:var(--fg);flex:1">' + c + "</span><kbd>" + (i + 1) + "</kbd></button>").join("") +
    "</div>";
  main.querySelectorAll("button.opt").forEach(b =>
    b.addEventListener("click", () => choose(b.dataset.cat)));
}
function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }

addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (at < ROWS.length) choose(ROWS[at].pred); return; }
  if (e.key === "Backspace") { e.preventDefault(); if (at > 0) { at--; ROWS[at].reviewed = false; persist(); render(); } return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 7) { e.preventDefault(); choose(CATS[n - 1]); return; }
  const c = KEYS[e.key.toLowerCase()];
  if (c) { e.preventDefault(); choose(c); }
});
document.getElementById("back").addEventListener("click", () => {
  if (at > 0) { at--; ROWS[at].reviewed = false; persist(); render(); }
});
document.getElementById("export").addEventListener("click", () => {
  const body = ROWS.map(r => JSON.stringify(r)).join("\\n") + "\\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }));
  a.download = "labelled.jsonl"; a.click();
});
render();
</script></body></html>`;

writeFileSync("data/label.html", html);
console.log(`data/label.html — ${rows.length} elements to review`);
console.log("Enter accepts the model's answer, 1-7 override it. Export writes labelled.jsonl.");
