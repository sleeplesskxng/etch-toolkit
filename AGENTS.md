# Etch Toolkit

Quality of life additions for the Etch builder. Vanilla PHP, JS and CSS, no build step.

## Local environment

- This folder lives inside a WordPress Studio site at `../../..` (`blank-etch-site`). Edits are live on that site.
- Run WP-CLI as `studio wp --path ../../.. …`, never bare `wp`. From this folder, `studio` needs `--path ../../..` to find the site. Get the URL and login with `studio status --path ../../..`.
- Etch (`../etch`) is a third-party dependency. Read it, never edit it.

## Structure

- `etch-toolkit.php` loads `includes/helpers.php` and each feature.
- `features/<name>/<name>.{php,js,css}` is one self-contained feature. `etch_toolkit_enqueue_feature( '<name>' )` loads its assets in the builder.
- `assets/etch-toolkit.{js,css}` is the shared core (`window.etchToolkit`).

## Skills

WordPress skills from [WordPress/agent-skills](https://github.com/WordPress/agent-skills) live in `.claude/skills/`. Where a skill says `skills/…`, read it as `.claude/skills/…`. Where it says `wp …`, run `studio wp --path ../../.. …`.

## Releasing

Sites update through [plugin-update-checker](https://github.com/YahnisElsts/plugin-update-checker), bundled in `lib/`. It offers the latest non-prerelease GitHub release. It's skipped when the plugin folder has a `.git` directory, so this dev copy never updates itself.

1. Bump `Version` in the plugin header and `ETCH_TOOLKIT_VERSION` together.
2. Commit and push, then publish a release whose tag matches, with an installable zip attached. The release notes show in the update details.

   ```bash
   git tag v<version> && git push origin v<version>
   git archive --format=zip --prefix=etch-toolkit/ -o etch-toolkit.zip v<version>
   gh release create v<version> etch-toolkit.zip --generate-notes && rm etch-toolkit.zip
   ```

`lib/plugin-update-checker` is vendored. Don't edit it. Upgrade by replacing the folder with a newer release. Same for `lib/woff2`, the WOFF2 converter the fonts feature runs in the browser.

Everything in `.gitattributes` marked `export-ignore` stays out of the installed plugin.
