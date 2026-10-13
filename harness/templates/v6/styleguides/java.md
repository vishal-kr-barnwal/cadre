# Java Styleguide

Apply `general.md` first. Use the repository's formatter if configured; otherwise propose `google-java-format` and Google Java Style.

## Idiomatic defaults

- Encode source as UTF-8. Keep one top-level type per ordinary source file and match its file name.
- Use `UpperCamelCase` for types, `lowerCamelCase` for methods/fields/locals, and `UPPER_SNAKE_CASE` for constants.
- Use lowercase package names organized by stable domain ownership.
- Do not use wildcard imports. Remove unused imports and keep deterministic ordering.
- Prefer immutable state, constructor-injected required dependencies, and narrow visibility.
- Program to focused abstractions where multiple implementations or test seams are real; avoid interface-per-class ceremony.
- Validate public-boundary inputs and model invalid states explicitly.
- Do not swallow caught exceptions. Preserve causes and add actionable domain context.
- Use try-with-resources for `AutoCloseable` values.
- Use `@Override` whenever legal and document public APIs where intent/contracts are not obvious.
- Avoid finalizers and hidden global mutable state.

## Verification

- Run the approved formatter, compiler warnings/static analysis, and the repository's unit/integration tests.
- Test public behavior, exceptions, boundary values, concurrency, and resource cleanup where relevant.

## Sources

- [Google Java Style Guide](https://google.github.io/styleguide/javaguide.html)
- [Java language documentation](https://docs.oracle.com/en/java/)
