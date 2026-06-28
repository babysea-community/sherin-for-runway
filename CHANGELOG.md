# Changelog

All notable changes will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Standardize Runway BYOK form rendering around Semantic Lady schema fields.
- Separate image and video input handling for Runway models while keeping shared UI media/file wording generic.
- Render Runway duration as a bounded select control and use local field descriptions for Studio form help text.
- Order Studio model dropdowns by image models first, then video models, with alphabetical sorting inside each group.

### Fixed

- Ignore stale form values that are outside the active Runway model schema.
- Omit empty video input values from BYOK submissions so image-only Runway model paths do not receive unsupported schema fields.
- Preserve durable input reference assets after terminal generation states so the References dashboard keeps displaying uploaded and URL-based inputs.

## [0.1.0] - 2026-06-27 - INITIAL RELEASED

- Implement Runway models.
