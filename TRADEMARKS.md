# Trademark policy

"Iblis", the Iblis logo, and the Meiux Meiux name and logo are trademarks of
Meiux Meiux LLC. The open-source licenses in this repository (GPL-3.0-or-later,
Apache-2.0, MIT, CC-BY-4.0) grant rights in the code and documentation. They
do not grant any right to use these marks.

This policy exists so that people who download something called Iblis get the
software the maintainers ship, with its signed updates and catalog. It is not
meant to stop you from using, studying, changing, or sharing the code.

## What you may do without asking

- Build the app from this repository for your own use, unmodified or
  modified, and call it Iblis on your own machine.
- Refer to the project by name in articles, reviews, tutorials, talks, and
  package listings that point to the official downloads.
- Say that your project is "based on Iblis", "a fork of Iblis", or "compatible
  with Iblis" in its description, as long as its name and logo are your own
  and it is clear that it is not made or endorsed by Meiux Meiux LLC.
- Publish plugins and skins for Iblis and say they work with Iblis.
- Keep the marks in unmodified copies of this repository, including the files
  in `packages/brand/`.

## What needs a different name

If you distribute a modified version of the app (a fork, a rebuild with
changes, a repackaged installer), you must:

- Use a different product name that is not confusingly similar to Iblis.
- Replace the logo, installer art, and app icons in `packages/brand/` and the
  product fields in `apps/shell/electron-builder.yml` with your own.
- Use your own app id, so your build does not install over or alongside the
  official app as if it were the same program.
- Use your own update feed, catalog, and signing keys, or none. Do not point
  users of your build at the official update feed, and do not present your
  build as an official release.

You may not use the marks in a domain name, company name, or product name, or
in a way that suggests Meiux Meiux LLC made, sponsors, or endorses your
project.

## Brand files

The files in `packages/brand/` (logos, installer art, icons) are not covered
by the open-source licenses. They are included so the official app can be
built from this repository. See `LICENSES/LicenseRef-Iblis-Brand.txt` for the
terms under which they may be copied.

## Questions

If you are unsure whether a use is fine, or want permission for something this
page does not cover, email iblis@meiuxmeiux.com. We would rather say yes than
have you guess.
