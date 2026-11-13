# Versioned desktop updates

The Update button works in both the macOS and Windows desktop apps. It checks the public GitHub Releases source in `config/updates.json`; no GitHub login is needed to download updates. Browser mode can check releases and link to downloads, but installation happens in the desktop app.

## Publish new code

Commit the changes and push to `main` in `anitrajpurohit28/PersonalJiraBoard`. The **Desktop release** GitHub Actions workflow tests and builds four packages: Apple Silicon Mac, Intel Mac, Windows x64 and Windows ARM64. Windows packages use bundled x64 Node for the pinned local database runtime. Builds contain a neutral Jira configuration, with no API tokens or local databases.

Versions are `major.minor.<first-parent commit count>` using the major/minor from `package.json`. A full checkout is required. For example, commit count 9 produces `1.0.9` and GitHub tag `v1.0.9`. Local commits get that version at the next build; other computers receive it only after pushing and successfully publishing. Do not rewrite main's history or reuse release tags. To start a new major/minor series, change the first two numbers in package.json. Local builds display “Local build” and cannot be packaged as official releases.

A failed build publishes nothing. The workflow assembles all platform assets and checksums, uploads a draft release, and publishes it only when uploads complete. Published release versions are never overwritten. Overlapping pushes are serialized; GitHub can coalesce pending runs to the latest commit. You may also run **Desktop release → Run workflow** on main. GitHub Actions must be enabled, with the workflow allowed to create repository releases. No separate publishing token is required; only the publishing job receives `contents: write`.

The first version containing the updater must be installed once manually. Existing older apps cannot acquire an Update button remotely. Future updates use **Update → Download update → Restart & update**. The app never updates automatically while you are editing a task. Close task details first so pending edits are saved.

## Account and data preservation

Your account configuration is outside release packages:

- macOS: `~/Library/Application Support/PersonalJiraBoard/account.json`
- Windows: `%LOCALAPPDATA%\PersonalJiraBoard\account.json`

This file contains only `email` and `jiraUrl`. A locally configured build initializes it from `config/app.json`; official releases retain it. On a fresh computer a generic release asks for these two values, then the Jira connection screen accepts your API token. API tokens remain in the existing private per-account storage. To change the account used by an official installation, quit it, edit account.json and reopen it. Changing account settings selects a separate data namespace; it does not erase the old account.

The updater verifies the release tag, version, commit, platform, expected size and SHA-256. It rejects unsafe archive paths and checks the macOS app signature. It stages the replacement outside the installed application, closes the native app, waits for services to stop, and backs up this account's database (including SQLite WAL files), offline queue, private attachments, credentials and account settings. Close same-account browser development servers before installing an update. Updates never run git pull or replace your repository.

The backups live under `PersonalJiraBoard/backups/update-<version>-<job-id>/` in the platform's Application Support / LOCALAPPDATA folder. They include private credentials, so keep them private. Display preferences and WebView profiles stay in their existing locations.

The app reopens after the swap and the agent checks its version and account health. The previous application is removed after successful startup. If startup fails and no new app or service remains running, the previous application is restored. If the new app is still running, the previous copy is retained for manual recovery instead of replacing running files. The pre-update data backup is retained in either case; database backups are not automatically restored over potentially newer edits.

Updater diagnostics and results: `PersonalJiraBoard/updates/jobs/<job-id>/install.log` and `result.json`. The Update dialog also reports an unsuccessful previous update. Retained previous files are `.previous-<job-id>` inside the Mac app, or `<Windows app folder>.previous-<job-id>`. Quit the app and all its services before manual recovery. Logs identify the backup location on successful installation.

## Windows portable installation

Extract the complete release ZIP to a writable folder such as `%LOCALAPPDATA%\Programs\PersonalJiraBoard`. Keep `PersonalTaskBoard.exe`, `app/`, `runtime/`, Runtime.json and BuildID.txt together. Double-click the executable and create a shortcut if desired. Node and .NET are included; Microsoft Edge WebView2 is still required. First launch copies runtime files into a per-user, versioned cache. Subsequent updates replace the portable folder, preserving data outside it.

For macOS, extract the matching ZIP and place **Personal Jira Board.app** in Applications. Initial downloads are ad-hoc signed, as with the existing local builds; Apple notarization and Windows Authenticode certificates are not configured. Native Windows/WebView2 installation must be verified on Windows; a macOS cross-build checks compilation only.

## Release tooling

- `scripts/stamp-version.mjs`: generate ignored `config/build-info.json` from Git.
- `scripts/package-release.mjs <platform>`: ZIP a completed official native build, validate its archive, and write its checksum descriptor.
- `scripts/release-manifest.mjs [asset-directory]`: combine matching descriptors for all four platforms into update-manifest.json.
- `local/app-updates.mjs`: release checks, verified downloads and staging.
- `desktop/update-agent.mjs`: installation, backup, health check and rollback.

Generated releases, build metadata, local configuration and credentials remain Git-ignored. Review and commit the updater source and workflow to activate this pipeline; merely running a local build does not publish a release.
