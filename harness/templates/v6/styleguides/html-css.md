# HTML and CSS Styleguide

Apply `general.md` first. Preserve the repository's approved formatter, CSS architecture, design tokens, component conventions, and supported-browser policy.

## HTML defaults

- Produce conforming HTML with `<!doctype html>`, UTF-8, a document language, and the responsive viewport metadata for complete documents.
- Use the native element that matches the content or interaction. Prefer semantic landmarks, headings, links, buttons, lists, forms, and tables over generic containers or custom roles.
- Keep heading levels and DOM/source order logical. Do not use CSS to disguise an incorrect content hierarchy.
- Give controls programmatic labels, images appropriate text alternatives, links descriptive text, and data tables scoped headers.
- Preserve native keyboard behavior. Use links for navigation and buttons for actions; do not make a `div` or `span` imitate either.
- Use ARIA only when native HTML cannot express the required semantics, and keep names, roles, values, and states accurate.
- Keep structure in HTML and presentation in CSS. Avoid presentational elements, inline style attributes, and duplicated markup used only for layout.
- Treat untrusted markup as hostile; never insert it without an approved sanitization boundary.

## CSS defaults

- Build layouts from content outward using normal flow, Flexbox, and Grid. Prefer fluid sizing and intentional breakpoints over fixed device-specific dimensions.
- Use the cascade deliberately: keep selectors simple and specificity low, scope component rules predictably, and avoid `!important` except for an approved, documented override layer.
- Use classes for reusable styling and semantic, consistently named hooks. Do not couple styles to fragile DOM depth or use IDs for routine styling.
- Centralize repeated design decisions as custom properties or approved design tokens. Name tokens by purpose when their meaning is shared.
- Prefer relative and logical sizing/spacing where it improves zoom, localization, writing-mode, and responsive behavior; follow the supported-browser policy.
- Preserve visible focus, sufficient contrast, legible text, and usable target sizes. Do not communicate meaning through color alone.
- Keep motion purposeful and honor `prefers-reduced-motion`; never make essential information depend only on animation.
- Organize declarations and files according to the repository formatter and architecture. Remove obsolete rules and avoid unexplained magic numbers.

## Verification

- Run the repository HTML/CSS formatter, HTML conformance checks, Stylelint or the approved linter, tests, and production build.
- Check supported viewport widths, zoom/text resizing, overflow, long/localized content, print or forced-colors modes when applicable, and the supported browser matrix.
- Exercise the page with a keyboard and project accessibility tooling; verify focus order, accessible names, landmarks, contrast, and reduced-motion behavior.

## Sources

- [WHATWG HTML Living Standard](https://html.spec.whatwg.org/)
- [MDN: Semantic HTML](https://developer.mozilla.org/en-US/curriculum/core/semantic-html/)
- [MDN: HTML accessibility](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/HTML)
- [MDN: CSS and JavaScript accessibility best practices](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/CSS_and_JavaScript)
- [W3C: How to Meet WCAG](https://www.w3.org/WAI/WCAG22/quickref/)
