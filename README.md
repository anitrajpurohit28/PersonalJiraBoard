# Personal Jira Board

A small local dashboard for your Jira tasks. Create tasks and subtasks, add comments, attach files, link issues, and select multiple tasks to mark Done or delete. Tasks are assigned to you automatically. New parent tasks default to Medium priority; new subtasks inherit their parent’s priority and labels, which you can override. No AI service or browser extension is required.

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

The header shows **PersonalJiraBoard** with your verified Jira login email underneath. Before connection details load, it uses the email from `config/app.json`; the header contains no fixed personal email or board name. Only the configured email can connect. The project, issue types, columns, priorities and required fields come from Jira. Ordinary and scoped API tokens are supported; your account and token must have permission for the actions you use. `JIRA_API_TOKEN` can also be supplied in the process environment.

## Areas

Use the switcher beside **PersonalJiraBoard** to work in one Area at a time. New tasks default to the selected Area. Change **Area** in task details, or select tasks and use **Move to area…** for a bulk move. A task and its subtasks stay in one Area, including completed subtasks. Active, Done, search, tags, reminders and overdue lists respect the selected Area.

For recoverable Areas, create one **Dropdown / single-select** custom field named **Area** in your Jira project, with choices such as Work, Personal and Learn. Add the **same existing field** to both Task and Subtask in **Space settings → Work types**, then save both layouts. Either Description fields or Context fields is fine. The app discovers the field and its choices automatically; `config/app.json` still only needs email and Jira URL.

Existing local Areas migrate by matching their names to the Jira choices. If a choice is missing, the app keeps the local assignments and shows the missing names under **Areas** until you add those choices in Jira. Existing Jira parent assignments take precedence. Area moves enter the durable offline queue, update Jira's Area field when connected, and bring the subtasks with the parent. Changes made to a parent's Area directly in Jira return to the app and apply to its subtasks. Conflicting offline changes wait for review in the sync queue.

**Add, rename or remove Area choices in Jira Space settings → Fields → Area.** The app imports them automatically. Removing a choice never deletes tasks. On a fresh installation connected to the same board, Jira restores the choices and task assignments. Without a Jira Area dropdown, legacy local Areas remain available through **+ Area**.

Area tabs show the number of unfinished tasks and subtasks in each Area, regardless of board filters. Areas, tags, Priority, Sort, Active/Done and attention filters use the same selection highlight in both themes; the board keeps a neutral background. Active and Done show the matching entry counts for the selected Area and filters; hidden completed subtasks are excluded. Done cards are grouped by completion week (Monday through Sunday), newest weeks first, keeping each parent's subtasks with it. Jira's resolution date is used when available, then its status-category change date; offline completion uses the saved local time. Items without a known completion date have their own section.

## Board and task details

Priorities are High, Medium and Low, with red, blue and gray card tints. Existing Jira Highest/Lowest values appear as High/Low; viewing them does not change the Jira issue. Description offers **Text** and **To-do list** modes. In To-do list mode, add/edit items, press Enter to add another, or paste several lines. Checking an item crosses it out and moves it below unfinished items; unchecking returns it to unfinished work. These edits auto-save and queue offline. Item text and check states are stored in the Jira description as `- [ ]` / `- [x]` lines; checked lines also have Jira strikethrough formatting. Reopening or connecting from another installation restores the checklist. Switching to Text keeps the item text and removes checklist formatting. These are description items, separate from Jira subtasks and the task’s own Done status.

Pasted HTTP/HTTPS and www links are clickable in descriptions, comments and recent comment previews. Use Edit description to change its text; changes still auto-save. Links are also available below the text while typing and sync to Jira as links. The two most recent cached Jira comments appear on each card. Subtasks sit inside their parent card and open separately when clicked. Completed subtasks are crossed out, sorted after unfinished subtasks, and hidden inside a collapsed **Completed subtasks (N)** section on the board and in the parent task popup. Expand that section to view or reopen them. They stay with the parent until it is marked Done, when the whole group moves to Done. Board bulk selection excludes hidden completed subtasks. Selecting a parent does not select its subtasks; each entry has its own bulk-selection checkbox.

Each task and subtask shows a circular count of full days since creation: green under 7 days, amber from 7–20 days, red after 20 days. Hover for the creation date. Jira tasks use their original Jira creation date; local tasks use their local creation date. If a legacy Jira creation date is unavailable, the tooltip identifies the first-tracked date used instead. **Days** sorts oldest first using the same timestamps. The indicators also work offline.

Fired reminders always sort first in their column, including Priority, Days and manual sorting. A fired subtask brings its parent group to the top and appears before other unfinished subtasks. Clearing or rescheduling the reminder restores the usual order. Other tasks follow High → Medium → Low, oldest first, in Priority mode; Days puts overdue tasks before other tasks, then sorts oldest first. Due dates alone do not override Priority. Due dates become overdue after the local due day ends; completed tasks do not become overdue.

Click a card's **Subtasks** header to collapse or expand its children. **Collapse all subtasks / Expand all subtasks** applies to the displayed cards. These choices are remembered on this device and do not change task order or Jira data. Hidden completed subtasks are excluded from bulk selection.

Use the **Dark / Light** button immediately before **Reminders** to switch themes. Your choice is remembered on this device and restored when you reopen the app. The initial theme can be set with `"theme": "light"` or `"theme": "dark"` in `config/ui.json`. Both themes retain task priorities, reminder highlights and uniform Area selection.

