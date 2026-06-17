# Effective Dart Style Guide Summary

This document summarizes key rules and best practices from the official "Effective Dart" guide for writing idiomatic, performant, and maintainable Dart code.

## 1. Formatting
- **`dart format`:** All Dart code **must** be formatted with `dart format` (formerly `dartfmt`). Non-negotiable.
- **Indentation:** 2 spaces. No tabs.
- **Line Length:** 80 characters maximum.
- **Trailing commas:** Add a trailing comma after the last item in multi-line argument/parameter lists to keep `dart format` from collapsing them to one line.

## 2. Naming
- **`UpperCamelCase`:** For classes, enums, typedefs, and type parameters.
- **`lowerCamelCase`:** For variables, parameters, named parameters, functions, methods, and constant variables.
- **`lowercase_with_underscores`:** For libraries, packages, directories, and source files.
- **`_lowerCamelCase`:** For private identifiers (prefix with `_`).
- **Acronyms:** Capitalize only the first letter — `Http`, `Url`, `Json`, not `HTTP`, `URL`, `JSON` (exception: well-known two-letter acronyms like `IO`).
- **Boolean naming:** Name boolean variables and getters as affirmative phrases: `isEmpty`, `hasChildren`, `canClose`. Avoid `isNotEmpty` as a variable name.

## 3. Types
- **Prefer type inference:** Let Dart infer types for local variables (`var x = ...`). Annotate when the type is not obvious or when required for API clarity.
- **`dynamic`:** Avoid `dynamic`. Use it only when genuinely dynamic behavior is needed. Prefer `Object?` for unknown values.
- **`Object` vs `dynamic`:** Prefer `Object?` for a type that accepts any value — it still participates in type checking; `dynamic` opts out entirely.
- **`var` vs explicit type:** Use `var` for local variables. Use explicit types for top-level and class-level declarations.
- **Nullable vs non-nullable:** With null safety, prefer non-nullable types. Only add `?` when `null` is a genuinely valid value.
- **Late variables:** Use `late` only when initialization is deferred but guaranteed before use. Prefer passing values in constructors.

## 4. Functions and Methods
- **Named parameters:** Prefer named parameters for functions with more than two parameters or when parameter meaning is not obvious from the call site.
- **Required named parameters:** Mark mandatory named parameters `required`. Do not simulate with assertions on nullable params.
- **Arrow functions:** Use `=>` for simple single-expression functions and getters.
- **`async`/`await`:** Prefer `async`/`await` over raw `Future` chaining (`.then`, `.catchError`). Never mix them in the same function body.
- **Avoid `async` without `await`:** Do not mark a function `async` if it does not contain `await`.
- **`Stream`:** Return `Stream` for multiple asynchronous values. Use `async*` with `yield` to create streams.

## 5. Variables and Control Flow
- **`final` by default:** Prefer `final` for variables that are not reassigned. Use `const` for compile-time constants.
- **`const` constructors:** Define `const` constructors for immutable classes. Use `const` at call sites for constant objects.
- **`??` and `?.`:** Use the null-aware operators instead of explicit null checks. Use `??=` for lazy initialization.
- **Cascade (`..`):** Use cascades to perform a sequence of operations on the same object. Do not cascade when the receiver is a temporary.
- **`is` over `as`:** Prefer `if (obj is Foo)` over `(obj as Foo)` to avoid runtime cast errors.
- **Avoid `late final` + nullable:** Pick one. Either the variable is `late` and always initialized, or it is nullable.

## 6. Collections
- **Collection literals:** Use `[]`, `{}`, `<K,V>{}` over `List()`, `Set()`, `Map()` constructors.
- **Collection-if and collection-for:** Use these inside literals instead of building collections with `add`/`addAll` in a loop.
- **Spreads (`...`):** Use the spread operator to combine collections. Prefer over `addAll`.
- **`where`, `map`, `toList()`:** Chain iterable methods for transformations. Call `toList()` at the end to materialize only once.
- **Avoid `length` for emptiness:** Use `isEmpty`/`isNotEmpty` instead of `list.length == 0`.

## 7. Classes and Constructors
- **Initializer lists:** Initialize fields in the initializer list, not the constructor body.
- **Shorthand field initialization:** Use `this.field` constructor parameters to initialize fields directly.
- **Factory constructors:** Use `factory` for constructors that return a cached or subtype instance.
- **`@immutable`:** Annotate classes with `@immutable` when all fields are `final`.
- **No public `late` fields:** Avoid public `late` fields. Prefer constructor initialization.
- **Extension methods:** Use extensions to add methods to existing types without subclassing.

## 8. Error Handling
- **Exceptions for programming errors:** Throw `Error` subtypes (e.g., `ArgumentError`, `StateError`) for programming mistakes.
- **Exceptions for runtime failures:** Throw `Exception` subtypes for runtime failures the caller can recover from.
- **Avoid catching `Error`:** Catch specific exception types. Catching `Object` or `Error` is a sign of poor error modeling.
- **`on` before `catch`:** Use `on ExceptionType catch (e)` to restrict what you catch. Never use a bare `catch` without `on`.

## 9. Documentation
- **`///` doc comments:** Use `///` (not `/** */`) for documentation on all public APIs.
- **Single-sentence summary:** Start every doc comment with a one-sentence summary that ends with a period.
- **Markdown:** Doc comments support Markdown. Use code blocks (`` ` ``) for inline code references.
- **`@param`, `@returns`:** Do not use these tags — Dart doc tools read the prose. Write parameter descriptions inline.
- **Prose over tags:** Describe behavior, edge cases, and usage in full sentences.

*Source: [Effective Dart](https://dart.dev/effective-dart)*
