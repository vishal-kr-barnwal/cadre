# Effective SwiftUI Style Guide Summary

This document summarizes key rules and best practices for writing idiomatic SwiftUI code, building on Swift API Design Guidelines with SwiftUI-specific view, state, and composition conventions.

## 1. Formatting and Tooling
- **SwiftFormat:** Format all SwiftUI code with `swiftformat`. Add `.swiftformat` config to the repo.
- **SwiftLint:** Enforce with `.swiftlint.yml`. Treat all errors as CI failures.
- **Trailing closures and `ViewBuilder`:** Use trailing closure syntax for all `ViewBuilder` content parameters — this is the SwiftUI idiom.
- **`// MARK:` sections:** Organize view files with `// MARK: - Body`, `// MARK: - Subviews`, `// MARK: - View Model` sections for long files.

## 2. View Design
- **Small, composable views:** Decompose complex `body` implementations into private child views or separate `View` structs. A `body` over ~30 lines should be split.
- **`some View` return type:** Always use `some View` as the return type of `body`. Do not erase to `AnyView` without a concrete reason.
- **`AnyView` avoidance:** `AnyView` disables SwiftUI's diff engine. Use conditional views, `Group`, or `@ViewBuilder` functions instead. If `AnyView` is unavoidable, contain it to a single call site.
- **`@ViewBuilder` functions:** Extract reusable sub-trees into `@ViewBuilder` private methods or standalone `View` structs. Prefer structs for views reused across files.
- **Previews:** Every view **must** have a `#Preview` (or `PreviewProvider`). Include multiple preview variants: light/dark, different data states (empty, loaded, error), and different device sizes.

## 3. State Management
- **Choose the right property wrapper:**
  - `@State`: Local, view-owned, value-type state. Keep it minimal and view-specific.
  - `@Binding`: Pass mutable state down from a parent. Never derive a `@Binding` from a computed property.
  - `@StateObject`: Own a reference-type observable object for the lifetime of this view subtree.
  - `@ObservedObject`: Receive an observable object from a parent. The parent owns its lifetime.
  - `@EnvironmentObject`: Inject a shared object through the view hierarchy. Use for app-wide state (user session, theme, router).
  - `@Environment`: Read system values (`\.colorScheme`, `\.dismiss`, `\.locale`) and custom environment keys.
- **Observation (`@Observable`):** In iOS 17+, prefer `@Observable` macro over `ObservableObject`/`@Published` — it is more efficient (only the accessed properties trigger redraws).
- **Minimize `@State`:** Lift state up to the smallest common ancestor that needs it. Do not put everything in the root view.
- **No logic in `body`:** Move business logic, data transformations, and side effects into the ViewModel or a computed property. `body` should be pure view construction.

## 4. ViewModel Pattern
- **`@Observable` / `ObservableObject` ViewModel:** Each screen has a ViewModel that is `@Observable` (iOS 17+) or `ObservableObject`. The view is a thin rendering layer.
- **`@StateObject` for injection:** Create the ViewModel in the view that owns it with `@StateObject var vm = MyViewModel()`. Pass to children via `@ObservedObject` or `@EnvironmentObject`.
- **`@MainActor` on ViewModels:** Annotate the ViewModel class with `@MainActor` to ensure all published property updates occur on the main thread.
- **Async tasks via `Task`:** Trigger async operations from `.task { }` modifier (cancelled automatically on view disappearance) or `Task { }` in response to user actions.
- **`.onAppear` vs `.task`:** Prefer `.task { }` for async work (auto-cancels). Use `.onAppear` only for synchronous side effects.

## 5. Layout and Composition
- **Use modifiers in the right order:** Modifier order matters in SwiftUI. Background and border go before padding; padding before frame.
  ```swift
  Text("Hello")
      .background(Color.blue)  // applies to text bounds
      .padding()               // then pads
      .border(Color.red)       // border around padded area
  ```
