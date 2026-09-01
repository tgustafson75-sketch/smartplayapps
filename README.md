# smartplayapps.com

The SmartPlay AI home site. Static, no build step.
Vercel project: `smartplayapps-web`. Push to `main` deploys.

## Files

- `index.html` — the whole site. Self-contained: the SP monogram and both
  favicons are inlined as base64 data URIs, so the only external request is
  Google Fonts (Sora + Inter).
- `card.html` — digital business card, served at `/card` via `cleanUrls`.
  The QR is inlined and encodes `https://smartplayapps.com`; it was generated
  with error correction level H and only written after OpenCV decoded it back
  at both full size and 260px, so it is verified scannable rather than assumed.

## Brand

Midnight Navy `#0A0F1F` · Deep Indigo `#1A1F4D` · Electric Cobalt `#2563FF` ·
Soft Violet `#8B5CF6` · Warm Silver `#D1D5DB` · Off-White `#FAFAFC`.
Sora Semibold display, Inter body. Node-terminal **S** monogram.
Tagline: *Intelligence made useful.*

Deliberately NOT the SmartPlay Caddie palette — Caddie is dark green and cream.

## Domain

`smartplayapps.com` 308-redirects to `www.smartplayapps.com`, which serves the
site. This is the opposite of smartplaycaddie.com, where the apex is canonical
because Apple App Review and Search Console hold apex URLs. Both work; the
difference is deliberate and was left alone rather than changed under a live
site for consistency's sake.
