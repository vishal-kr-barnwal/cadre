# Kotlin Styleguide

Apply `general.md` first. Use the official Kotlin coding conventions and the repository's configured formatter/linter.

## Idiomatic defaults

- Use four spaces, no tabs, Kotlin brace style, and omit semicolons.
- Use lowercase package names, `UpperCamelCase` for classes/objects, and `lowerCamelCase` for functions/properties/locals.
- Name files for their primary declaration or cohesive purpose; avoid catch-all `Util` files.
- Prefer `val` and immutable collection interfaces. Use mutation only when it makes ownership and behavior clearer.
- Use nullable types deliberately, safe calls, Elvis operators, and early validation; avoid `!!` except for proven invariants with explanation.
- Prefer expression-oriented constructs and exhaustive `when` expressions when they improve clarity.
- Use data classes for data semantics, sealed hierarchies for closed variants, and extension functions near their domain/consumer.
- Keep visibility as narrow as practical. Specify public API return/property types and document public library APIs with KDoc.
- Use structured concurrency; make coroutine scope, dispatcher choice, cancellation, and exception ownership explicit.
- Avoid translating Java patterns mechanically when Kotlin provides a clearer language construct.

## Verification

- Run the approved formatter/linter, compiler with project warnings policy, and all relevant tests.
- Test coroutine cancellation/error paths and Java interoperability boundaries when applicable.

## Sources

- [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html)
- [Kotlin code-quality tools](https://kotlinlang.org/docs/jvm-code-analysis.html)
