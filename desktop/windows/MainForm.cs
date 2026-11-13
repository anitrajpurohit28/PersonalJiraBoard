using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PersonalTaskBoard.Windows;

/// <summary>
/// A deliberately small native wrapper around the existing local board.
/// Keeping the application logic in one place means Windows, macOS, and the
/// browser all use the same task rules, D1 database schema, and Jira connector.
/// </summary>
internal sealed class MainForm : Form
{
    private readonly int DesktopBoardPort;
    private readonly Uri BoardUri;
    private readonly Uri BoardHealthUri;
    private readonly Uri JiraHealthUri;
    private readonly string configurationId;
    private readonly int appProtocolVersion;
    private readonly int helperProtocolVersion;
    private readonly Dictionary<string, System.Media.SoundPlayer> taskSounds = new();
    private readonly HashSet<string> tagShortcutKeys = new(StringComparer.Ordinal);
    private enum ServiceState { Missing, Ready, Conflict }

    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly HttpClient httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly string projectDirectory;
    private static readonly string nodeExecutable = File.Exists(Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe")) ? Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe") : "node.exe";
    private readonly string logFile;
    private readonly object logLock = new();
    private Process? boardProcess;
    private Process? jiraProcess;
    private bool closing;

    public MainForm()
    {
        projectDirectory = FindProjectDirectory();
        if (!File.Exists(Path.Combine(projectDirectory, "node_modules", "vinext", "dist", "cli.js")))
            throw new InvalidOperationException("Dependencies are missing. Open a terminal in the project folder and run npm.cmd ci first.");
        using var runtime = ReadRuntimeSettings(projectDirectory);
        configurationId = runtime.RootElement.GetProperty("configurationId").GetString()!;
        appProtocolVersion = runtime.RootElement.GetProperty("appProtocolVersion").GetInt32();
        helperProtocolVersion = runtime.RootElement.GetProperty("helperProtocolVersion").GetInt32();
        DesktopBoardPort = runtime.RootElement.GetProperty("desktopPort").GetInt32();
        BoardUri = new Uri($"http://localhost:{DesktopBoardPort}/");
        BoardHealthUri = new Uri($"http://localhost:{DesktopBoardPort}/api/app-status");
        JiraHealthUri = new Uri($"http://{runtime.RootElement.GetProperty("helperHost").GetString()}:{runtime.RootElement.GetProperty("helperPort").GetInt32()}/api/jira/status");
        logFile = CreateLogPath();

        Text = "Personal Jira Board";
        Width = 1500;
        Height = 920;
        MinimumSize = new Size(1040, 680);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Controls.Add(webView);

        Shown += async (_, _) => await StartApplicationAsync();
        FormClosing += (_, _) => StopOwnedServices();
    }

