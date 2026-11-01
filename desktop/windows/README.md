# Personal Jira Board on Windows

The Windows desktop app runs the same dashboard, database routes, and Jira connector as macOS. Tasks, subtasks, comments, attachments, Areas, labels/tags, filtering, sorting, reminders, themes, and offline sync use the shared code. Use **Ctrl** instead of **Cmd** for task-tag shortcuts and search. The Windows shell uses Microsoft Edge WebView2 for its window.

## One-time setup

Use **Windows 11** and install:

- [Node.js](https://nodejs.org/en/download), **Windows x64**, version 22.13 or newer (24 LTS is a suitable choice). Node includes npm. The pinned local database runtime requires x64 Node; on a Windows ARM PC, use the x64 Node installer and x64 app through Windows emulation.
- [.NET 8 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/8.0), needed to build the desktop launcher.
- [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/), if it is not already installed.

Windows 11 is the supported target because the [local Wrangler/workerd runtime requires it](https://developers.cloudflare.com/workers/wrangler/install-and-update/). A Cloudflare account or deployment is not required; the database runs locally.

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

Before starting, edit `config/app.json`:

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

Keep the executable in its output folder inside the repository. It needs the source tree, installed `node_modules`, Node, and WebView2 to run; it is not a standalone copy of the whole app. The .NET runtime is included in the executable, so a separate .NET runtime installation is unnecessary after building.

If you move the executable elsewhere, set `PERSONAL_TASK_BOARD_PROJECT_DIR` to the full repository path before opening it. Do not put credentials in the executable.

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

## Updating

Quit the Windows app, update the source, then run:

```powershell
npm.cmd ci
npm.cmd run windows:build
npm.cmd run windows:start
```

Keep your private `config/credentials.json` and desired `config/app.json` settings. The local data folders below are separate from build output and are not replaced by rebuilding.

## Data and recovery

| Location | Contents |
| --- | --- |
| `%LOCALAPPDATA%\PersonalTaskBoard\data\personal-<configuration-id>\` | Local SQLite database, reminders, tag shortcuts/order and cached tasks |
| `%LOCALAPPDATA%\PersonalTaskBoard\private\personal-<configuration-id>\workspace-v1.json` | Offline Jira snapshot and pending sync queue |
| `%LOCALAPPDATA%\PersonalTaskBoard\private\personal-<configuration-id>\attachments\` | Cached and pending attachment files |
| `%LOCALAPPDATA%\PersonalTaskBoard\private\personal-<configuration-id>\credentials.json` | Token, if saved through Connect Jira |
| `%LOCALAPPDATA%\PersonalJiraBoard\WebView2\` | Desktop browser profile and display preferences |
| `%LOCALAPPDATA%\PersonalTaskBoard\Logs\app.log` | Startup diagnostics |

These paths are outside the repository. `config/credentials.json`, database files, and generated output are already Git-ignored.

Connecting to the same Jira board on Windows retrieves synced tasks, subtasks, descriptions, priorities, workflow, comments, attachments, labels and Area assignments. Reminders, manual ordering, tag shortcuts/order, display preferences, and unsynced Mac edits do not transfer through Jira. Each computer maintains its own offline queue. Sync the Mac first before relying on the Windows copy.

## Verification

The launcher is cross-compiled for Windows during development, and the shared app and keyboard bridge are checked separately. A native Windows/WebView2 execution check is still required on a Windows PC; compiling on macOS does not verify that window, native downloads, or Windows notification delivery.
