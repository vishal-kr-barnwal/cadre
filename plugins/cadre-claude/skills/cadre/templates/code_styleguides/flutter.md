# Effective Flutter Style Guide Summary

This document summarizes key rules and best practices for writing idiomatic Flutter code, building on Effective Dart with Flutter-specific widget, state, and performance conventions.

## 1. Formatting and Tooling
- **`dart format`:** All Flutter code must be formatted with `dart format`. Run via `flutter format .`.
- **`flutter analyze`:** Treat all analyzer warnings as errors. Enforce in CI.
- **Trailing commas:** Always add trailing commas after the last argument in multi-line widget trees — this keeps `dart format` from collapsing widget hierarchies to one line.
- **Import ordering:** `dart:` → `package:flutter/` → other `package:` → relative imports.

## 2. Widget Design
- **`StatelessWidget` by default:** Reach for `StatelessWidget` first. Only use `StatefulWidget` when local mutable state is genuinely needed.
- **Small, composable widgets:** Prefer extracting reusable pieces into their own widgets over large `build` methods. A build method over ~50 lines is a sign it should be split.
- **`const` constructors everywhere:** Define `const` constructors on all widgets. Use `const` at call sites to skip unnecessary rebuilds.
- **`Key` usage:** Pass `Key` to the parent `Widget` constructor, not to child widgets inside `build`. Use `ValueKey`, `ObjectKey`, or `UniqueKey` — not `GlobalKey` unless absolutely required (e.g., form validation, imperative scroll).
- **`Widget` over helper methods:** Extract sub-trees into separate `Widget` classes rather than private `_buildXxx()` methods. Widget classes participate in the element tree and optimize rebuilds; helper methods do not.

## 3. State Management
- **Lift state up:** Keep state as low in the tree as needed and no lower. Share state by lifting to a common ancestor.
- **`setState` scope:** Call `setState` with the minimum code needed. Only pass the mutation, not the full rebuild computation.
- **Avoid storing `BuildContext` across async gaps:** After an `await`, check `mounted` before using `context`. Never store `context` in a field for later use.
- **Inherited widgets / providers:** Use `InheritedWidget`, `Provider`, `Riverpod`, or `Bloc` for state that many widgets need. Do not prop-drill through 3+ layers.
- **`initState` / `dispose`:** Always pair resource acquisition (`initState`, `addListener`) with release (`dispose`, `removeListener`). Never call `setState` in `initState`.
- **`didChangeDependencies`:** Use for operations that depend on `InheritedWidget` values, not `initState`.

## 4. Performance
- **`const` widgets:** Mark widgets and their constructors `const` whenever possible — this is the single highest-ROI optimization in Flutter.
- **`ListView.builder`:** Use `ListView.builder` (or `GridView.builder`, `CustomScrollView`) for lists of unknown or large length. Never use `ListView(children: items.map(...).toList())` for long lists.
- **`RepaintBoundary`:** Wrap expensive, independently-animating subtrees in `RepaintBoundary` to isolate repaints.
- **Avoid rebuilding with `AnimatedBuilder`:** Pass only the widget that changes as the `child` parameter — it is cached and not rebuilt on animation ticks.
- **`ImageCache` and `precacheImage`:** Precache images likely to be shown soon. Prefer `AssetImage`/`NetworkImage` with proper caching over `Image.memory` for large images.
- **Avoid work in `build`:** Never compute values, parse data, or make network calls inside `build()`. Compute in `initState`, `didUpdateWidget`, or a state management layer.

## 5. Layout
- **Prefer `Column`/`Row` over `Stack` where possible:** `Stack` is for overlay scenarios; prefer linear layouts for sequential content.
- **`Expanded` and `Flexible`:** Use `Expanded` to fill remaining space. Use `Flexible` when you want to allow shrinking. Never use `SizedBox.expand()` inside `Column`/`Row` — use `Expanded`.
- **`SizedBox` for spacing:** Prefer `SizedBox(height: 8)` over `Padding(padding: EdgeInsets.only(top: 8))` for simple fixed spacing.
- **`MediaQuery` and `LayoutBuilder`:** Use `LayoutBuilder` for widget-local responsive constraints. Use `MediaQuery.of(context)` sparingly — changes trigger full rebuilds.
- **Avoid unbounded height/width:** `Column` inside a `ListView` without a bounded height will throw. Use `shrinkWrap: true` or wrap in `SizedBox` with an explicit dimension when nesting scrollables.

## 6. Navigation and Routing
- **Named routes or `go_router`:** Prefer declarative routing (`go_router`, `auto_route`) over imperative `Navigator.push` for deep linking and complex flows.
- **`WillPopScope` / `PopScope`:** Handle back navigation explicitly when there is unsaved state or a multi-step flow.
- **Pass data via constructor, not `arguments`:** Prefer typed constructor injection over `ModalRoute.of(context)!.settings.arguments`. Use route parameters with `go_router`.

## 7. Theming and Styling
- **Use `Theme.of(context)`:** Never hardcode colors or text styles. Always derive from the active `ThemeData`.
- **`TextTheme`:** Use `Theme.of(context).textTheme.bodyLarge` etc. — do not define ad-hoc `TextStyle` objects everywhere.
- **`ColorScheme`:** Use Material 3's `ColorScheme` roles (`primary`, `surface`, `onPrimary`) rather than direct `Color` values.
- **`ThemeExtension`:** Define custom theme data in a `ThemeExtension<T>` instead of global constants.

## 8. Testing
- **Widget tests over unit tests for UI:** Test widget behavior with `flutter_test`'s `WidgetTester`. Avoid screenshot testing as the primary regression tool.
- **`find.byType`, `find.byKey`:** Prefer `find.byKey(ValueKey('submit'))` for interactive elements. Use `find.byType` for presence checks.
- **`pumpAndSettle`:** Use after triggering async operations. Use `pump(Duration)` for animations you control explicitly.
- **Golden tests:** Use sparingly — they are brittle across platforms. Gate on a single reference platform in CI.

## 9. Naming and File Structure
- **One widget per file:** Each top-level `Widget` subclass lives in its own file.
- **File names match class names:** `UserProfileCard` → `user_profile_card.dart`.
- **Feature-first folder structure:** Group by feature (`lib/features/auth/`, `lib/features/home/`), not by type (`lib/widgets/`, `lib/models/`).
- **`_` prefix for private widgets:** Private helper widgets within a file are prefixed with `_`.

*Sources: [Flutter Docs](https://docs.flutter.dev) · [Effective Dart](https://dart.dev/effective-dart) · [Flutter Performance Best Practices](https://docs.flutter.dev/perf/best-practices)*
