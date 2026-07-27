# Flutter Styleguide

Apply `general.md` and `dart.md` first. Adapt architecture recommendations to the approved app size and existing brownfield structure.

## Flutter defaults

- Separate UI and data responsibilities. Keep business/data logic out of widget build methods.
- Give views/widgets presentation responsibility; place UI state/transformation in an approved state-holder or ViewModel pattern.
- Isolate external data access behind repositories/services with clear interfaces and dependency injection.
- Use unidirectional data flow and immutable models where practical.
- Keep widgets small and composable; use `const` constructors whenever inputs are compile-time constants.
- Keep transient UI state local and lift/share it only when multiple consumers need the same source of truth.
- Use stable keys where widget identity matters; do not use keys indiscriminately.
- Model loading, empty, error, offline, and success states explicitly.
- Build responsive/adaptive layouts from constraints and platform behavior, not device-name checks.
- Include semantics, keyboard/focus behavior, text scaling, and contrast in Definition of Done.

## Verification

- Run `dart format`, `flutter analyze`, unit tests for services/repositories/state holders, widget tests for views, and targeted integration tests.
- Test lifecycle/disposal, navigation, dependency injection, platform differences, golden output when appropriate, and accessibility.

## Sources

- [Flutter architecture recommendations](https://docs.flutter.dev/app-architecture/recommendations)
- [Flutter app architecture guide](https://docs.flutter.dev/app-architecture/guide)
- [Flutter testing](https://docs.flutter.dev/testing/overview)
