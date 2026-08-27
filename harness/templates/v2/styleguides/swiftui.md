# SwiftUI Styleguide

Apply `general.md` and `swift.md` first.

## SwiftUI defaults

- Keep `body` declarative, deterministic, and free of side effects.
- Compose small views around cohesive UI responsibilities; extract subviews when it clarifies data flow or identity.
- Maintain one source of truth for each value. Use local `@State` for view-owned transient state and `@Binding` for borrowed mutable state.
- Use Observation/observable models for reference model state and inject shared dependencies through explicit initializers or the environment as approved.
- Do not copy derived/model data into local state. Derive presentation values from source state.
- Trigger asynchronous lifecycle work with `.task` and respect cancellation; trigger user work from actions.
- Keep domain/business logic outside views and model transitions explicitly.
- Use stable identity in `ForEach` and navigation; do not use indexes when domain identity can change.
- Prefer semantic controls and modifiers over gesture-only replicas; support accessibility labels, Dynamic Type, focus, and platform conventions.
- Keep previews/examples deterministic and provide representative states when the project uses previews.

## Verification

- Test model/view-model behavior independently and cover critical UI flows with the approved UI-testing strategy.
- Verify state restoration, navigation, task cancellation, accessibility, localization, Dynamic Type, and relevant device/platform layouts.

## Sources

- [SwiftUI documentation](https://developer.apple.com/documentation/swiftui)
- [SwiftUI model data](https://developer.apple.com/documentation/swiftui/model-data)
- [SwiftUI apps overview](https://developer.apple.com/documentation/technologyoverviews/swiftui)
