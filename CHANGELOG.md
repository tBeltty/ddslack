# Changelog

All notable changes to Dice Companion are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The public interface is the Slack app's behavior and the self-hosting configuration in `docs/self-hosting.md`.

## [Unreleased]

## [1.0.0] - 2026-11-04

First public release.

### Added

- Dice picker posted on a mention or `/roll`: die, how many, modifier, roll type and a Roll button, in channels, threads and Huddle chats.
- `/roll` notation (`2d6+3`, `2d20kh1`, `4d6kh3`, `d%`), `/roll stats` for ability scores and `/roll death` for death saving throws.
- More options form with a target number (DC or AC), a reason and secret rolls, also opened from the message shortcut Roll dice here.
- Advantage, disadvantage and critical hits following the SRD 5.1.
- Animated, ray-traced 3D dice for d4 to d100, with gold and red images for a natural 20 and a natural 1.
- Thread tidying: only the newest roll keeps its image and picker.
- Home tab with a guide and a per-person Beginner or Expert message style.
- Installation in any workspace through Slack's OAuth flow, with installations encrypted at rest.
- A 3-second cooldown per person, Slack rate-limit budgets, signed image URLs and rate limits on the image server.

[Unreleased]: https://github.com/tBeltty/ddslack/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tBeltty/ddslack/releases/tag/v1.0.0
