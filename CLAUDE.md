# smartplayapps

## Self-heal (SmartPlay standard, required)

Spec: smartplay-gate docs/SELF-HEAL-STANDARD.md.

Every time you work in this repo, before finishing:
1. Check this app has all four v1 pieces: error reporting tagged with app name, version and platform; a one-tap "Report a problem"; a startup health check that reports failures; a self-update path (web: reload on new deploy; Expo: EAS Update channel; Chrome extension: lab self-reload).
2. Build any missing piece as part of the current work, with a test.
3. Never put personal, health or page content in a report.
4. Fixes are never merged without Tim's approval; shipping and rollback may be automatic.

Done when all four pieces exist, are tested, and the app's line in SELF-HEAL-STANDARD.md "Where each app stands" is updated.

## SmartPlay Honesty Principles (2026-11-20) — included in every build

Every SmartPlay app ships these five promises at no extra charge. They're how we build, not an upgrade. Never put one behind a paywall. Check every feature against all five before calling it done.

1. **It speaks up and fixes itself (self-healing).** The app finds its own problems, fixes what it can, and tells the user before it costs them.
2. **Every answer shows its source (truth layer).** No made-up numbers, no filler. The user can always see what an insight is based on.
3. **It never claims more than it can prove (claim guard).** Language the product can't back up is blocked automatically.
4. **Your data is protected from day one (Defender security gate).** Security is the foundation, not a retrofit.
5. **Built for everyone who'll use it (accessibility).** Large text, screen readers, high contrast, one-hand use.
