import AppKit
import Foundation
import WebKit

// The distributable app contains both the web application and a portable Node
// runtime under Contents/Resources. Nothing here points at a developer's clone,
// so the .app can be moved to /Applications on any compatible Mac.
private let resourcesDirectory = Bundle.main.resourceURL!
private struct RuntimeSettings: Decodable {
    let desktopPort: Int
    let helperHost: String
    let helperPort: Int
    let configurationId: String
    let storageNamespace: String
    let appProtocolVersion: Int
    let helperProtocolVersion: Int
}
private let runtimeSettings = try! JSONDecoder().decode(
    RuntimeSettings.self,
    from: Data(contentsOf: resourcesDirectory.appendingPathComponent("Runtime.json"))
)
private let bundledProjectDirectory = resourcesDirectory.appendingPathComponent("app", isDirectory: true)
private let nodeExecutable = resourcesDirectory.appendingPathComponent("runtime/node")

// Source and dependencies are immutable inside a signed app. Generated Vite,
// Wrangler, and database files belong in the user's Application Support folder.
private let applicationSupportDirectory = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/PersonalJiraBoard", isDirectory: true)
private let taskDataDirectory = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/PersonalTaskBoard/data", isDirectory: true)
    .appendingPathComponent(runtimeSettings.storageNamespace, isDirectory: true)
private let runtimeStateDirectory = applicationSupportDirectory
    .appendingPathComponent("runtime", isDirectory: true)
private let buildIdentifier: String = {
    let buildIDURL = resourcesDirectory.appendingPathComponent("BuildID.txt")
    let rawValue = (try? String(contentsOf: buildIDURL, encoding: .utf8))?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? "unknown"
    return rawValue.replacingOccurrences(
        of: "[^A-Za-z0-9._-]",
        with: "-",
        options: .regularExpression
    )
}()
private let installedProjectsDirectory = runtimeStateDirectory
    .appendingPathComponent("apps", isDirectory: true)
private let projectDirectory = installedProjectsDirectory
    .appendingPathComponent(buildIdentifier, isDirectory: true)
// Browser (`npm run dev`) uses 3100. Desktop keeps a separate listener so the
// two workflows never start or share each other's board process.
private let desktopBoardPort = runtimeSettings.desktopPort
private let jiraHelperPort = runtimeSettings.helperPort
private let jiraHelperHost = runtimeSettings.helperHost
private let boardURL = URL(string: "http://localhost:\(desktopBoardPort)/")!
private let boardHealthURL = URL(string: "http://localhost:\(desktopBoardPort)/api/app-status")!
private let jiraHelperHealthURL = URL(string: "http://\(jiraHelperHost):\(jiraHelperPort)/api/jira/status")!

private let expectedBoardProtocolVersion = runtimeSettings.appProtocolVersion
private let expectedJiraHelperProtocolVersion = runtimeSettings.helperProtocolVersion

// Native key equivalents run before WebKit or window commands. Only the
// shortcuts advertised by the open task are intercepted, including Cmd-W.
private final class TagShortcutWebView: WKWebView {
    var tagShortcutKeys = Set<String>()

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        if event.type == .keyDown, modifiers == .command,
           let key = event.charactersIgnoringModifiers?.lowercased(), tagShortcutKeys.contains(key) {
            if !event.isARepeat,
               let encoded = try? JSONSerialization.data(withJSONObject: key, options: [.fragmentsAllowed]),
               let json = String(data: encoded, encoding: .utf8) {
                evaluateJavaScript("window.dispatchEvent(new CustomEvent('task-board-tag-shortcut', {detail: \(json)}))", completionHandler: nil)
            }
            return true
        }
        return super.performKeyEquivalent(with: event)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    // The WebKit view is the app's visible, browser-free board window.
    private var window: NSWindow!
    private var webView: TagShortcutWebView!

