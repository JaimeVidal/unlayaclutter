# unlayaclutter

Hide ads, cookie banners and promotional overlays with reusable per-page-template rules — classified by a model running on your own machine.

A fork of **[kitze/unclutter](https://github.com/kitze/unclutter)** (MIT). Upstream sends element descriptions to TypeSafe's Jev over the network. This fork runs [Laya](https://laya.convaiinnovations.com/) on localhost instead: no API key, no per-page cost, and no page data leaving the computer. The hosted Jev providers still work if you pick them in the popup.

## Quickstart

```sh
npm install
npm run build              # extension -> .output/chrome-mv3
npm run server:setup       # python venv for the model
npm run server:install     # launchd agent: starts at login, restarts on crash
```

Then load `.output/chrome-mv3` at `chrome://extensions` with **Developer mode** on. The provider already defaults to **Local Laya** and needs no key — click **Analyze page**.

The first `server:install` downloads ~808 MB of weights and takes about a minute. Afterwards the server is always up; check it with `curl 127.0.0.1:8765/health` and read `~/Library/Logs/laya-unclutter.log`. `npm run server:uninstall` removes the agent; `npm run server` runs it in the foreground instead.

## Differences from upstream

- **Local Laya is the default provider.** Installations with no provider setting resolve to it rather than Vercel Gateway.
- **`server/`** holds the Python server, which adapts unclutter's request shape to Laya's 512-token context. See [`server/README.md`](server/README.md) for why that adaptation is necessary.
- **The confidence gate is per provider.** Hosted Jev keeps 0.9/0.9; local uses 0.60/0.35, because Laya scores confidence on a different scale.
- **`npm run` replaces `bun run`** in the `check` script, and `package-lock.json` is committed alongside `bun.lock`.
- **Extra tooling**: `npm run try -- <url>` runs a real page through the whole pipeline without a browser; `npm run calibrate` re-measures the confidence gate.

## Install from source

Requires Node.js 22.12 or newer and Python 3.10+. (Upstream uses [Bun](https://bun.sh); npm
works too and is what the commands below assume.)

```sh
git clone https://github.com/JaimeVidal/unlayaclutter.git
cd unlayaclutter
npm install
npm run build
npm run server:setup
npm run server:install
```

1. Open `chrome://extensions` (or your Chromium browser's extensions page).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3` inside the cloned repository.
4. Pin Unlayaclutter, refresh any already-open website, then open its popup.
5. Make sure the model server is up: `curl 127.0.0.1:8765/health`. `npm run server:install` keeps it running as a launchd agent; `npm run server` runs it in the foreground instead.
6. Under **Connection**, leave the provider on **Local Laya (this computer)**. No key is needed. To use hosted Jev instead, pick **Vercel AI Gateway** or **TypeSafe AI** and paste the matching key.
7. Choose **Manual** (default) and click **Analyze page**, or select **On page visit**.

After replacing unpacked builds, click **Reload** on the extension card and refresh website tabs. Existing keys/settings stay in place. V1 templates show **Update available**; **Re-analyze** once to include cookie dialogs, or automatic mode upgrades them once while preserving paused templates and keep-visible choices.

For Firefox 140+, run `npm run build:firefox`, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `.output/firefox-mv2/manifest.json`. Temporary add-ons disappear on Firefox restart; permanent Firefox distribution requires Mozilla signing. Chrome/Edge/Brave can use the Chromium build. Safari packaging is not included.

Local Laya needs no credential at all. For the hosted providers, bring your own [Vercel AI Gateway](https://vercel.com/ai-gateway) key or [TypeSafe AI key](https://console.typesafe.ai/settings/keys) (the same kind used as `JEV_KEY` / `TYPESAFE_API_KEY`). Configure it in the extension popup, not in source code or build-time environment variables. No key or shared account is bundled.

**One key is stored.** Switching the provider persists immediately and reuses that key for the next analysis; paste a matching key if the providers use different credentials. Saving a key saves the selected provider with it. Removing the key does not reset the provider. Installations without a provider setting default to Local Laya in this fork. Saved templates remain usable offline regardless of provider.

Local Laya uses `POST http://127.0.0.1:8765/v1/systemone` with no Authorization header and no model field. TypeSafe direct uses `POST https://api.typesafe.ai/v1/systemone`, Bearer authentication, and body model `jev-latest`. Gateway uses its evaluation-model v4 endpoint and `typesafe-ai/jev` headers. TypeSafe requests never carry Gateway protocol headers; Gateway requests never carry the TypeSafe model field.

## Behavior

- **Manual**: analysis only when you click **Analyze page / Re-analyze**. Free and local unless you selected a hosted provider.
- **On page visit**: analyze new templates in visible tabs, after a short render-settling delay. This automatically sends candidate snippets to the selected provider. Off by default. With Local Laya the snippets go to `127.0.0.1` and cost nothing.
- Saved templates apply without further model requests, including zero-rule results. New analysis-rubric versions may refresh an enabled old template once in automatic mode; paused profiles and disabled rules are preserved.
- Automatic attempts are deduplicated across tabs and persisted before the request. Failure/interruption does not trigger automatic retries; click **Analyze page / Re-analyze** to retry.
- Cookie overlays (including Sourcepoint's session-numbered iframe/container IDs and BBC's `ngasCookiePrompt`) are eligible for visual hiding. No Accept/Reject buttons are clicked and no consent choice is written.
- Empty ad wrappers and their reserved-height/padding/advertisement labels collapse too, stopping before useful sibling content. Normal overflow-based cookie scroll locks are released while hiding the overlay and restored when paused.
- Toolbar badge: green **ON** = saved and active; gray **OFF** = paused; amber **…** = analyzing; red **!** = failed. Tooltip includes actual hidden element count.
- **Pause / Resume** controls the current page type across tabs. The header switch disables the whole extension. Both restore hidden elements immediately.
- **Re-analyze** replaces this template's rules while preserving disabled rules that are still identified. Failed, malformed, or stale responses leave existing rules unchanged.
- Uncheck a rule in **Hidden elements** to keep those elements visible.
- **Forget this page type** removes its saved rules, restores the page, and permits a fresh analysis.
- Removing the API key leaves saved rules usable offline.

## Template reuse

Keys combine exact origin, policy version, page kind, normalized route family, and a stable main-shell marker. Homepage, article, product, search, listing, and generic routes stay separate. Article/product leaves and date/ID segments are normalized; tracking query parameters do not fragment the cache.

Examples: BBC `/news/articles/cabc123` and `/news/articles/cdef456` share a profile if their shells match. `/`, `/news`, and a different article shell do not. Generic short routes such as `/news/world` and `/news/business` stay separate. No global cross-domain rules.

This is a conservative heuristic, not perfect template recognition. Different route families may need separate initial analyses; different layouts sharing the same shell may share a profile. Every selector is revalidated against the current DOM before hiding. Stable `data-testid`, `data-component`, IDs, and classes are used; no positional selectors or AI-generated CSS. Randomized class-only pages may yield no safely targetable candidates. There is no periodic cache expiry or automatic paid retry. Re-analyze manually after site redesigns.

## Privacy and safety

### With Local Laya (the default)

- **No page data leaves the computer.** The extension posts to `http://127.0.0.1:8765`; the model runs in a Python process you started. There is no account, no API key to store, and no request to anyone's server.
- The server **binds to loopback only** and has **no authentication**. Anything that can already run code as you can call it. Passing `--host 0.0.0.0` would expose unauthenticated inference to your whole network — don't, unless you mean it.
- It costs **~2.7–3.2 GB** of memory while running: 1.6 GB of fp32 weights on the GPU plus ~1 GB of Python, PyTorch and transformers. (RSS alone reads near zero once macOS compresses or swaps the idle process; `footprint <pid>` is the honest number.) It downloads ~808 MB of weights into `~/.cache/huggingface` on first start. `npm run server:uninstall` stops it starting at login. On a machine already short of memory this adds to swap pressure, which is what makes an idle extension slow to open — see **Troubleshooting**.
- Model weights come from the `convaiinnovations/laya` repository on Hugging Face. You are trusting that download the same way you trust any dependency.

### With the hosted providers (opt-in)

- Each analysis sends up to 60 bounded candidate descriptions (tag, structural signals, short text, position, match count). No full URL, query string, page title, main article body, form values, cookies, or raw HTML is sent. Email-like and long numeric strings are redacted, but this is **not a guarantee of anonymization**. Do not analyze sensitive pages if sending snippets to a third party is inappropriate.
- The API key stays in local extension storage, **not encrypted** and not synced. Chrome restricts storage access to trusted extension contexts. It is never sent to page content scripts, websites, logs, or repository source.

### Both

- Only extension background code calls the selected endpoint. Popup-origin checks protect settings and manual analysis. Page-visit requests are validated and require the saved automatic-mode opt-in.
- The model receives typed keep/ad/promotion/newsletter/social/cookie/uncertain choices and returns probabilities, never text. Page content is untrusted evidence, not instructions; the model cannot emit code or selectors. Responses are validated for type, completeness, valid categories and numeric ranges. Invalid or non-finite values reject the whole response and leave existing rules untouched. Uncertain results stay visible.
- Selected-choice probability and confidence must **both** clear a per-provider gate, or the element stays visible. Hosted Jev uses 0.9/0.9; Local Laya uses 0.60/0.35, because Laya scores confidence as normalised Shannon entropy over seven categories, where a 0.90 winning probability still only reaches 0.74. `npm run calibrate` re-measures it. These are operational cutoffs, not calibrated accuracy claims.
- **Tightening that gate does not buy safety.** Laya's worst mistakes are its most confident: it reads a footer cookie-policy _link_ as a consent banner at p=0.988. Those are model errors, not confidence errors, and no threshold catches them. Review the rule list in the popup and untick anything wrong — the choice sticks for that page template.
- Main content, navigation, ordinary forms, login/payment/security and paywalls are protected before the model ever sees them. Cookie-dialog headings and checkbox controls may hide with their containing overlay, but sensitive inputs still block hiding. No links are clicked, no consent granted, no requests blocked, no access restrictions bypassed. Hiding a cookie dialog is not rejection and not tracking protection — use Pause to reach the real consent controls. Hiding ads does not stop their network activity.
- Hidden DOM nodes are not deleted. A temporary attribute, an extension-owned stylesheet and reversible inline display overrides remove the occupied space (including inline `!important`). Original style values and priorities are restored; unrelated site style changes are preserved.
- Late-loaded elements are rechecked through a bounded, debounced mutation observer. SPA navigation restores the previous rules and resolves the new template. In-flight analyses are discarded after navigation or concurrent edits.
- Cross-origin iframe contents and shadow DOM are not traversed. Consent iframe/container selectors are reusable across numeric session IDs. Native dialogs and ordinary embedded forms stay visible. Scroll unlocking does not run behind other visible modals; non-overflow locks (fixed-body, inert, custom event interception) may still need site-specific handling.
- HTTP(S) access is required to restore saved rules on later visits. Internal browser pages, extension stores, PDFs and file URLs are not supported.

## Troubleshooting

**The popup takes seconds to open.** Measured in a clean Chrome, the popup is interactive in 90–130 ms and every message behind it takes under 15 ms, so the extension code is not the bottleneck. Seconds-long opens come from memory pressure: Chrome stops idle extension service workers after ~30 s, and restarting one on a machine that is deep into swap means paging it back in from disk. Check with `sysctl vm.swapusage`. Chrome's **Memory Saver** (Settings → Performance) and closing tabs help most; the Laya server's ~3 GB is a smaller share.

**Analyze fails with "Cannot reach the local Laya server".** `curl 127.0.0.1:8765/health`. If nothing answers, `tail ~/Library/Logs/laya-unclutter.log` and reinstall the agent with `npm run server:install`. The first request after a long idle can also be slow while the server's own memory pages back in.

## Development

```sh
npm install
npm run check
npm run build
npm run build:firefox
```

Use `npm run dev` for WXT development mode. Unpacked production builds need no build server, but Local Laya does need `npm run server` running to analyze a page.

Two live checks against a running local server:

```sh
npm run smoke                                   # four synthetic elements, asserts the categories
npm run try -- https://www.bbc.com/news         # a real page end to end, prints the rules it would write
```

`npm run try` fetches the page, runs unclutter's own candidate collector over it in jsdom, calls the local server, and prints the resulting selectors — the whole pipeline without loading a browser extension.

The normal checks use synthetic fixtures and need no API key or server. For a hosted live smoke test: set `JEV_KEY` or `TYPESAFE_API_KEY` for TypeSafe AI, **or** `AI_GATEWAY_API_KEY` for Gateway, then run `npx tsx scripts/smoke.ts`. Do not set both provider families; conflicting direct-key aliases are rejected too. Never pass a key as a command-line argument. The hosted smoke sends synthetic inputs only and incurs a small API charge; `LAYA_LOCAL=1` selects the local server instead and costs nothing. Never commit `.env` files, API keys, browser profiles, or real browsing data.

Outputs: `.output/chrome-mv3/` and `.output/firefox-mv2/`. `npm run zip` packages Chromium.

Architecture: `lib/page-context.ts` identifies templates, `lib/dom.ts` extracts candidates and applies reversible rules, `lib/jev.ts` implements Gateway evaluation-model v4, TypeSafe System One and the local Laya endpoint with shared choice validation and per-provider gates, `server/laya_server.py` runs Laya locally and adapts the request shape to its 512-token context, `entrypoints/background.ts` owns credentials/cache/actions, `entrypoints/cleaner.content.ts` handles page lifecycle, and `entrypoints/popup/` provides controls. Settings and profiles use independent storage keys to avoid unrelated-tab write loss.

## License

[MIT](LICENSE). Original work copyright the unclutter authors; the fork keeps the same licence and the upstream copyright notice.
