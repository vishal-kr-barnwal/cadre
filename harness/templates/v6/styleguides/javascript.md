# JavaScript Styleguide

Apply `general.md` first. Preserve the repository's approved formatter, semicolon, quote, and module settings.

## Idiomatic defaults

- Use ECMAScript modules for new code when the runtime/toolchain supports them; keep imports at the top and dependencies explicit.
- Declare with `const` by default and `let` only when reassignment is required. Do not use `var` in modern targets.
- Use strict equality (`===`/`!==`) except for an intentional, documented nullish check.
- Keep functions focused, minimize shared mutable state, and prefer data transformations with clear ownership.
- Use `async`/`await` or deliberate Promise composition; always handle rejection and preserve useful error context.
- Use braces for control flow and avoid implicit behavior that reduces readability.
- Validate untrusted values at external boundaries before use.
- Do not use `eval`, dynamic `Function`, or unsafe DOM injection.
- Prefer standard platform APIs and explicit feature/runtime compatibility over non-standard behavior.
- Write comments/JSDoc for contracts and intent, not restatements of syntax.

## Verification

- Run the repository formatter, ESLint (or approved linter), tests, and target-specific build/type checks.
- Test asynchronous failure paths, cleanup/cancellation behavior, serialization boundaries, and supported runtimes.

## Sources

- [MDN JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)
- [MDN JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html)