Right-click a task or nested subtask for quick actions: open details, change status or priority, mark Done/restore, add a subtask, move a parent group to an Area, open WebJira, or delete with confirmation. The menu uses cached Jira options and the existing offline sync queue. Press Escape or click outside to dismiss; arrow keys move between actions.

Click a card to open its details. Use **Details: Right / Center**, or the layout button inside task details, to choose a side panel or centered popup. The choice is remembered on this device. Set the initial layout separately in `config/ui.json`:

```json
{
  "taskDetailsPosition": "right"
}
```

The same `config/ui.json` can set `statusOrder` (Inbox, Now, Parked, Almost Done, Done) and `priorityOrder` (Low, Medium, High). Task buttons and board controls follow these display orders; additional Jira statuses stay available after the listed ones.

Use `"center"` for a centered default. This display preference does not change the account configuration or its saved tasks. The compact toolbar keeps Active/Done and sorting stacked vertically, the Jira connection button between Details and New task, and priorities in a horizontal row. Tag filters sit between the compact search field and the sorting and priority controls, in your chosen tag order, with two tags stacked in each column. Select multiple tags to show tasks that have every selected tag (AND). For example, Work and SmallTask show only items with both tags. Each task or subtask must have all selected tags itself; parent cards may remain for context, and unrelated subtasks are hidden. Click All to clear the selection. The selected count and checkmarks show which filters are active. Tag columns wrap on smaller screens. Jira workflow states are shown by board columns. Task status and task priority use click buttons. Existing task edits save automatically after a short pause, and clicking outside, closing the popup or opening a subtask saves pending changes first. The popup stays open if required fields or saving need attention. The open task is highlighted on the board. Reminder follows Comments. Reminder and Due date use the companion board’s compact calendar popover. Reminders have scrolling 12-hour and minute columns, AM/PM buttons, hour/minute nudges and typed time entry. Type a full date/time or select it, then click Done to apply; Escape or clicking outside discards the draft. New reminders start tomorrow at the current clock time. Due date uses the same calendar and dd/mm/yyyy entry without time controls. Each Clear button sits beside its date field. Attachments is the final section below Due date and Delete task. Main task Jira IDs use a larger font than the IDs within nested subtasks.

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

Windows uses the same dashboard and Jira connector. On Windows 11 with x64 Node.js 22.13+, .NET 8 SDK and WebView2, run `npm.cmd ci`, configure the email/board URL and private API token, then `npm.cmd run windows:build` and `npm.cmd run windows:start`. Subsequent launches can use `outputs\windows\win-x64\PersonalTaskBoard.exe` inside this checkout. See [Windows setup](desktop/windows/README.md) for the full instructions, offline storage, upgrades and browser mode. Install dependencies afresh on Windows; do not copy Mac `node_modules`.

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

Tags can also be selected while creating a task. New subtasks start with all of their parent’s labels selected, including subtasks added alongside a new parent. You can change or clear the inherited tags before saving. This works offline and syncs to Jira, including boards where Labels can only be set after creation; later changes to the parent’s labels do not overwrite its subtasks’ tags. They appear on cards; click a card tag or the tag filter above the board to filter tasks, or search with `tag:work`, `tag:"personal finance"`, or `has:tags`. A matching subtask keeps its parent context. Tag names may contain spaces. Names and shortcut keys must be unique. In **Tags**, use the **↑ / ↓** buttons to choose a custom order, or **Sort A–Z** for alphabetical order. The order saves automatically and is used in every task and subtask, on card tags, and in the board tag filters. New tags are added at the bottom; renaming a tag keeps its chosen position. The order is kept across restarts and works offline.

Tags are the task editor’s single control for Jira Labels. Existing task tags migrate automatically while preserving labels already in Jira. Tag assignment, removal, rename and deletion work offline and enter the durable sync queue; reconnecting applies only the affected labels. Label changes made directly in Jira return to the app. Spaces in tag names become underscores in Jira labels; display names remain intact. The complete tag list, including unused tags, is backed up as an account property for the configured Jira board. Connecting the same account and board on a fresh installation restores the tag list and issue-label assignments. Shortcuts and chosen display order remain on each device. Areas sync through the Jira Area dropdown when configured; reminders remain local. The local database (`personal_tags` and `personal_task_tags`) caches tags and retains shortcuts, ordering and assignments while offline. Renaming a tag changes its label on this board’s cached tasks; deleting a tag removes that label and the catalog entry, keeping the tasks and other labels intact. For scoped API tokens, tag-list recovery also needs read:user.property:jira and write:user.property:jira.

## Task sounds

Marking a task or subtask Done plays a single triangle-bell strike with a natural decay after the change is saved locally. A newly fired reminder plays a triangle bell ringing for exactly 15 seconds once, remains set/red, and stays first until cleared, rescheduled or completed. Opening the app or refreshing existing Done tasks does not play completion sounds. The app must be open and the computer awake for reminders to fire. Native macOS/Windows playback uses bundled WAV files and works offline; browser playback unlocks on the first click or key press, with a blocked reminder held until that interaction. Sounds use the normal system output and volume. Regenerate the bundled sounds with `node scripts/render-task-sounds.mjs` after changing their patterns in `lib/task-sounds.mjs`.
