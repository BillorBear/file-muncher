# Repository workflow

- Read `README.md`, `docs/development.md`, and `docs/local-debugging.md` before changing the development workflow.
- Keep the existing Electron + TypeScript + esbuild + npm stack. Do not add frameworks or dependencies without a concrete need.
- Inspect Git status first and preserve unrelated changes. Keep edits focused; use English code comments.
- Use `npm start` for local desktop development and `npm run preview` for visual-only work. Both perform a single build; neither watches source changes.
- Use an absolute `FILE_MUNCHER_USER_DATA` path under `.local-data/` for manual development. This isolates preferences, not filesystem operations. Only delete disposable fixtures created for the task.
- Run `npm run check` after code changes. Run renderer or desktop regressions when the affected behavior requires them, as described in `docs/development.md`.
- Do not build installers after routine changes. Run `pack:mac`, `pack:win`, or equivalent electron-builder commands only when the user requests installers or release validation.
- Do not commit dependencies, build outputs, installers, test artifacts, local profiles, credentials, or environment files.
- Commit or push only when explicitly requested. A request to commit does not authorize pushing or creating a remote repository.
- Report changes, validation performed, and remaining platform verification limits. Do not equate cross-compilation with native Windows or Intel Mac testing.
