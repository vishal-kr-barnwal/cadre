# Dart Styleguide

Apply `general.md` first and use Effective Dart as the language baseline.

## Idiomatic defaults

- Format with `dart format`; do not hand-align code against formatter output.
- Use `UpperCamelCase` for types/extensions, `lowerCamelCase` for other identifiers, and `lowercase_with_underscores` for files/directories/packages.
- Order `dart:` imports before `package:` imports and relative imports; keep exports in their own section.
- Prefer concise, readable language features without compressing multiple responsibilities together.
- Use sound null safety; model absence explicitly and avoid `!` unless an invariant is proven.
- Choose one consistent local-variable policy for `final`/`var`; favor immutable fields and top-level values.
- Avoid storing derivable state and expose one source of truth.
- Use `async`/`await` deliberately; return/await futures, handle stream subscriptions, and propagate useful errors.
- Design public APIs for clear call sites, consistent terminology, and minimal surprising behavior.
- Document public APIs with `///` comments and keep implementation comments focused on intent.

## Verification

- Run `dart format --output=none --set-exit-if-changed .`, `dart analyze`, and `dart test` or project equivalents.
- Test null/error/async paths and public package APIs.

## Sources

- [Effective Dart](https://dart.dev/effective-dart)
- [Effective Dart: Usage](https://dart.dev/effective-dart/usage)
- [Effective Dart: Design](https://dart.dev/effective-dart/design)
