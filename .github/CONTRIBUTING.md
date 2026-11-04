# Contributing to Dice Companion

Thanks for helping. Dice Companion is a small project with one maintainer, so a short issue before a large change saves everyone time.

## Reporting bugs and ideas

Open an issue with the bug report or feature request form. For a bug, say where it happened (channel, thread or Huddle chat), what you did and what you expected. Never paste tokens, secrets or private messages into an issue.

Security problems go through the [security policy](SECURITY.md), not issues.

## Scope

The app does dice for D&D games in Slack and nothing else. Character sheets, initiative trackers, maps and scheduling are out of scope.

## Setting up

Follow [Self-hosting](../docs/self-hosting.md) to create a Slack app of your own and run it locally with `pnpm dev`. You need Node.js 22 or later and pnpm.

## Before you open a pull request

Run the same checks as CI:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- Add or update tests for any change in behavior.
- Update the documentation in `docs/` and the `Unreleased` section of [CHANGELOG.md](../CHANGELOG.md) when users or self-hosters would notice the change.
- Every file carries REUSE license tags. Start new source files with:

  ```ts
  // SPDX-FileCopyrightText: 2026 Your Name
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

  and check the repository with `uvx reuse lint` (or `pipx run reuse lint`).
- Write commit messages in the imperative, with a summary line of about 50 characters, a blank line, and a body that explains why.

Pull requests are squash-merged into `main`, and every push to `main` deploys the production app, so the pull request title becomes the commit summary. Workflows from first-time and external contributors wait for the maintainer's approval before they run.

## License

By contributing, you agree that your contributions are licensed under the GNU General Public License v3.0 or later.
