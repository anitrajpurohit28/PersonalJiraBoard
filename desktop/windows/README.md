# PersonalTaskBoard for Windows

This folder contains the native Windows shell for PersonalTaskBoard. It uses
WinForms and Microsoft Edge WebView2 only for the desktop window; the board,
database routes, and direct Jira API connector remain the shared implementation in
the repository.

## Build on Windows

Install these prerequisites:

- Windows 10 or Windows 11
- Node.js 22.13 or newer
- .NET 8 SDK

From the repository root:

```powershell
npm install
npm run windows:build
```

The executable is created at:

```text
outputs\windows\win-x64\PersonalTaskBoard.exe
```

The build is self-contained for .NET. Current Windows 10 and Windows 11
installations normally include the Edge WebView2 Runtime; Microsoft provides a
standalone WebView2 installer for machines where it is missing.

## Run

Keep the executable in the repository's `outputs\windows` directory and
double-click it. The shell locates the repository and starts the board
on port **3120** and the Jira helper without console windows, waits for both
services, and then loads the board in the native window only (it does not open
a system browser). Processes that were already running are reused and are not
stopped when the window closes.

To place the executable elsewhere, set `PERSONAL_TASK_BOARD_PROJECT_DIR` to the
repository's full path.

## Per-user files

- Tasks and comments: `%LOCALAPPDATA%\PersonalTaskBoard\data`
- WebView2 profile: `%LOCALAPPDATA%\PersonalJiraBoard\WebView2`
- Startup log: `%LOCALAPPDATA%\PersonalTaskBoard\Logs\app.log`

No Chrome extension or open Jira tab is required. Put the Jira API token in the ignored `config/credentials.json` before starting, or enter it in **Connect Jira**. Tokens remembered through that dialog and creation receipts are stored under `%LOCALAPPDATA%\PersonalTaskBoard\private`. Credentials are never included in a desktop build.
