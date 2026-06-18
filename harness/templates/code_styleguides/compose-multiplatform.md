# Compose Multiplatform Style Guide Summary

This document summarizes key rules and best practices for building idiomatic, high-performance, and maintainable Compose Multiplatform (CMP) applications across Android, iOS, Desktop, and Web.

## 1. Formatting and Tooling
- **ktlint & detekt:** Enforce via Gradle plugins. All code must pass linting before merging.
- **Compose Rules (detekt-compose):** Use Twitter/Facebook/Custom Compose lint rules to catch common performance pitfalls (e.g., "MutableState in ViewModel should be private").
- **Trailing lambdas:** Always use trailing lambda syntax for the content parameter of a Composable.
- **Naming:**
  - **Composables:** `UpperCamelCase` (e.g., `PrimaryButton`). Names must be nouns.
  - **Composable factories:** `UpperCamelCase` if they return `Unit`.
  - **Modifier extensions:** `lowerCamelCase` (e.g., `Modifier.customPadding()`).

## 2. Architecture (UDF + Component-based)
- **Unidirectional Data Flow (UDF):** State flows down (State); Events flow up (Callbacks).
- **State over Events:** Prefer modeling screen state as a single `UiState` data class rather than multiple independent flows.
- **ViewModel (Multiplatform):** Use `androidx.lifecycle.ViewModel` (now multiplatform-ready) or a shared `CmpViewModel` to hold logic.
- **Component-based UI:** Break UI into small, reusable, and stateless Composables. A Composable over 50 lines is a candidate for decomposition.
- **Stateless vs Stateful:**
  - **Stateless:** Accepts state as parameters and emits events via callbacks. High reusability.
  - **Stateful:** Manages its own state or interacts with a ViewModel. Use sparingly at the screen/feature root.

## 3. Composable Design
- **Modifier as first optional parameter:** Every UI Composable should accept a `modifier: Modifier = Modifier` as its first optional parameter.
  ```kotlin
  @Composable
  fun MyComponent(
      text: String,
      modifier: Modifier = Modifier,
      onClicked: () -> Unit
  ) { ... }
  ```
- **Explicit parameter ordering:** Required parameters first, then `modifier`, then optional parameters, then the trailing lambda (if any).
- **Stability:** Ensure parameters are stable or immutable. Use `@Stable` or `@Immutable` on domain models if Compose cannot infer it. Avoid passing `List` directly; use `ImmutableList` (from kotlinx-collections-immutable) or a wrapper.
- **Slot API:** Use the "Slot" pattern (accepting `@Composable () -> Unit` lambdas) to increase flexibility and avoid deep parameter propogation.

## 4. State Management
- **`remember` & `mutableStateOf`:** Use for local, UI-only state. Always use `rememberSaveable` for state that must survive configuration changes (Android).
- **`StateFlow` to `State`:** Collect flows using `collectAsStateWithLifecycle()` (requires `lifecycle-runtime-compose` multiplatform) to ensure lifecycle-aware updates.
- **State Hoisting:** Lift state up to make Composables stateless. The caller should control the state.
- **Don't pass `MutableState`:** Pass the raw value and a callback function, never a `MutableState<T>` object, to child Composables.
- **Side Effects:** Use `LaunchedEffect`, `SideEffect`, and `DisposableEffect` correctly. Never perform side effects directly in the Composable's body.

## 5. Multiplatform Patterns (Expect/Actual)
- **Platform-specific UI:** Use `expect`/`actual` for platform-native components (e.g., `MapView`, `WebView`).
- **CompositionLocal:** Use `CompositionLocal` for cross-cutting concerns like Themes, Localizations, or Platform-specific configurations.
- **Platform Check:** Use `LocalWindowInfo.current` or custom platform-specific `CompositionLocal` instead of hardcoded platform checks inside generic UI code.
- **Shared Resources:** Use `Compose Multiplatform Resources` (lib) for shared strings, fonts, and images.

## 6. Layout and Modifiers
- **Modifier Order Matters:** Modifiers are applied sequentially. `Modifier.padding(8.dp).clickable { }` is different from `Modifier.clickable { }.padding(8.dp)`.
- **Prefer `weight` in Rows/Columns:** Use `Modifier.weight()` for flexible layouts rather than hardcoded sizes.
- **Avoid `fillMaxSize()` in nested scrolling:** Use `wrapContentHeight()` or specific sizes to avoid infinite height constraints in `LazyColumn`.
- **Custom Modifiers:** Extract repeated modifier chains into extension functions for readability.

## 7. Navigation
- **Compose Navigation Multiplatform:** Use the official `androidx.navigation:navigation-compose` (now Multiplatform).
- **Type-safe Navigation:** Use Kotlin Serialization with the Navigation component for type-safe arguments.
- **Single NavHost:** Keep the `NavHost` at the top level of each platform's entry point or in a shared `App()` Composable.

## 8. Performance
- **Minimize Recomposition:** 
  - Pass only necessary data.
  - Use `derivedStateOf` for state that depends on other state to avoid redundant recompositions.
  - Use `remember` with keys to cache expensive calculations.
- **Lazy Collections:** Always use `LazyColumn`, `LazyRow`, and `LazyVerticalGrid` for large or dynamic lists. Use `key` in `items()` for stable identification.
- **Avoid heavy computation in `@Composable`:** Move business logic and heavy mapping to the ViewModel or use `remember`.
- **Phase isolation:** Use `Modifier.graphicsLayer` or lambda-based modifiers (e.g., `Modifier.offset { ... }`) for frequent updates like animations to skip the "recomposition" and "layout" phases.

## 9. Testing
- **Compose UI Test:** Use `createComposeRule()` (Android) and `runComposeUiTest` (Multiplatform) to verify UI behavior.
- **Semantics:** Use `Modifier.semantics { contentDescription = "..." }` to make UI testable and accessible.
- **Screenshot Testing:** Use libraries like Roborazzi or Paparazzi for cross-platform visual regression testing.

## 10. Desktop & iOS Specifics
- **Desktop:** Handle window resizing, keyboard shortcuts, and mouse hover states using `onPointerEvent`.
- **iOS:** Ensure `UIKitView` is used correctly for native interop. Respect safe area insets via `WindowInsets.safeDrawing`.
- **Web (Wasm/JS):** Be mindful of heavy computations as Wasm/JS performance characteristics differ from JVM/Native.

*Sources: [Compose Multiplatform Docs](https://www.jetbrains.com/lp/compose-multiplatform/) · [Jetpack Compose Best Practices](https://developer.android.com/develop/ui/compose/performance) · [Kotlin Multiplatform Guidelines](https://kotlinlang.org/docs/multiplatform.html)*
