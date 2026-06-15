# Mobile App Design

Date: 2026-06-15

## Goal

Build an internal mobile app for iOS and Android so users can access existing business systems without opening a desktop browser or manually entering system URLs on a mobile browser.

The first release uses a hybrid model: the app provides native login flow, a native system launcher, and in-app web access to existing systems. High-frequency workflows can be converted to mobile-native screens later.

## First Release Scope

The first release includes three systems:

- Training Exam
- Inventory Management
- Device Flow

The app starts with unified login. After login succeeds, users land on a home screen with the three system entries. Selecting a system opens its existing web page inside the app.

## Out of Scope

The first release does not rebuild each business system as a full native mobile experience. It also does not target public app store launch. Distribution is internal test distribution only.

## Technology Choice

Use React Native with Expo.

Reasons:

- One codebase can build iOS and Android apps.
- Expo/EAS supports internal test builds for Android and iOS.
- The app can start as a native shell around existing web systems.
- Future high-frequency workflows can be implemented as native React Native screens without replacing the whole app.

## App Structure

### Auth

Auth owns unified login, session detection, session persistence, and logout.

On app startup:

1. Check whether a valid local session exists.
2. If no valid session exists, show the unified login flow.
3. If a valid session exists, open the home screen.

On logout:

1. Clear app-side session state.
2. Clear web session state used by embedded systems where supported.
3. Return to the unified login flow.

### Home

Home is a native screen with three system entries:

- Training Exam
- Inventory Management
- Device Flow

Each entry uses config-driven metadata:

- Display name
- System key
- Target URL
- Optional description
- Optional icon

The home screen should stay simple and operational. It is not a marketing page.

### System WebView

SystemWebView opens the selected system inside the app.

Expected controls:

- Back to home
- Web back when the embedded page has history
- Refresh
- Loading state
- Error retry
- Logout entry

Expected states:

- Loading
- Loaded
- Network or server error
- Login expired

If login expires, the app should return to the unified login flow.

### Config

Configuration keeps environment-specific URLs out of screen code.

Required values:

- Unified login URL or auth endpoint
- Training Exam URL
- Inventory Management URL
- Device Flow URL
- Environment name

The first implementation can support a development environment and leave room for staging/production values.

### Build And Distribution

Use Expo/EAS profiles to build internal test packages:

- Android APK or internal distribution build
- iOS internal distribution through TestFlight, ad hoc, or enterprise provisioning depending on available Apple account setup

Public app store submission is a later decision.

## Session Strategy

The app should integrate with the existing unified login system. The preferred user experience is:

1. Open app.
2. Log in with unified account.
3. Enter the app home screen.
4. Open any of the three systems without logging in again.

Implementation details depend on the existing unified login system. During implementation, inspect whether it uses cookie-based sessions, token-based auth, or redirect-based SSO. The app should choose the least invasive integration that preserves the current server-side security model.

## Error Handling

Network failure:

- Show an app-level error state.
- Provide retry and back-to-home actions.

System URL failure:

- Show the failed system name.
- Provide retry and back-to-home actions.

Login expiration:

- Clear stale app-side auth state.
- Return to unified login.

Unsupported external navigation:

- Keep allowed business system URLs inside the app.
- Open external links only when explicitly allowed by config.

## Testing Strategy

Unit-level tests:

- Auth state detection
- System config mapping
- URL selection for each system
- Logout state cleanup

Integration/manual tests:

- Android test build installs successfully.
- iOS internal test build installs successfully.
- Unified login opens on first app launch.
- Successful login reaches the home screen.
- Each of the three systems loads inside the app.
- Login state is preserved across the three systems.
- Logout returns to login.
- Network failure shows retry and back-to-home actions.

## Risks And Open Implementation Checks

The design is intentionally stable, but implementation must verify these details from existing systems:

- Exact unified login mechanism: cookie, token, redirect, or mixed.
- Whether WebView can share the required session state across all three target systems.
- Whether any target system blocks embedded WebView access.
- Whether iOS distribution will use TestFlight, ad hoc signing, or enterprise signing.
- Whether Android distribution should produce a direct APK or an internal app bundle flow.

## Success Criteria

The first release is successful when a tester can install the app on iOS or Android, log in once through the unified login system, see the three system entries, open each system inside the app, and return or retry cleanly when a page fails to load.
