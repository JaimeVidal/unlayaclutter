## 2026-11-09 - aria-label overriding visible text
**Learning:** Using `aria-label` on an input overrides the visible text content for screen readers. It is important to include critical context (e.g. category) in the `aria-label` when generated dynamically so screen reader users don't lose that context.
**Action:** When adding `aria-label` to components that contain text, ensure the label encompasses both the action and the visible context, rather than completely replacing it with less informative text.
