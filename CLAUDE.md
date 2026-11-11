# smartplayapps

## Self-heal (SmartPlay standard, required)

Spec: smartplay-gate docs/SELF-HEAL-STANDARD.md.

Every time you work in this repo, before finishing:
1. Check this app has all four v1 pieces: error reporting tagged with app name, version and platform; a one-tap "Report a problem"; a startup health check that reports failures; a self-update path (web: reload on new deploy; Expo: EAS Update channel; Chrome extension: lab self-reload).
2. Build any missing piece as part of the current work, with a test.
3. Never put personal, health or page content in a report.
4. Fixes are never merged without Tim's approval; shipping and rollback may be automatic.

Done when all four pieces exist, are tested, and the app's line in SELF-HEAL-STANDARD.md "Where each app stands" is updated.