    private async Task StartApplicationAsync()
    {
        try
        {
            var webViewDataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PersonalJiraBoard", "WebView2");
            Directory.CreateDirectory(webViewDataDirectory);
            var webViewEnvironment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: webViewDataDirectory);
            await webView.EnsureCoreWebView2Async(webViewEnvironment);
            if (closing) return;
            ConfigureNavigation();
            ConfigureTagShortcuts();
            ShowStatusPage("Starting Personal Jira Board…",
                "The board and Jira connection are being prepared locally.");

            // A running local server may belong to an older build or another Jira account.
            var boardState = await CheckServiceAsync(BoardHealthUri, "appProtocolVersion", appProtocolVersion);
            var jiraState = await CheckServiceAsync(JiraHealthUri, "protocolVersion", helperProtocolVersion);
            RequireCompatibleService(boardState, BoardHealthUri.Port);
            RequireCompatibleService(jiraState, JiraHealthUri.Port);
            if (closing) return;
            if (boardState == ServiceState.Missing)
                boardProcess = StartHiddenProcess("node_modules/vinext/dist/cli.js", "dev", "--port", DesktopBoardPort.ToString(), "--strictPort");
            if (jiraState == ServiceState.Missing)
                jiraProcess = StartHiddenProcess("local/jira-server.mjs");

            for (var attempt = 0; attempt < 90 && !closing; attempt++)
            {
                boardState = await CheckServiceAsync(BoardHealthUri, "appProtocolVersion", appProtocolVersion);
                jiraState = await CheckServiceAsync(JiraHealthUri, "protocolVersion", helperProtocolVersion);
                RequireCompatibleService(boardState, BoardHealthUri.Port);
                RequireCompatibleService(jiraState, JiraHealthUri.Port);
                if (closing) return;
                // The helper stays healthy when Jira is offline; cached work remains usable.
                if (boardState == ServiceState.Ready && jiraState == ServiceState.Ready)
                {
                    webView.Source = BoardUri;
                    return;
                }
                if (boardProcess?.HasExited == true || jiraProcess?.HasExited == true)
                    throw new InvalidOperationException($"A local service stopped. Check {logFile}.");
                await Task.Delay(1000);
            }
            if (!closing) throw new TimeoutException($"The local services did not start in time. Check {logFile}.");
        }
        catch (Exception error)
        {
            if (closing) return;
            StopProcess(boardProcess); boardProcess = null;
            StopProcess(jiraProcess); jiraProcess = null;
            WriteLog($"[windows] Startup failed: {error}");
            var webViewHint = error.Message.Contains("WebView2", StringComparison.OrdinalIgnoreCase)
                ? " Install or update the Microsoft Edge WebView2 Runtime."
                : string.Empty;
            ShowStatusPage("Personal Jira Board could not start",
                $"{WebUtility.HtmlEncode(error.Message)}{webViewHint}");
        }
    }

    private void ConfigureNavigation()
    {
        webView.CoreWebView2.ContentLoading += (_, _) => tagShortcutKeys.Clear();
        webView.CoreWebView2.NavigationStarting += (_, eventArgs) =>
        {
            if (eventArgs.Uri == "about:blank" || IsLocalBoardAddress(eventArgs.Uri)) return;
            eventArgs.Cancel = true;
            OpenInDefaultBrowser(eventArgs.Uri);
        };
        webView.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
        {
            eventArgs.Handled = true;
            if (IsLocalBoardAddress(eventArgs.Uri))
                webView.CoreWebView2.Navigate(eventArgs.Uri); // Keep attachment downloads in WebView2.
            else OpenInDefaultBrowser(eventArgs.Uri);
        };
    }

    private bool IsLocalBoardAddress(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == Uri.UriSchemeHttp && uri.Port == DesktopBoardPort &&
            (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
             uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase));
    }

    private static void OpenInDefaultBrowser(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri)) return;
        if (uri.Scheme is not ("http" or "https")) return;
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private void ConfigureTagShortcuts()
    {
        webView.CoreWebView2.WebMessageReceived += (_, eventArgs) =>
        {
            if (!IsLocalBoardAddress(eventArgs.Source)) return;
            try
            {
                using var message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
                var body = message.RootElement;
                if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("type", out var filesType) && filesType.ValueKind == JsonValueKind.String && filesType.GetString() == "task-files")
                {
                    HandleLocalFiles(body, eventArgs.AdditionalObjects); return;
                }
                if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("type", out var updateType) && updateType.ValueKind == JsonValueKind.String && updateType.GetString() == "app-update-install")
                {
                    if (!body.TryGetProperty("jobId", out var jobId) || jobId.ValueKind != JsonValueKind.String || !Guid.TryParseExact(jobId.GetString(), "D", out var id)) return;
                    var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PersonalJiraBoard", "updates", "jobs", id.ToString());
                    try {
                        var start = new ProcessStartInfo(Path.Combine(directory, "node.exe")) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = directory };
                        start.ArgumentList.Add(Path.Combine(directory, "update-agent.mjs")); start.ArgumentList.Add(Path.Combine(directory, "job.json"));
                        Process.Start(start); Close();
                    } catch (Exception error) {
                        WriteLog($"[windows] Installer could not start: {error.Message}");
                        _ = webView.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('personal-jira-update-error', {detail:'The installer could not start. Try again.'}))");
                    }
                    return;
                }
                if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("type", out var soundType) &&
                    soundType.ValueKind == JsonValueKind.String && soundType.GetString() == "task-sound")
                {
                    if (!body.TryGetProperty("name", out var soundName) || soundName.ValueKind != JsonValueKind.String) return;
                    var name = soundName.GetString();
                    if (name is not ("complete" or "reminder")) return;
                    try {
                        if (!taskSounds.TryGetValue(name, out var player)) {
                            player = new System.Media.SoundPlayer(Path.Combine(projectDirectory, "public", "sounds", $"{name}.wav"));
                            player.Load(); taskSounds[name] = player;
                        }
                        player.Stop(); player.Play();
                    } catch (Exception error) { WriteLog($"[windows] Sound unavailable: {error.Message}"); }
                    return;
                }
                if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("type", out var type) ||
                    type.ValueKind != JsonValueKind.String || type.GetString() != "task-tag-shortcuts" ||
                    !body.TryGetProperty("keys", out var keys) || keys.ValueKind != JsonValueKind.Array) return;
                tagShortcutKeys.Clear();
                foreach (var key in keys.EnumerateArray())
                    if (key.ValueKind == JsonValueKind.String && IsTagShortcut(key.GetString()!))
                        tagShortcutKeys.Add(key.GetString()!);
            }
            catch (JsonException) { /* Ignore messages that are not shortcut registrations. */ }
        };
        var heldKeys = new HashSet<Keys>();
        webView.KeyUp += (_, eventArgs) => heldKeys.Remove(eventArgs.KeyCode);
        webView.LostFocus += (_, _) => heldKeys.Clear();
        webView.KeyDown += (_, eventArgs) =>
        {
            if (eventArgs.Modifiers != Keys.Control) return;
            var key = (int)eventArgs.KeyCode switch
            {
                >= 0x41 and <= 0x5A => ((char)((int)eventArgs.KeyCode + 32)).ToString(),
                >= 0x30 and <= 0x39 => ((char)eventArgs.KeyCode).ToString(),
                0xBD => "-", 0xBB => "=", _ => "",
            };
            var isTag = tagShortcutKeys.Contains(key);
            if (!isTag && key != "f") return;
            // Handle before returning to Chromium, then dispatch outside the synchronous callback.
            eventArgs.Handled = true;
            eventArgs.SuppressKeyPress = true;
            if (!heldKeys.Add(eventArgs.KeyCode)) return;
            var script = isTag
                ? $"window.dispatchEvent(new CustomEvent('task-board-tag-shortcut', {{ detail: {JsonSerializer.Serialize(key)} }}))"
                : "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))";
            BeginInvoke((MethodInvoker)(async () =>
            {
                if (closing || webView.CoreWebView2 is null) return;
                try { await webView.CoreWebView2.ExecuteScriptAsync(script); }
                catch (Exception error) { WriteLog($"[windows] Shortcut could not be delivered: {error.Message}"); }
            }));
        };
    }

    private void FileReply(string id, object reply)
    {
        var values = JsonSerializer.SerializeToElement(reply).EnumerateObject().ToDictionary(property => property.Name, property => (object)property.Value);
        values["requestId"] = id;
        _ = webView.CoreWebView2.ExecuteScriptAsync($"window.dispatchEvent(new CustomEvent('task-board-files-response',{{detail:{JsonSerializer.Serialize(values)}}}))");
    }
    private static string? LocalFilePath(string value)
    {
        if (value.Length > 16000 || !Uri.TryCreate(value, UriKind.Absolute, out var uri) || !uri.IsFile || uri.IsUnc || !string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return null;
        var file = uri.LocalPath;
        if (file.Length < 3 || !char.IsAsciiLetter(file[0]) || file[1] != ':' || (file[2] != '\\' && file[2] != '/') || file.IndexOf(':', 2) >= 0 || file.Any(char.IsControl)) return null;
        return Path.GetFullPath(file);
    }
    private static bool ExistingItem(string? value) => File.Exists(value) || Directory.Exists(value);
    private static string ReferenceUrl(string file) => new Uri(Directory.Exists(file) && !Path.EndsInDirectorySeparator(file) ? file + Path.DirectorySeparatorChar : file).AbsoluteUri;
    private void HandleLocalFiles(JsonElement body, IReadOnlyList<object> additionalObjects)
    {
        if (!body.TryGetProperty("requestId", out var request) || request.ValueKind != JsonValueKind.String || !Guid.TryParse(request.GetString(), out _) || !body.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String) return;
        var id = request.GetString()!;
        try {
            if (action.GetString() == "choose") {
                BeginInvoke((MethodInvoker)(() => {
                    var menu = new ContextMenuStrip();
                    menu.Items.Add("Files…", null, (_, _) => {
                        using var dialog = new OpenFileDialog { Multiselect = true, CheckFileExists = true, Title = "Link files" };
                        FileReply(id, new { files = dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileNames.Select(ReferenceUrl).ToArray() : Array.Empty<string>() });
                    });
                    menu.Items.Add("Folder…", null, (_, _) => {
                        using var dialog = new FolderBrowserDialog { Description = "Link folders", UseDescriptionForTitle = true };
                        FileReply(id, new { files = dialog.ShowDialog(this) == DialogResult.OK ? new[] { ReferenceUrl(dialog.SelectedPath) } : Array.Empty<string>() });
                    });
                    menu.Closed += (_, args) => { if (args.CloseReason != ToolStripDropDownCloseReason.ItemClicked) FileReply(id, new { files = Array.Empty<string>() }); };
                    menu.Show(Cursor.Position);
                }));
            } else if (action.GetString() == "resolve-drop") {
                var files = additionalObjects.OfType<CoreWebView2File>().Select(file => file.Path).Where(ExistingItem).Take(100).Select(ReferenceUrl).ToArray();
                FileReply(id, new { files });
            } else if (action.GetString() == "status" && body.TryGetProperty("urls", out var urls) && urls.ValueKind == JsonValueKind.Array) {
                var exists = urls.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String).Take(100).Select(value => value.GetString()!).Distinct().ToDictionary(value => value, value => ExistingItem(LocalFilePath(value)));
                FileReply(id, new { exists });
            } else if (action.GetString() == "open" && body.TryGetProperty("url", out var value) && value.ValueKind == JsonValueKind.String) {
                var file = LocalFilePath(value.GetString()!);
                if (file is null || !ExistingItem(file)) { FileReply(id, new { opened = false }); return; }
                Process.Start(new ProcessStartInfo(file) { UseShellExecute = true }); FileReply(id, new { opened = true });
            }
        } catch (Exception error) { WriteLog($"[windows] Local file request failed: {error.Message}"); FileReply(id, new { error = "The file could not be opened on this device." }); }
    }

    private static bool IsTagShortcut(string key) => key.Length == 1 &&
        "abcdefghijklmnopqrstuvwxyz0123456789-=".Contains(key, StringComparison.Ordinal) &&
        !"acqvxz".Contains(key, StringComparison.Ordinal);

    private async Task<ServiceState> CheckServiceAsync(Uri uri, string protocolKey, int expectedVersion)
    {
        try
        {
            using var response = await httpClient.GetAsync(uri);
            if (!response.IsSuccessStatusCode) return ServiceState.Conflict;
            using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = payload.RootElement;
            return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("configId", out var config) &&
                config.ValueKind == JsonValueKind.String && config.GetString() == configurationId &&
                root.TryGetProperty(protocolKey, out var version) && version.ValueKind == JsonValueKind.Number &&
                version.TryGetInt32(out var actual) && actual == expectedVersion
                ? ServiceState.Ready : ServiceState.Conflict;
        }
        catch (HttpRequestException) { return ServiceState.Missing; }
        catch (TaskCanceledException) { return ServiceState.Missing; }
        catch (JsonException) { return ServiceState.Conflict; }
    }

    private static void RequireCompatibleService(ServiceState state, int port)
    {
        if (state == ServiceState.Conflict)
            throw new InvalidOperationException($"Another app or an older build is using local port {port}. Close it, then reopen Personal Jira Board.");
    }

    private Process StartHiddenProcess(params string[] arguments)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = nodeExecutable,
                WorkingDirectory = projectDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
            EnableRaisingEvents = true,
        };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        process.OutputDataReceived += (_, eventArgs) => WriteLog(eventArgs.Data);
        process.ErrorDataReceived += (_, eventArgs) => WriteLog(eventArgs.Data);
        process.Exited += (_, _) => WriteLog("[windows] A local service exited.");
        process.StartInfo.Environment["PJB_UPDATE_TARGET"] = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        process.StartInfo.Environment["PJB_NATIVE_PID"] = Environment.ProcessId.ToString();
        process.StartInfo.Environment["PJB_UPDATE_PLATFORM"] = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture == System.Runtime.InteropServices.Architecture.Arm64 ? "win32-arm64" : "win32-x64";
        process.StartInfo.Environment["PORT"] = DesktopBoardPort.ToString();
        process.StartInfo.Environment["WRANGLER_WRITE_LOGS"] = "false";
        process.StartInfo.Environment["WRANGLER_LOG_PATH"] = Path.Combine(Path.GetDirectoryName(logFile)!, "wrangler.log");
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        WriteLog($"[windows] Started node.exe {string.Join(" ", arguments)}");
        return process;
    }

    private void StopOwnedServices()
    {
        closing = true;
        httpClient.Dispose();
        foreach (var player in taskSounds.Values) { player.Stop(); player.Dispose(); }
        taskSounds.Clear();
        StopProcess(boardProcess);
        StopProcess(jiraProcess);
    }

    private static void StopProcess(Process? process)
    {
        if (process is null) return;
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch
        {
            // The child may already have stopped between the health check and
            // window closure. There is nothing left to clean up in that case.
        }
        finally
        {
            process.Dispose();
        }
    }

    private void ShowStatusPage(string heading, string detail)
    {
        if (webView.CoreWebView2 is null)
        {
            MessageBox.Show(this, WebUtility.HtmlDecode(detail), heading, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        webView.NavigateToString($$"""
            <!doctype html><html><head><meta name="color-scheme" content="light dark">
            <style>
              body { margin:0; min-height:100vh; display:grid; place-items:center;
                     font:600 16px "Segoe UI", sans-serif; color:#456067; background:#f3f6f5; }
              main { max-width:720px; text-align:center; padding:40px; }
              .mark { width:48px; height:48px; margin:0 auto 18px; border-radius:14px;
                      display:grid; place-items:center; color:white; background:#087b75;
                      font-weight:800; letter-spacing:.04em; }
              p { margin:9px 0; color:#748187; font-size:14px; font-weight:500; }
              @media (prefers-color-scheme:dark) {
                body { color:#d9e5e8; background:#10212a; } p { color:#91a3aa; }
              }
            </style></head><body><main><div class="mark">PT</div>
            <div>{{WebUtility.HtmlEncode(heading)}}</div><p>{{detail}}</p>
            </main></body></html>
            """);
    }

    private void WriteLog(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        lock (logLock)
        {
            File.AppendAllText(logFile,
                $"{DateTimeOffset.Now:O} {line}{Environment.NewLine}");
        }
    }

    private static string CreateLogPath()
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PersonalTaskBoard", "Logs");
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, "app.log");
    }

    private static string PreparePortableProject(string bundled)
    {
        var support = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PersonalJiraBoard");
        Directory.CreateDirectory(support);
        var account = Path.Combine(support, "account.json");
        using var build = JsonDocument.Parse(File.ReadAllText(Path.Combine(bundled, "config", "build-info.json")));
        var bundledAccount = Path.Combine(bundled, "config", "app.json");
        using var settings = JsonDocument.Parse(File.ReadAllText(bundledAccount));
        if ((!File.Exists(account) || build.RootElement.GetProperty("development").GetBoolean()) && settings.RootElement.GetProperty("email").GetString() != "user@example.com") File.Copy(bundledAccount, account, true);
        if (!File.Exists(account))
        {
            using var form = new Form { Text = "Connect your Jira board", Width = 510, Height = 240, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false };
            var email = new TextBox { Left = 20, Top = 40, Width = 450, PlaceholderText = "Jira login email" };
            var url = new TextBox { Left = 20, Top = 95, Width = 450, PlaceholderText = "https://your-site.atlassian.net/jira/…/boards/2" };
            var button = new Button { Text = "Continue", Left = 360, Top = 145, Width = 110, DialogResult = DialogResult.OK };
            form.Controls.AddRange(new Control[] { new Label { Text = "Jira login email", Left = 20, Top = 15, Width = 450 }, email, new Label { Text = "Jira board URL", Left = 20, Top = 70, Width = 450 }, url, button }); form.AcceptButton = button;
            if (form.ShowDialog() != DialogResult.OK) throw new OperationCanceledException("Jira setup was cancelled.");
            File.WriteAllText(account, JsonSerializer.Serialize(new { email = email.Text, jiraUrl = url.Text }));
        }
        var buildId = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "BuildID.txt")).Trim();
        if (buildId.Length == 0 || buildId.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '.' && c != '_')) throw new InvalidOperationException("Invalid application build identifier.");
        var destination = Path.Combine(support, "runtime", "apps", buildId);
        if (!File.Exists(Path.Combine(destination, ".complete")))
        {
            var staging = destination + ".installing-" + Environment.ProcessId;
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            CopyDirectory(bundled, staging);
            File.WriteAllText(Path.Combine(staging, ".complete"), buildId);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            if (Directory.Exists(destination)) Directory.Delete(destination, true);
            Directory.Move(staging, destination);
        }
        var target = Path.Combine(destination, "config", "app.json");
        if (!File.Exists(target) || !File.ReadAllBytes(account).SequenceEqual(File.ReadAllBytes(target))) File.Copy(account, target, true);
        return destination;
    }
    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        foreach (var directory in Directory.GetDirectories(source)) CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }

    private static string FindProjectDirectory()
    {
        var bundled = Path.Combine(AppContext.BaseDirectory, "app");
        if (IsProjectDirectory(bundled) && File.Exists(Path.Combine(AppContext.BaseDirectory, "BuildID.txt"))) return PreparePortableProject(bundled);
        var configured = Environment.GetEnvironmentVariable(
            "PERSONAL_TASK_BOARD_PROJECT_DIR");
        if (IsProjectDirectory(configured)) return Path.GetFullPath(configured!);

        foreach (var startingPoint in new[]
                 {
                     AppContext.BaseDirectory,
                     Environment.CurrentDirectory,
                 })
        {
            var directory = new DirectoryInfo(startingPoint);
            while (directory is not null)
            {
                if (IsProjectDirectory(directory.FullName)) return directory.FullName;
                directory = directory.Parent;
            }
        }

        throw new DirectoryNotFoundException(
            "The PersonalTaskBoard project could not be found. Keep the app in the project's outputs\\windows folder or set PERSONAL_TASK_BOARD_PROJECT_DIR.");
    }

    private static bool IsProjectDirectory(string? directory)
    {
        return !string.IsNullOrWhiteSpace(directory) &&
            File.Exists(Path.Combine(directory, "package.json")) &&
            File.Exists(Path.Combine(directory, "local", "jira-server.mjs"));
    }

    private static JsonDocument ReadRuntimeSettings(string directory)
    {
        var start = new ProcessStartInfo(nodeExecutable)
        {
            WorkingDirectory = directory, UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardOutput = true,
        };
        start.ArgumentList.Add("--input-type=module");
        start.ArgumentList.Add("-e");
        start.ArgumentList.Add("import { localSettings, configurationId, appProtocolVersion, helperProtocolVersion } from './config/settings.mjs'; console.log(JSON.stringify({ ...localSettings, configurationId, appProtocolVersion, helperProtocolVersion }));");
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Node.js could not start.");
        if (!process.WaitForExit(10000))
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException("The local app configuration could not be read.");
        }
        if (process.ExitCode != 0) throw new InvalidOperationException("Check config/app.json and your Node.js installation.");
        return JsonDocument.Parse(process.StandardOutput.ReadToEnd());
    }
}
