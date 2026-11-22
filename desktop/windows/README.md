# Personal Jira Board on Windows

The Windows desktop app runs the same dashboard, database routes, and Jira connector as macOS. Tasks, subtasks, comments, attachments, Areas, labels/tags, filtering, sorting, reminders, themes, and offline sync use the shared code. Use **Ctrl** instead of **Cmd** for task-tag shortcuts and search. The Windows shell uses Microsoft Edge WebView2 for its window.

## Install a published release

Download the Windows ZIP for your PC from [GitHub Releases](https://github.com/anitrajpurohit28/PersonalJiraBoard/releases), extract the whole folder to a writable location, and open **PersonalTaskBoard.exe**. Node and .NET are bundled; Microsoft Edge WebView2 is required. Setup asks for your email and Jira board URL on a fresh PC, then the app accepts your Jira API token. Use **Update** for future versions.

## Build from source

Use **Windows 10 (22H2) or Windows 11** and install:

- [Node.js](https://nodejs.org/en/download), **Windows x64**, version 22.16 or newer (24 LTS is a suitable choice). Node includes npm. Use x64 Node for the packaged runtime; on a Windows ARM PC, use the x64 Node installer and x64 app through Windows emulation.
- [.NET SDK (8 or later)](https://dotnet.microsoft.com/download), needed to build the desktop launcher.
- [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/), if it is not already installed.

Windows uses Node SQLite directly, so it does not start the Windows 11-only workerd runtime. Existing cached SQLite databases are reused; fresh installations store the cache in `data/<configuration>/native/tasks.sqlite`. Keep all data directories when upgrading. Windows 10 and Windows 11 native execution still need verification on a Windows PC; shared runtime tests on macOS do not substitute for that check.

Copy or clone the **latest source** to a writable folder, for example `C:\Tools\Anit_personal_JiraBoard`. Do not copy the Mac's `node_modules`, `outputs`, `dist`, `.vite`, `.vinext`, or `.wrangler` folders: dependencies and executables must be installed/built on Windows.

Open PowerShell in the project folder:

```powershell
cd C:\Tools\Anit_personal_JiraBoard
node --version
node -p "process.arch"
dotnet --list-sdks
npm.cmd ci
```

The architecture should be `x64`. Using `npm.cmd` works in PowerShell even when its execution policy blocks `npm.ps1`. Reopen the terminal after installing Node or .NET if their commands are not found.

## Configure the Jira account

On first launch, enter your Jira login email and full board URL, then paste your API token in **Connect Jira**. Choose **Remember this token on this device** to save it. The Windows build works from a fresh checkout without either private configuration file.

To preconfigure the account before building, copy `config/app.example.json` to `config/app.json` and enter your own details:

```json
{
  "email": "your-jira-login@example.com",
  "jiraUrl": "https://your-site.atlassian.net/jira/software/projects/KAN/boards/2"
}
```

Use the full URL of the board you want to fetch. For your existing personal board, keep the current email and URL in this file.

The real token is excluded from Git, so it must be supplied separately on the Windows PC. If `config/credentials.json` does not exist, copy the example:

```powershell
Copy-Item config\credentials.example.json config\credentials.json
notepad config\credentials.json
```

Replace the example value with your Jira API token:

```json
{
  "apiToken": "your-Jira-API-token"
}
```

Keep this file private. No Google login window, Chrome extension, AI token, or open Jira browser tab is needed.

## Build and run the desktop app

From the repository root:

```powershell
npm.cmd run windows:build
npm.cmd run windows:start
```

The build creates:

```text
outputs\windows\win-x64\PersonalTaskBoard.exe
```

For subsequent launches, double-click that executable or use `npm.cmd run windows:start`. You can create a desktop shortcut to it. `npm.cmd run windows` builds and opens it in one command.

Keep the entire output folder together: the executable, `app/`, `runtime/`, Runtime.json and BuildID.txt. It can be moved outside the repository and includes Node, application dependencies and .NET. The existing `PERSONAL_TASK_BOARD_PROJECT_DIR` developer fallback is supported for older executable-only builds. A source build uses your prefilled email and board URL when supplied. API tokens are stored separately from the portable app. Enter/save the API token in the app when first connecting on another PC.

The app starts the dashboard at `http://localhost:3120/` and the Jira helper at `http://127.0.0.1:4327`, without console windows. It checks the configuration and protocol of services already using those ports. Close an older/different board app if a port-conflict message appears. Closing the window stops only the services this launcher started.

Connect while online at least once to populate this PC's cache. Thereafter cached tasks remain editable offline; queued changes sync when Jira reconnects. Keep the app open for scheduled reminders. Notification permission is enabled from Reminders, as on macOS.

For an optional native ARM64 **shell**, with x64 Node still installed for the shared services:

```powershell
npm.cmd run windows:build -- -Runtime win-arm64
npm.cmd run windows:start -- win-arm64
```

## Run in a browser instead

No .NET SDK or WebView2 is needed for browser mode. After installing Node, running `npm.cmd ci`, and setting the two configuration files:

```powershell
npm.cmd run dev
```

Open `http://localhost:3100/`. Leave the terminal open; press Ctrl+C to stop. For production mode, `npm.cmd start` builds and runs the app. `npm.cmd run build` also works in PowerShell or Command Prompt.

The same dashboard features work in browser mode, but browser-reserved shortcuts such as Ctrl+W may be intercepted by the browser. Use the desktop app for those custom tag shortcuts.

## Local file references

Description mixes editable notes, checklists and local links. Click Checklist to insert checkbox items at the cursor. Drop files or folders from File Explorer into Description, or click Add files and choose Files for a multiple-file selection or Folder for a folder. Multiple folders can also be dropped together. Their file paths sync in the Jira description; file contents stay on the PC. Clicking a reference opens the original document. A missing path, including a Mac path on this PC, shows “file is missing on this device.” Previously uploaded Jira files remain accessible below the description. Drag across links to select them, then press Backspace/Delete or use Delete selected. Backspace at the text cursor immediately after a file removes its reference; Delete immediately before it does the same. Ctrl+Z undoes removal; Ctrl+Shift+Z redoes it. Original files are not deleted. Back up original files separately.

## Updating

Use **Update → Download update → Restart & update**. The app downloads the matching package, verifies its checksum, backs up local data, closes and reopens itself. Your Jira settings and offline queue are preserved. See [release publishing and recovery](../UPDATES.md).

To rebuild manually from changed source, quit the app, run `npm.cmd ci`, `npm.cmd run windows:build`, then `npm.cmd run windows:start`. Neither method replaces the separate data folders below.

## Recover from an older runtime cache error

If an older launcher reports that the runtime cache already exists, close Personal Jira Board and open `%LOCALAPPDATA%\PersonalJiraBoard\runtime\apps` in File Explorer. Rename the entry named in the error by adding `-old`, then reopen the executable. The app regenerates the runtime cache and uses the stored Jira account.

After rebuilding with the cache fix, the launcher serializes cache setup and handles incomplete entries automatically.

## Data and recovery

| Location | Contents |
| --- | --- |
| `%LOCALAPPDATA%\PersonalTaskBoard\data\personal-<configuration-id>\` | Local SQLite database, reminders, tag shortcuts/order and cached tasks |
| `%LOCALAPPDATA%\PersonalTaskBoard\private\personal-<configuration-id>\workspace-v1.json` | Offline Jira snapshot and pending sync queue |
| `%LOCALAPPDATA%\PersonalTaskBoard\private\personal-<configuration-id>\attachments\` | Cached and pending attachment files |
| `%LOCALAPPDATA%\PersonalTaskBoard\private\personal-<configuration-id>\credentials.json` | Token, if saved through Connect Jira |
| `%LOCALAPPDATA%\PersonalJiraBoard\account.json` | Email and Jira board URL retained across app updates |
| `%LOCALAPPDATA%\PersonalJiraBoard\WebView2\` | Desktop browser profile and display preferences |
| `%LOCALAPPDATA%\PersonalJiraBoard\logs\app.log` | Startup and local service diagnostics for downloaded builds |

Local desktop builds write diagnostics to the checkout’s `logs/app.log` when available. See the [logging paths](../../README.md#logs). The paths above are outside the repository. `config/credentials.json`, database files, and generated output are already Git-ignored.

Connecting to the same Jira board on Windows retrieves synced tasks, subtasks, descriptions, priorities, workflow, comments, attachments, labels and Area assignments. Reminders, manual ordering, tag shortcuts/order, display preferences, and unsynced Mac edits do not transfer through Jira. Each computer maintains its own offline queue. Sync the Mac first before relying on the Windows copy.

## Verification

The launcher is cross-compiled for Windows during development, and the shared app and keyboard bridge are checked separately. A native Windows/WebView2 execution check is still required on a Windows PC; compiling on macOS does not verify that window, native downloads, or Windows notification delivery.

## Credentials warning while building

If an older build reports `ERR_MODULE_NOT_FOUND` for `config/app.json`, update your checkout to get the first-launch setup fix. With that fix, a missing file is expected on a fresh checkout.

Packaging does not require Jira credentials. For a local build it tries to save a valid configured token in private storage on this PC; a malformed or unwritable credentials file now produces a warning and the build continues. No API token is copied into the portable output. Release builds skip credential loading entirely.

If Jira cannot connect afterwards, make `config/credentials.json` match `config/credentials.example.json` (a JSON object with an `apiToken` string), or enter the token in the app. UTF-8 JSON with a Windows byte-order mark is accepted. Keep credentials out of Git and chat.

## Rebuilding while the app is open

Finish your edits and close Personal Jira Board before running `npm run windows:build`. Windows locks a running `PersonalTaskBoard.exe`, so .NET cannot replace it. The build checks this before compilation and reports the locked output path. If closing the window does not release it, check Task Manager for `PersonalTaskBoard.exe`. The build does not stop running applications automatically. Reopen the app from the complete output folder after the build finishes.

## Running window icon

The launcher embeds the light and dark artwork directly in its executable and assigns both native window icon sizes. The running taskbar/title-bar icon follows the app theme without loading artwork from an older extracted runtime or Explorer's executable-icon cache. Rebuild and reopen the complete output folder to use a changed launcher. An already-running process cannot receive a newly compiled icon; close it before rebuilding. Pinned shortcuts and File Explorer continue to use the executable's default light icon.

## Jira stays offline after entering a token

Use the Jira account email and site shown in **Connect Jira** to confirm the app is pointing at the intended account. Failed connections keep this dialog open with the returned error; cached tasks remain available. A newly entered token takes priority over an in-flight startup attempt. Without **Remember this token**, it is retained only for reconnects during this session and cleared on disconnect or exit. With **Remember**, it is saved privately after authentication succeeds.

If upgrading from an older build that silently closes the dialog, close the app completely, rebuild the latest source and reopen it. Authentication and project-access errors still require correcting the token, account or permissions; offline task access is not confirmation that Jira authentication succeeded.

The connection indicator follows `/api/jira/session`, not Windows/browser internet-detection hints. An offline browser hint triggers a fresh service check. A task-cache or sync error is displayed separately and does not override a confirmed Jira connection.

## Build a fresh copy when an older output is locked

To compile into a separate folder without replacing the existing EXE, run this in Git Bash from the repository root:

```bash
npm run windows:build -- -BuildName fresh
```

This creates the complete portable app at `outputs/windows/win-x64-fresh/`. Choose another name if that folder is already in use. Finish edits and quit the old app before launching the new `outputs/windows/win-x64-fresh/PersonalTaskBoard.exe`, so both instances do not compete for the same local services. Keep the whole portable folder together. The option does not move, delete or reset user data. Release builds retain their standard output paths and reject named folders.
