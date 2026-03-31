---
id: mem-8eca5a8f
type: gotcha
context_hint: When adding buttons or interactive controls inside Link-wrapped card components in the frontend
referenced_files:
  - frontend/components/MarketCard.tsx
source_pr_url: https://github.com/shreypjain/shaadi-book/pull/77
source_session_id: 3548a7f8-1179-46be-9976-1cc1d3352978
---

When adding interactive elements (like a watch/unwatch toggle button) inside a component that is wrapped in a `<Link>` (e.g., `MarketCard` inside a Next.js Link), clicking the button will trigger navigation. You must call both `e.preventDefault()` and `e.stopPropagation()` on the click handler to prevent the link from activating. This applies to any clickable element nested inside a navigational wrapper.
