# Supervised Browser Profile

The network worker uses a persistent Playwright browser profile for legitimate session continuity during supervised browser work.

This is not a bypass mechanism. CAPTCHA, two-factor authentication, security challenges, and final submit decisions remain manual.

## Defaults

- Browser profile: `var/browser/profile`
- Browser channel: `chrome`
- Headless mode: disabled by default
- Submit actions: disabled by default
- Fill actions: approval-gated by default

## Environment variables

```text
NETWORK_MCP_USER_DATA_DIR=var/browser/profile
NETWORK_MCP_BROWSER_CHANNEL=chrome
NETWORK_MCP_HEADLESS=false
```

If the configured browser channel is unavailable, the worker retries with bundled Chromium using the same profile directory.

## Manual warm-up

Run the worker in visible mode, then manually open the sites used for supervised work and complete normal consent, login, or challenge steps yourself.

Recommended warm-up targets:

- Google
- OpenAI
- Ashby
- Greenhouse
- LinkedIn, if needed for normal user navigation

## Security rules

- Do not commit the profile directory.
- Do not export or share cookies.
- Do not import cookies from a personal Chrome profile.
- Do not automate CAPTCHA, two-factor authentication, or security challenges.
- Do not use stealth or fingerprint-evasion plugins.

The profile exists only to avoid treating every supervised session as a brand-new empty browser.

## Git hygiene