    // Only processes started by this app are stopped when the window closes.
    // Desktop never reuses or launches the browser `npm run dev` workflow.
    private var boardProcess: Process?
    private var jiraHelperProcess: Process?
    private var boardStarted = false
    private var jiraHelperStarted = false
    // Service health checks run every few seconds, but should never reload the
    // native board. Reloading creates a new React session and makes its initial
    // Jira sync appear as a disruptive screen refresh.
    private var boardLoadedInNativeWindow = false

    // Startup is asynchronous because the local board can take a few seconds
    // to prepare its D1 database. Limiting retries prevents an endless blank
    // window if Node, npm, or another local service has a real problem.
    private var startupAttempts = 0
    private var taskSounds: [String: NSSound] = [:]
    private var logHandle: FileHandle?
    private var serviceMonitorTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Use a normal macOS application policy so the icon appears in the Dock
        // and the app can be found through Spotlight like any other app.
        NSApp.setActivationPolicy(.regular)
        configureApplicationIcon()
        configureMenu()
        configureLog()
        configureWindow()
        showStartingPage()
        ensureLocalServices()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func configureApplicationIcon() {
        // Finder normally reads AppIcon.icns from Info.plist. Assigning the
        // bundled high-resolution PNG as well makes the running Dock icon
        // update immediately, even if macOS cached an older local build.
        guard
            let iconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "png"),
            let icon = NSImage(contentsOf: iconURL)
        else {
            return
        }
        NSApp.applicationIconImage = icon
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Leave separately started developer servers untouched, but clean up
        // the local processes owned by this app to avoid background servers.
        stopOwnedProcess(boardProcess)
        stopOwnedProcess(jiraHelperProcess)
        serviceMonitorTimer?.invalidate()
        try? logHandle?.close()
    }

    private func configureMenu() {
        // The native menu keeps the familiar Cmd-Q behaviour and provides an
        // explicit way to reopen the loopback board after the first launch.
        // Edit must include the standard cut/copy/paste selectors — without
        // them, WKWebView never receives Cmd-C / Cmd-V from the responder chain.
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "Quit Personal Jira Board",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(
            withTitle: "Undo",
            action: #selector(UndoManager.undo),
            keyEquivalent: "z"
        )
        editMenu.addItem(
            withTitle: "Redo",
            action: #selector(UndoManager.redo),
            keyEquivalent: "Z"
        )
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(
            withTitle: "Cut",
            action: #selector(NSText.cut(_:)),
            keyEquivalent: "x"
        )
        editMenu.addItem(
            withTitle: "Copy",
            action: #selector(NSText.copy(_:)),
            keyEquivalent: "c"
        )
        editMenu.addItem(
            withTitle: "Paste",
            action: #selector(NSText.paste(_:)),
            keyEquivalent: "v"
        )
        editMenu.addItem(
            withTitle: "Select All",
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        )
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        let boardMenuItem = NSMenuItem()
        let boardMenu = NSMenu(title: "Board")
        boardMenu.addItem(
            withTitle: "Open in Browser",
            action: #selector(openBoardInBrowser(_:)),
            keyEquivalent: "b"
        )
        boardMenuItem.submenu = boardMenu
        mainMenu.addItem(boardMenuItem)
        NSApp.mainMenu = mainMenu
    }

    @objc private func openBoardInBrowser(_ sender: Any?) {
        // `localhost` never leaves this Mac. Opening it in the default browser
        // gives users a full browser view while the native window remains open.
        NSWorkspace.shared.open(boardURL)
    }

    private func configureLog() {
        // A GUI application has no terminal window, so child-process output is
        // retained in a normal macOS log location for troubleshooting.
        let logsDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/PersonalJiraBoard", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: logsDirectory,
            withIntermediateDirectories: true
        )
        let logURL = logsDirectory.appendingPathComponent("app.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        logHandle = try? FileHandle(forWritingTo: logURL)
        _ = try? logHandle?.seekToEnd()
    }

    private func configureWindow() {
        // JavaScript is needed for the React board. New external windows are
        // handled below so Jira links open in the user's normal browser.
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.userContentController.add(self, name: "taskTagShortcuts")
        configuration.userContentController.add(self, name: "taskSounds")
        webView = TagShortcutWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1500, height: 920),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Personal Jira Board"
        window.titlebarAppearsTransparent = false
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("PersonalJiraBoardWindow")
        window.makeKeyAndOrderFront(nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let origin = message.webView?.url, origin.scheme == "http",
              origin.host == "localhost", origin.port == desktopBoardPort else { return }
        if message.name == "taskSounds", let name = message.body as? String, ["complete", "reminder"].contains(name) {
            if taskSounds[name] == nil {
                taskSounds[name] = NSSound(contentsOf: projectDirectory.appendingPathComponent("public/sounds/\(name).wav"), byReference: false)
            }
            taskSounds[name]?.stop()
            taskSounds[name]?.play()
            return
        }
        guard message.name == "taskTagShortcuts", let keys = message.body as? [String] else { return }
        let reserved: Set<String> = ["a", "c", "q", "v", "x", "z"]
        webView.tagShortcutKeys = Set(keys.filter {
            $0.range(of: "^[a-z0-9=-]$", options: .regularExpression) != nil && !reserved.contains($0)
        })
    }

    private func showStartingPage(message: String = "Starting Personal Jira Board…") {
        // Show a useful native-looking placeholder while the local services
        // start instead of presenting an empty WebKit view.
        let html = """
        <!doctype html><html><head><meta name="color-scheme" content="light dark">
        <style>
          body { margin:0; min-height:100vh; display:grid; place-items:center;
                 font:600 16px -apple-system, BlinkMacSystemFont, sans-serif;
                 color:#456067; background:#f3f6f5; }
          main { text-align:center; padding:40px; }
          .mark { width:44px; height:44px; margin:0 auto 18px; border-radius:13px;
                  display:grid; place-items:center; color:white; background:#087b75;
                  font-weight:800; letter-spacing:.04em; }
          p { margin:7px 0; color:#748187; font-size:13px; font-weight:500; }
          @media (prefers-color-scheme: dark) {
            body { color:#d9e5e8; background:#10212a; } p { color:#91a3aa; }
          }
        </style></head><body><main><div class="mark">PT</div>
        <div>\(message)</div><p>The board and Jira connection are being prepared locally.</p>
        </main></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func ensureLocalServices() {
        guard
            FileManager.default.isExecutableFile(atPath: nodeExecutable.path),
            FileManager.default.fileExists(
                atPath: bundledProjectDirectory.appendingPathComponent("vite.config.ts").path
            )
        else {
            showStartingPage(message: "This application bundle is incomplete. Rebuild and reinstall Personal Jira Board.")
            return
        }
        guard prepareWritableProject() else {
            showStartingPage(
                message: "The bundled board could not be prepared. Quit other Personal Jira Board copies and reopen the app."
            )
            return
        }

        // Reuse only compatible local services. An older app can leave its
        // board or Jira helper listening after an upgrade; checking a protocol
        // value prevents this app from silently loading that stale code.
        serviceHealthCheck(
            boardHealthURL,
            protocolKey: "appProtocolVersion",
            expectedVersion: expectedBoardProtocolVersion
        ) { [weak self] boardReady in
            guard let self else { return }
            guard let boardReady else { self.showPortConflict(desktopBoardPort); return }
            self.serviceHealthCheck(
                jiraHelperHealthURL,
                protocolKey: "protocolVersion",
                expectedVersion: expectedJiraHelperProtocolVersion
            ) { [weak self] jiraHelperReady in
                guard let self else { return }
                guard let jiraHelperReady else { self.showPortConflict(jiraHelperPort); return }
                DispatchQueue.main.async {
                    // A child can exit after a successful startup (for example
                    // after a local port conflict is resolved). Restart only
                    // the missing service rather than leaving the UI with a
                    // permanent "helper is not running" banner.
                    if !boardReady && (!self.boardStarted || self.boardProcess?.isRunning != true) {
                        self.boardStarted = true
                        self.boardProcess = self.startNodeProcess(arguments: [
                            "node_modules/vinext/dist/cli.js", "dev",
                            "--port", String(desktopBoardPort)
                        ])
                    }
                    if !jiraHelperReady && (!self.jiraHelperStarted || self.jiraHelperProcess?.isRunning != true) {
                        self.jiraHelperStarted = true
                        self.jiraHelperProcess = self.startNodeProcess(
                            arguments: ["local/jira-server.mjs"]
                        )
                    }

                    if boardReady && jiraHelperReady {
                        // Stay in the native window only. Opening the system
                        // browser is opt-in via Board → Open in Browser.
                        if !self.boardLoadedInNativeWindow {
                            self.boardLoadedInNativeWindow = true
                            self.webView.load(URLRequest(url: boardURL))
                        }
                        self.startServiceMonitor()
                        return
                    }

                    self.startupAttempts += 1
                    if self.startupAttempts >= 90 {
                        self.showStartingPage(
                            message: "The local board could not start. See ~/Library/Logs/PersonalJiraBoard/app.log."
                        )
                        return
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        self.ensureLocalServices()
                    }
                }
            }
        }
    }

    private func startServiceMonitor() {
        // The native window relies on two local processes on desktop-only
        // ports. Check them periodically after startup so an unexpected helper
        // exit repairs itself without requiring the user to quit and relaunch.
        guard serviceMonitorTimer == nil else { return }
        serviceMonitorTimer = Timer.scheduledTimer(
            withTimeInterval: 5,
            repeats: true
        ) { [weak self] _ in
            self?.ensureLocalServices()
        }
    }

    private func projectLooksComplete(at directory: URL) -> Bool {
        // Verify the files needed by the local personal board are present.
        let required = ["vite.config.ts", "lib", "config/app.json", "app", "local/jira-api.mjs"]
        return required.allSatisfy { name in
            FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path)
        }
    }

    private func prepareWritableProject() -> Bool {
        // Vite and Miniflare generate caches while they run. A notarized bundle
        // is immutable, so install the bundled web payload into a versioned,
        // per-user runtime directory on first launch. The database remains in
        // the separate data/ directory and is never replaced during upgrades.
        if projectLooksComplete(at: projectDirectory) {
            return true
        }

        // Include the process ID so two app copies opened during an upgrade do
        // not write into the same staging directory.
        let stagingDirectory = installedProjectsDirectory.appendingPathComponent(
            ".installing-\(buildIdentifier)-\(ProcessInfo.processInfo.processIdentifier)",
            isDirectory: true
        )
        do {
            try FileManager.default.createDirectory(
                at: installedProjectsDirectory,
                withIntermediateDirectories: true
            )
            if FileManager.default.fileExists(atPath: stagingDirectory.path) {
                try FileManager.default.removeItem(at: stagingDirectory)
            }
            try FileManager.default.copyItem(at: bundledProjectDirectory, to: stagingDirectory)

            // Another process may have completed the same installation while
            // this copy was in progress. Prefer its complete result; otherwise
            // replace an incomplete cache from an older bundle.
            if projectLooksComplete(at: projectDirectory) {
                try FileManager.default.removeItem(at: stagingDirectory)
                return true
            }
            if FileManager.default.fileExists(atPath: projectDirectory.path) {
                try FileManager.default.removeItem(at: projectDirectory)
            }
            try FileManager.default.moveItem(at: stagingDirectory, to: projectDirectory)

            // Do not delete older runtime copies here. A user may briefly have
            // the previous app open while launching an update; deleting its
            // source tree causes both versions to fail. Old copies are harmless
            // caches and contain no task/comment data.
            return true
        } catch {
            let line = "\n[desktop] Could not install bundled board: \(error)\n"
            if let data = line.data(using: .utf8) {
                try? logHandle?.write(contentsOf: data)
            }
            return false
        }
    }

    private func serviceHealthCheck(
        _ url: URL,
        protocolKey: String,
        expectedVersion: Int,
        completion: @escaping (Bool?) -> Void
    ) {
        // A status code alone is insufficient: an older app may still answer
        // on the same port. Confirm its protocol before considering it ready.
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            var actualVersion = 0
            var actualConfiguration = ""
            if
                let data,
                let object = try? JSONSerialization.jsonObject(with: data),
                let payload = object as? [String: Any]
            {
                actualVersion = (payload[protocolKey] as? NSNumber)?.intValue ?? 0
                actualConfiguration = payload["configId"] as? String ?? ""
            }

            if (200...299).contains(status), actualVersion == expectedVersion,
               actualConfiguration == runtimeSettings.configurationId {
                completion(true)
                return
            }

            if status != 0 {
                completion(nil)
                return
            }
            completion(false)
        }.resume()
    }

    private func showPortConflict(_ port: Int) {
        DispatchQueue.main.async {
            self.boardLoadedInNativeWindow = false
            self.showStartingPage(message: "Another app is using local port \(port). Close that app, then reopen Personal Jira Board.")
        }
    }

    private func startNodeProcess(arguments: [String]) -> Process? {
        // Use the Node executable shipped in this application. End users do
        // not need Homebrew, Node, npm, or a copy of this Git repository.
        let process = Process()
        process.executableURL = nodeExecutable
        process.arguments = arguments
        process.currentDirectoryURL = projectDirectory

        try? FileManager.default.createDirectory(
            at: runtimeStateDirectory,
            withIntermediateDirectories: true
        )
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = [
            nodeExecutable.deletingLastPathComponent().path,
            "/usr/bin",
            "/bin",
            environment["PATH"] ?? ""
        ].joined(separator: ":")
        environment["PERSONAL_TASK_BOARD_DATA_DIR"] = taskDataDirectory.path
        environment["PORT"] = String(desktopBoardPort)
        environment["WRANGLER_WRITE_LOGS"] = "false"
        environment["WRANGLER_LOG_PATH"] = runtimeStateDirectory
            .appendingPathComponent("wrangler.log").path
        environment["MINIFLARE_REGISTRY_PATH"] = runtimeStateDirectory
            .appendingPathComponent("registry").path
        environment["XDG_CACHE_HOME"] = runtimeStateDirectory
            .appendingPathComponent("cache", isDirectory: true).path
        process.environment = environment

        // Merge standard output and errors into one log. The app never exposes
        // Jira cookies, tokens, or passwords in this log; the helper keeps its
        // session values in memory only.
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            try? self?.logHandle?.write(contentsOf: data)
        }
        process.terminationHandler = { [weak self] process in
            let line = "\n[desktop] Local process exited with status \(process.terminationStatus).\n"
            if let data = line.data(using: .utf8) {
                try? self?.logHandle?.write(contentsOf: data)
            }
        }

        do {
            try process.run()
            return process
        } catch {
            let line = "\n[desktop] Could not start \(arguments.joined(separator: " ")): \(error)\n"
            if let data = line.data(using: .utf8) {
                try? logHandle?.write(contentsOf: data)
            }
            return nil
        }
    }

    private func stopOwnedProcess(_ process: Process?) {
        guard let process, process.isRunning else { return }
        process.terminate()
    }

    private func isLocalBoardURL(_ url: URL) -> Bool {
        // Only the local board is rendered in-app. Jira and other external
        // links deliberately use the system browser where corporate SSO works.
        guard let host = url.host?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1"
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if isLocalBoardURL(url) || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Target="_blank" Jira links arrive here. Hand them to macOS rather
        // than silently dropping them because this app has no browser tabs.
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.title = "Attach files"
        panel.prompt = "Attach"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        if let window = webView.window {
            panel.beginSheetModal(for: window) { response in
                completionHandler(response == .OK ? panel.urls : nil)
            }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    // Without these UIDelegate hooks, window.confirm / alert resolve as
    // cancelled (false) and History Delete / Delete this Jira appear broken.
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Personal Jira Board"
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        presentJavaScriptAlert(alert) { _ in
            completionHandler()
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Personal Jira Board"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        presentJavaScriptAlert(alert) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    private func presentJavaScriptAlert(
        _ alert: NSAlert,
        completion: @escaping (NSApplication.ModalResponse) -> Void
    ) {
        if let window, window.isVisible {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