- **`Group` for applying modifiers to multiple views:** Use `Group { }` to apply the same modifier to several views without a container.
- **`ViewThatFits`:** Use for adaptive layouts that switch between compact and expanded presentations.
- **`LazyVStack` / `LazyHStack` / `LazyVGrid`:** Use lazy containers for long or dynamically-loaded lists. Use eager `VStack`/`HStack` only for short, fixed-count content.
- **`GeometryReader` sparingly:** `GeometryReader` takes all available space and can break layouts. Prefer `containerRelativeFrame` (iOS 17+), `frame(maxWidth: .infinity)`, or `Layout` protocol instead.
- **`Spacer()` vs fixed spacing:** Use `Spacer()` to push views apart in a stack. Use `.padding()` or `.frame(height: 8)` for fixed spacing.

## 6. Navigation
- **`NavigationStack`:** Use `NavigationStack` (iOS 16+) over `NavigationView`. Use path-based navigation for programmatic control: `NavigationStack(path: $path)`.
- **`navigationDestination(for:)`:** Register destinations with `.navigationDestination(for: MyType.self)` and drive navigation by appending to the path.
- **`NavigationPath`:** Use for heterogeneous navigation stacks. Use typed `[MyRoute]` arrays when all destinations are the same type.
- **`.sheet`, `.fullScreenCover`, `.popover`:** Control presentation with `@State var isPresented = false` and `item:`-based variants for associated data.
- **Avoid `NavigationLink(isActive:)`:** Deprecated in iOS 16+. Use path-based navigation instead.

## 7. Animation
- **`withAnimation { }`:** Wrap state changes that should animate in `withAnimation`. Prefer this over `.animation(_:value:)` on views.
- **`.animation(_:value:)`:** Use on a view when only that view should animate in response to a specific state value changing.
- **Explicit animations over implicit:** Prefer `withAnimation(.spring())` triggered by state changes over `.animation(.spring())` on views — explicit animations are more predictable.
- **`matchedGeometryEffect`:** Use for hero animations between views. Always pair with a shared `@Namespace`.
- **`Animatable` and `AnimatableModifier`:** Implement for custom animations on non-standard properties.

## 8. Performance
- **`Equatable` views:** Make views `Equatable` and use `.equatable()` to skip redraws when input is unchanged.
- **Stable identities in `ForEach`:** Pass stable `Identifiable` models or explicit `id:` parameters. Avoid `ForEach(items, id: \.self)` for complex objects — use a proper `id` property.
- **Avoid heavy computation in `body`:** Any expensive computation in `body` runs on every redraw. Move to a stored property or the ViewModel.
- **`@Observable` over `ObservableObject`:** `@Observable` tracks property access precisely — only views that read a changed property redraw. `@Published` triggers redraws for all observers of any property change.
- **`task(id:)`:** Use `task(id: someValue) { }` to restart async work when a value changes, instead of `onChange(of:) { Task { ... } }`.

## 9. Accessibility
- **`.accessibilityLabel`:** Every interactive element and image must have an accessibility label.
- **`.accessibilityHint`:** Add hints for non-obvious actions: `.accessibilityHint("Double-tap to expand details")`.
- **`.accessibilityElement(children: .combine)`:** Group visually related elements into a single accessible element.
- **Dynamic Type:** Use semantic text styles (`.font(.headline)`) not fixed sizes. Test with the largest and smallest Dynamic Type sizes.
- **Color contrast:** Do not convey information with color alone. Use labels, icons, or patterns as secondary indicators.

## 10. File and Code Organization
- **One view per file:** Each top-level `View` struct lives in its own file.
- **File naming:** File name matches the type name: `UserProfileView.swift`.
- **Extension for subviews:** Place private subviews in an `extension` at the bottom of the same file:
  ```swift
  // MARK: - Subviews
  private extension UserProfileView {
      var headerSection: some View { ... }
  }
  ```
- **Feature folder structure:** `Features/Auth/`, `Features/Home/` — group screens, ViewModels, and models by feature.
- **Shared components:** Place reusable design-system components in `Components/` or a dedicated Swift package.

*Sources: [SwiftUI Documentation](https://developer.apple.com/documentation/swiftui) · [Swift API Design Guidelines](https://swift.org/documentation/api-design-guidelines/) · [Observation framework](https://developer.apple.com/documentation/observation)*
