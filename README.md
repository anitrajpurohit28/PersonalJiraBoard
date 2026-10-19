# Personal Jira Board

A small local dashboard for your Jira tasks. Create tasks and subtasks, add comments, attach files, link issues, and select multiple tasks to mark Done or delete. Tasks are assigned to you automatically, with Medium priority selected by default. No AI service or browser extension is required.

## Configuration

Before running or building, fill in `config/app.json`:

```json
{
  "email": "anitrajpurohit28@gmail.com",
  "jiraUrl": "https://anitrajpurohit28.atlassian.net/jira/software/projects/KAN/boards/2"
}
```

Put your [Jira API token](https://id.atlassian.com/manage-profile/security/api-tokens) in the private, Git-ignored `config/credentials.json`:

```json
{
  "apiToken": "your-Jira-API-token"
}
```

Only the configured email can connect. The project, issue types, columns, priorities and required fields come from Jira. Ordinary and scoped API tokens are supported; your account and token must have permission for the actions you use. `JIRA_API_TOKEN` can also be supplied in the process environment.

## Board and task details

Priorities are High, Medium and Low, with red, blue and gray card tints. Existing Jira Highest/Lowest values appear as High/Low; viewing them does not change the Jira issue. The two most recent cached Jira comments appear on each card. Subtasks sit inside their parent card and open separately when clicked. Completed subtasks stay crossed out in Active until their parent is marked Done; then the whole group moves to Done. Selecting a parent does not select its subtasks; each entry has its own bulk-selection checkbox.

Each task and subtask shows a circular count of full days since creation: green under 7 days, amber from 7–20 days, red after 20 days. Hover for the creation date. Jira tasks use their original Jira creation date; local tasks use their local creation date. If a legacy Jira creation date is unavailable, the tooltip identifies the first-tracked date used instead. **Days** sorts oldest first using the same timestamps. The indicators also work offline.

Priority sorts each column High → Medium → Low, with oldest-created tasks first within each priority. Due dates and reminders do not override Priority. Days sorting puts overdue tasks and fired reminders first, then oldest-created tasks. Due dates become overdue after the local due day ends; completed tasks do not become overdue.

Click a card's **Subtasks** header to collapse or expand its children. **Collapse all subtasks / Expand all subtasks** applies to the displayed cards. These choices are remembered on this device and do not change selection, task order or Jira data.

Click a card to open its details. Use **Details: Right / Center**, or the layout button inside task details, to choose a side panel or centered popup. The choice is remembered on this device. Set the initial layout separately in `config/ui.json`:

```json
{
  "taskDetailsPosition": "right"
}
```

The same `config/ui.json` can set `statusOrder` (Inbox, Now, Parked, Almost Done, Done) and `priorityOrder` (Low, Medium, High). Task buttons and board controls follow these display orders; additional Jira statuses stay available after the listed ones.

Use `"center"` for a centered default. This display preference does not change the account configuration or its saved tasks. The compact toolbar keeps Active/Done and sorting stacked vertically, Jira connection controls in one vertical group, and priorities in a horizontal row. Tag filters sit between the compact search field and the sorting and connection controls, in your chosen tag order. They wrap on smaller screens. Jira workflow states are shown by board columns. Task status and task priority use click buttons. Existing task edits save automatically after a short pause, and clicking outside, closing the popup or opening a subtask saves pending changes first. The popup stays open if required fields or saving need attention. The open task is highlighted on the board. Reminder follows Comments. Attachments sits at the bottom immediately above Due date, followed by the final **Delete task** action. Main task Jira IDs use a larger font than the IDs within nested subtasks.

Search matches independent words across task keys, titles, descriptions, labels, previously saved notes and updates, cached Jira comments and subtasks. A matching subtask brings up its parent card. Search uses the current Active/Done/Reminders/Overdue view and filters. **Reminders** clears the current filters and shows all entries with a reminder set, using the selected sort and their parent context. **Overdue** clears the current filters and lists unfinished tasks and subtasks whose due date is before today, with a total count on the button. Tasks due today, completed tasks and reminders without an overdue due date are excluded. Both views work with cached tasks offline. Notification permission is a separate button in Reminders. Supported examples:

- `KAN2 review` — punctuation-free key plus a word in the parent or subtask
- `"follow up" -cancelled` — an exact phrase with an exclusion
- `priority:high status:"In Progress"` — priority and workflow filters
- `label:home comment:"waiting for"` — a label and cached comment text
- `due:overdue`, `due:today`, `due:2026-10-31`, `has:comments`, `has:notes`, `is:subtask`, `is:pending`

**Cmd/Ctrl+F** or **/** focuses the board search. **Esc** clears it. Existing Jira comments become searchable after caching; comments saved here are searchable immediately while offline.

In comments, **Enter** saves and **Shift+Enter** starts a new line. Use **Add attachments** in task details to choose one or more files, up to 25 MB each.

## Install on this Mac

Requires Node.js 22.13+ and Apple's command-line developer tools to build:

```bash
npm install
npm run desktop
```

Open **Personal Jira Board** from Applications or Spotlight. It runs in its own window with a Dock icon, without a terminal or browser window. It includes Node and its runtime dependencies, so the installed app works independently of this checkout.

The installer writes `/Applications/Personal Jira Board.app` and copies the configured token into a private file in Application Support. Credentials are excluded from the app bundle. The older `PersonalTaskBoard.app` remains separate.

After changing the email or Jira URL, quit the installed app and run `npm run desktop` again. To build without installing, use `npm run desktop:build`. On another Mac, prefill the configuration and credentials before building, or enter the token through **Connect Jira**.

## Browser and Windows

For browser development, run `npm run dev` and open [localhost:3100](http://localhost:3100). `npm start` builds and runs the production version.

Windows packaging remains available through `npm run windows:build`. See [Windows setup](desktop/windows/README.md).

## Sync and local data

- Connect once while online to cache your board, account and required task fields. You can then create and edit tasks and subtasks, change priorities and workflow status, add comments, attach files and link issues while offline. There is no assignee control: tasks created or edited here are assigned to your configured account.
- Task details open with the cached summary, description, priority and workflow already filled in. Jira metadata and activity refresh in the background without replacing a draft you are editing. Cached workflow options are checked against the current board so renamed or newly added statuses do not briefly revert to an older workflow.
- Changes are saved on this device before syncing. The **Jira connected / Offline** button shows the connection in green or red. Click it to pause syncing or reconnect. An outage does not block cached tasks; the helper reconnects automatically every 15 seconds unless you explicitly pause it. Pending changes survive quitting and restarting.
- The pending-changes button shows what is waiting, blocked or needs review. Unrelated Jira edits are merged. Conflicting shared fields are held for review; you can keep your changes or discard them. If Jira may have accepted a creation, comment or upload before a connection failed, the app checks its saved marker or file content before retrying. Unconfirmed results require review instead of blindly repeating the request.
- New subtasks append at the bottom of their parent’s list. Add subtasks from their parent task and rename them directly in the parent's details. Titles save automatically, including when you click away. Subtasks use the compact `Jira ID | description` layout. Click a Jira ID to open its details in this app, or **WebJira** to open the issue on the Jira website. Subtasks are created after their parent has synced. Status changes and bulk actions use Jira workflow permissions. Jira may reject a cached field or transition if its configuration changes while you are offline; the saved change remains in the queue for review.
- Attachments added here are cached immediately, with a 25 MB limit per file. Existing Jira attachments must be downloaded once to be available offline. Existing comments and task details become available offline after they have been loaded; additional tasks are cached in the background. Card comment previews refresh automatically while the app runs.
- Deletion permanently removes selected Jira issues after confirmation and successful sync. Unselected subtasks are never deleted implicitly. Pending deletions remain in the sync queue, where they can be discarded before being sent.
- A board URL includes unassigned issues and subtasks; a site-only URL limits issues to those assigned to or reported by you. This tool covers tasks, subtasks, shared fields, workflow, comments, attachments and issue links. Backlogs, sprint planning and reports remain in Jira.
- Priority sorting uses High → Medium → Low, oldest-created first within each priority, regardless of due dates and reminders. The same sorting applies in Active, Done, Reminders and Overdue. Days sorting keeps overdue tasks and fired reminders first, then oldest tasks. Drag cards or subtasks to save a manual order on this device; both sort buttons turn off. Click Priority or Days to resume automatic sorting.
- Set reminders directly in task details. A fired reminder colors the whole task red, including nested subtasks, until you clear the reminder or choose another time. Marking a task Done clears its reminder, including bulk completion and changes synced from Jira. Reopening it does not restore the old reminder. Restarting and ordinary edits leave active reminders intact. Reminders remain listed after firing. Previously saved private notes and updates are preserved. Reminders stay on this device and are preserved during Jira sync. Offline files and queued changes belong to this installation; they do not transfer automatically between computers.

Existing data stays under `~/Library/Application Support/PersonalTaskBoard/data/<configuration>`. The offline workspace, cached files, private credentials and creation receipts live under `PersonalTaskBoard/private/<configuration>`. The macOS app's generated runtime is separate, under `PersonalJiraBoard/runtime`; diagnostics are at `~/Library/Logs/PersonalJiraBoard/app.log`.

## Code map

- `app/`: dashboard UI and local HTTP routes
- `lib/`: Jira field mapping, sync and task rules
- `db/`: local database schema and updates
- `local/`: Jira API connection, durable offline queue, cached files and private credential storage
- `config/`: account settings
- `desktop/`: macOS and Windows packaging
- `scripts/`: browser launcher
- `tests/`: task, Jira and sync checks

Validate with `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`.


Use **Tags** to create, rename or delete your own tags and assign an optional shortcut (one letter, number, `-` or `=`). Open a task or subtask and click its tag buttons, or press **Cmd + key** on Mac / **Ctrl + key** on Windows to add a tag. For example, create **Work** with shortcut **W**, then press **Cmd+W** in an open task in the Mac app. Repeated presses keep the tag assigned. Click an assigned tag to remove it. Standard cut, copy, paste, select-all, undo and quit shortcuts remain reserved. Browser-reserved shortcuts may not reach a web page; use the installed app for Cmd+W.

Tags can also be selected while creating a task. They appear on cards; click a card tag or the tag filter above the board to filter tasks, or search with `tag:work`, `tag:"personal finance"`, or `has:tags`. A matching subtask keeps its parent context. Tag names may contain spaces. Names and shortcut keys must be unique. In **Tags**, use the **↑ / ↓** buttons to choose a custom order, or **Sort A–Z** for alphabetical order. The order saves automatically and is used in every task and subtask, on card tags, and in the board tag filters. New tags are added at the bottom; renaming a tag keeps its chosen position. The order is kept across restarts and works offline.

These tags and shortcuts are private to this installation, stored in the local task database (`personal_tags` and `personal_task_tags`). They work offline, survive restarts and Jira refreshes, and stay attached when an offline task receives its Jira key. They are separate from Jira **Labels** and are never sent to Jira. Renaming a tag updates every task using it. Deleting a tag removes only that tag and its assignments, leaving the tasks intact.
