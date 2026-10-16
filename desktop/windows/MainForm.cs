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

    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly HttpClient httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly string projectDirectory;
    private readonly string logFile;
    private readonly object logLock = new();
    private Process? boardProcess;
    private Process? jiraProcess;
    private bool closing;

    public MainForm()
    {
        projectDirectory = FindProjectDirectory();
        using var runtime = ReadRuntimeSettings(projectDirectory);
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
            ConfigureNavigation();
            ShowStatusPage("Starting Personal Jira Board…",
                "The board and Jira connection are being prepared locally.");

            if (!await IsHealthyAsync(BoardHealthUri))
            {
                boardProcess = StartHiddenProcess("node.exe", $"node_modules/vinext/dist/cli.js dev --port {DesktopBoardPort}");
            }
            if (!await IsHealthyAsync(JiraHealthUri))
            {
                jiraProcess = StartHiddenProcess("node.exe", "local/jira-server.mjs");
            }

            for (var attempt = 0; attempt < 90 && !closing; attempt++)
            {
                var boardReady = await IsHealthyAsync(BoardHealthUri);
                var jiraReady = await IsHealthyAsync(JiraHealthUri);
                if (boardReady && jiraReady)
                {
                    webView.Source = BoardUri;
                    return;
                }
                await Task.Delay(1000);
            }

            ShowStatusPage("PersonalTaskBoard could not start",
                $"Check the diagnostics at {WebUtility.HtmlEncode(logFile)}.");
        }
        catch (Exception error)
        {
            WriteLog($"[windows] Startup failed: {error}");
            var webViewHint = error.Message.Contains("WebView2", StringComparison.OrdinalIgnoreCase)
                ? " Install or update the Microsoft Edge WebView2 Runtime."
                : string.Empty;
            ShowStatusPage("PersonalTaskBoard could not start",
                $"{WebUtility.HtmlEncode(error.Message)}{webViewHint}");
        }
    }

    private void ConfigureNavigation()
    {
        webView.CoreWebView2.NavigationStarting += (_, eventArgs) =>
        {
            if (IsLocalBoardAddress(eventArgs.Uri)) return;
            eventArgs.Cancel = true;
            OpenInDefaultBrowser(eventArgs.Uri);
        };
        webView.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
        {
            eventArgs.Handled = true;
            OpenInDefaultBrowser(eventArgs.Uri);
        };
    }

    private static bool IsLocalBoardAddress(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme == "about") return true;
        return uri.Scheme == Uri.UriSchemeHttp &&
            (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
             uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase));
    }

    private static void OpenInDefaultBrowser(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri)) return;
        if (uri.Scheme is not ("http" or "https")) return;
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private async Task<bool> IsHealthyAsync(Uri uri)
    {
        try
        {
            using var response = await httpClient.GetAsync(uri);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private Process StartHiddenProcess(string executable, string arguments)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = executable,
                Arguments = arguments,
                WorkingDirectory = projectDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
            EnableRaisingEvents = true,
        };
        process.OutputDataReceived += (_, eventArgs) => WriteLog(eventArgs.Data);
        process.ErrorDataReceived += (_, eventArgs) => WriteLog(eventArgs.Data);
        process.Exited += (_, _) =>
            WriteLog($"[windows] {executable} exited with code {process.ExitCode}.");
        process.StartInfo.Environment["PORT"] = DesktopBoardPort.ToString();
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        WriteLog($"[windows] Started {executable} {arguments}");
        return process;
    }

    private void StopOwnedServices()
    {
        closing = true;
        httpClient.Dispose();
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
        if (webView.CoreWebView2 is null) return;
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

    private static string FindProjectDirectory()
    {
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
        var start = new ProcessStartInfo("node.exe")
        {
            WorkingDirectory = directory, UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardOutput = true,
        };
        start.ArgumentList.Add("--input-type=module");
        start.ArgumentList.Add("-e");
        start.ArgumentList.Add("import { localSettings } from './config/settings.mjs'; console.log(JSON.stringify(localSettings));");
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
