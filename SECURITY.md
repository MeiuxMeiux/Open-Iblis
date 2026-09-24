# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue, pull
request, or discussion for them.

Use either channel:

1. **GitHub private vulnerability reporting.** On this repository, open the
   Security tab and choose "Report a vulnerability".
2. **Email** iblis@meiuxmeiux.com with "security" in the subject line.

Include what you found, the version and build type (official or source), steps
to reproduce, and the impact you expect. A proof of concept helps; please keep
it minimal and do not include other people's data.

What to expect:

- An acknowledgement within 5 working days.
- A first assessment, and a fix plan if the report is valid, within 30 days.
- Credit in the release notes if you want it, once a fix ships.

Please give us a reasonable chance to fix the problem before you disclose it
publicly. We will agree a disclosure date with you and keep you informed.

There is no bug bounty.

## Supported versions

Iblis is in alpha. Only the latest alpha release receives security fixes.
Official installers update themselves, so a fix reaches users as a normal
update. Source builds must be rebuilt from the fixed commit.

| Version | Supported |
| --- | --- |
| Latest `0.x` alpha | Yes |
| Older alphas | No |

## Scope

In scope:

- Code in this repository: the desktop app (`apps/shell/`), the plugin SDK,
  plugin packs and their sidecars, and the build and catalog-verification
  scripts.
- The hosted Iblis service the app talks to (the website, the signed catalog
  and community Styles index, product-key activation, and uploads). Its
  server code is not public, but reports about it are welcome through the
  same channels.
- The official installers and the auto-update path.

Out of scope:

- Vulnerabilities in third-party model weights, upstream engines, or
  dependencies that are already publicly known and tracked upstream (tell us
  if Iblis ships an affected version, though).
- Denial of service by flooding the hosted service, social engineering, and
  physical attacks.
- Findings that need an already compromised machine or administrator
  rights on it.
- Forks and source builds with modified code or a different signing key.

## Safe harbor

We will not pursue legal action against good-faith research that follows this
policy: stays within scope, avoids privacy violations and service disruption,
does not access or modify other users' data, and gives us time to fix the
problem before disclosure.
