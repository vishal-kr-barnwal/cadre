# Kotlin Coding Conventions Style Guide Summary

This document summarizes key rules and best practices from the official Kotlin Coding Conventions and JetBrains style guide for writing idiomatic, concise, and safe Kotlin code.

## 1. Formatting
- **ktlint / detekt:** Format with `ktlint` and lint with `detekt`. Enforce both in CI.
- **Indentation:** 4 spaces. No tabs. Continuation lines: 4 spaces (not 8).
- **Line Length:** 120 characters maximum (Kotlin convention; some projects use 100).
- **Trailing lambdas:** When the last parameter is a lambda, move it outside the parentheses. Omit the parentheses entirely if the lambda is the only parameter.

## 2. Naming
- **`UpperCamelCase`:** For classes, objects, interfaces, and enum entries.
- **`lowerCamelCase`:** For functions, properties, local variables, and parameters.
- **`SCREAMING_SNAKE_CASE`:** For `const val` top-level and companion object constants only.
- **`_` prefix:** Do not use. Kotlin backing properties use `_name` as a convention for private backing fields exposed via a public property — this is the single accepted use.
- **Acronyms:** Use `UpperCamelCase` even for acronyms: `XmlParser`, `HttpClient`, not `XMLParser`.
- **Boolean properties:** Name as `isEnabled`, `hasError`, `canClose`. Prefix with `is`, `has`, or `can`.
- **Test functions:** Use backtick names for test readability: `` `should throw when user is null`() ``.

## 3. Null Safety
- **Non-nullable by default:** Prefer non-nullable types. Add `?` only when `null` is a genuinely valid value.
- **Avoid `!!`:** The `!!` operator is a code smell. It bypasses null safety and throws `NullPointerException`. Use `?.`, `?:`, `let`, `also`, or explicit null checks instead.
- **`?.let { }`:** Use for null-conditional execution. Prefer `if (x != null)` when the block is long and `x` is used multiple times (smart cast).
- **Elvis operator `?:`:** Use for default values: `val name = user?.name ?: "Anonymous"`.
- **`requireNotNull` / `checkNotNull`:** Use to assert non-nullability at runtime with a clear message: `requireNotNull(user) { "User must not be null" }`.

## 4. Classes and Objects
- **`data class`:** Use for classes that hold data. They get `equals`, `hashCode`, `toString`, `copy`, and `componentN` for free.
- **`sealed class`:** Use for closed type hierarchies (discriminated unions). Prefer `sealed class` over `enum class` when variants carry different data.
- **`object`:** Use for singletons and companion objects. Do not use a class with a private constructor + static `getInstance()`.
- **`companion object`:** Use for factory methods and constants logically associated with a class. Name the companion only if it will be referenced by name.
- **`val` over `var`:** Prefer immutable `val` properties. Use `var` only when mutation is necessary.
- **`init` blocks:** Minimize logic in `init` blocks. Prefer constructor parameter defaults and `lazy` properties.
- **`lazy`:** Use `by lazy { }` for properties that are expensive to compute and not always needed.

## 5. Functions
- **Expression bodies:** Use `= expression` for single-expression functions. Omit braces and `return`.
- **Default parameter values:** Use default values instead of overloaded functions.
- **Named arguments:** Use named arguments when calling functions with many parameters or when the parameter type is a primitive and meaning is unclear.
- **Extension functions:** Use extension functions to add behavior to existing types without subclassing. Place extensions in a file named `TypeExtensions.kt`.
- **Scope functions (`let`, `run`, `with`, `apply`, `also`):**
  - `apply`: Configure an object — use when returning the object. (`builder.apply { ... }`)
  - `also`: Perform side effects — use when returning the object. (`list.also { log(it) }`)
  - `let`: Transform a value, especially with nullability. (`str?.let { process(it) }`)
  - `run`/`with`: Group a block of operations on an object. Prefer `run` for nullable receivers, `with` for non-null.
  - **Do not nest scope functions more than 2 levels deep.**
- **`operator fun`:** Only implement operator overloads when the semantics are universally clear (e.g., `+` for numeric types, `get`/`set` for collections).

## 6. Collections
- **Immutable collections:** Prefer `listOf`, `mapOf`, `setOf`. Use `mutableListOf` etc. only when mutation is needed.
- **`Sequence` for lazy pipelines:** Use `asSequence()` for long transformation chains on large collections to avoid creating intermediate lists.
- **Avoid `null` in collections:** Prefer `emptyList()` over `null` for absent collections. Use `filterNotNull()` to clean mixed lists.
- **`associate`, `groupBy`, `partition`:** Use the stdlib collection transforms instead of manual loops.
- **Destructuring:** Use destructuring declarations in `for` loops and `map` operations: `for ((key, value) in map)`.

## 7. Coroutines
- **`suspend` functions:** Mark any function that calls another `suspend` function or performs async I/O as `suspend`. Do not block inside `suspend` functions — use `withContext(Dispatchers.IO)`.
- **Structured concurrency:** Always launch coroutines in a `CoroutineScope`. Never use `GlobalScope` in application code.
- **`Dispatchers.Main` / `.IO` / `.Default`:** Use the correct dispatcher — `Main` for UI, `IO` for blocking I/O, `Default` for CPU work.
- **`Flow`:** Use `Flow<T>` for streams of values. Use `StateFlow`/`SharedFlow` for hot streams. Call `.collect {}` in a lifecycle-aware scope.
- **Error handling:** Use `try/catch` inside coroutines. Use `CoroutineExceptionHandler` for unhandled exceptions in `launch`. `async`/`await` propagates exceptions at the `await` site.
- **`viewModelScope` / `lifecycleScope`:** Use these scopes in Android (see Android guide) to tie coroutine lifetime to the component.

## 8. Error Handling
- **Exceptions for exceptional cases:** Do not use exceptions for normal control flow. Return `Result<T>`, `sealed class`, or nullable values for expected failure paths.
- **`runCatching`:** Use `runCatching { }` for concise try-catch with `Result<T>` return.
- **Avoid catching `Throwable`:** Catch specific exception types. Catching `Throwable` also catches `Error` (e.g., `OutOfMemoryError`).

## 9. Documentation
- **KDoc (`/** */`):** Use KDoc for all public API documentation.
- **`@param`, `@return`, `@throws`:** Include these tags for public functions with non-obvious parameters or return values.
- **`@since`:** Mark API additions with `@since <version>`.
- **Avoid redundant comments:** Do not restate the function name in the doc. Add information about behavior, edge cases, or constraints.

*Source: [Kotlin Coding Conventions](https://kotlinlang.org/docs/coding-conventions.html)*
