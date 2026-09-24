# Etch Toolkit

Quality of life additions for the Etch builder. Vanilla PHP, JS and CSS, no build step.

## Local environment

- This folder lives inside a WordPress Studio site at `../../..` (`blank-etch-site`). Edits are live on that site.
- Run WP-CLI as `studio wp …`, never bare `wp`. Get the URL and login with `studio status`.
- Etch (`../etch`) is a third-party dependency. Read it, never edit it.

## Structure

- `etch-toolkit.php` loads `includes/helpers.php` and each feature.
- `features/<name>/<name>.{php,js,css}` is one self-contained feature. `etch_toolkit_enqueue_feature( '<name>' )` loads its assets in the builder.
- `assets/etch-toolkit.{js,css}` is the shared core (`window.etchToolkit`).

## Skills

WordPress skills from [WordPress/agent-skills](https://github.com/WordPress/agent-skills) live in `.claude/skills/`. Where a skill says `skills/…`, read it as `.claude/skills/…`. Where it says `wp …`, run `studio wp …`.

## Releasing

Sites update through [Git Updater](https://github.com/afragen/git-updater), which reads the `GitHub Plugin URI` header.

1. Bump `Version` in the plugin header and `ETCH_TOOLKIT_VERSION` together.
2. Commit, then tag and publish a release: `gh release create v<version> --generate-notes`.

Everything in `.gitattributes` marked `export-ignore` stays out of the installed plugin.
