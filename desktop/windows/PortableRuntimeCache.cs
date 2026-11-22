using System.Security.Cryptography;
using System.Text;

namespace PersonalTaskBoard.Windows;

internal static class PortableRuntimeCache
{
    internal static string Prepare(string bundled, string appsDirectory, string buildId, string account)
    {
        if (buildId.Length == 0 || buildId.EndsWith('.') ||
            buildId.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '.' && c != '_'))
            throw new InvalidOperationException("Invalid application build identifier.");

        Directory.CreateDirectory(appsDirectory);
        var destination = Path.GetFullPath(Path.Combine(appsDirectory, buildId));
        var lockPath = OperatingSystem.IsWindows() ? destination.ToUpperInvariant() : destination;
        var lockId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(lockPath)));
        using var gate = new Mutex(false, $"PersonalJiraBoard.Runtime.{lockId}");
        try {
            if (!gate.WaitOne(TimeSpan.FromMinutes(3)))
                throw new IOException("Another launch is preparing the runtime. Wait for it to finish and open the app again.");
        }
        catch (AbandonedMutexException) { /* A previous launch exited mid-copy. We now own the lock. */ }

        try {
            if (!IsComplete(destination, buildId)) Publish(bundled, destination, buildId);
            var target = Path.Combine(destination, "config", "app.json");
            var accountContents = File.ReadAllBytes(account);
            if (!File.Exists(target) || !File.ReadAllBytes(target).SequenceEqual(accountContents)) {
                var temporary = $"{target}.{Guid.NewGuid():N}.tmp";
                try {
                    File.WriteAllBytes(temporary, accountContents);
                    File.Move(temporary, target, overwrite: true);
                }
                finally { TryDelete(() => File.Delete(temporary)); }
            }
            return destination;
        }
        catch (IOException error) {
            throw new IOException($"Could not prepare the app runtime at '{destination}'. Close any other Personal Jira Board windows and try again.{Environment.NewLine}{error.Message}", error);
        }
        finally { gate.ReleaseMutex(); }
    }

    private static bool IsComplete(string directory, string buildId)
    {
        if (!File.Exists(Path.Combine(directory, "node_modules", "vinext", "dist", "cli.js")) ||
            !File.Exists(Path.Combine(directory, "local", "jira-server.mjs")) ||
            !File.Exists(Path.Combine(directory, "package.json"))) return false;
        try { return File.ReadAllText(Path.Combine(directory, ".complete")) == buildId; }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
    }

    private static void Publish(string bundled, string destination, string buildId)
    {
        var staging = $"{destination}.installing-{Guid.NewGuid():N}";
        try {
            CopyDirectory(bundled, staging);
            File.WriteAllText(Path.Combine(staging, ".complete"), buildId);
            if (!IsComplete(staging, buildId))
                throw new IOException("The portable folder is incomplete. Extract the full ZIP or rebuild the app.");

            // An older launcher might publish without taking our lock.
            if (IsComplete(destination, buildId)) return;

            var previous = $"{destination}.incomplete-{Guid.NewGuid():N}";
            if (Directory.Exists(destination)) Directory.Move(destination, previous);
            else if (File.Exists(destination)) File.Move(destination, previous);

            try { Directory.Move(staging, destination); }
            catch (IOException) when (IsComplete(destination, buildId)) { /* Reuse the copy another launcher published. */ }
        }
        finally {
            if (Directory.Exists(staging)) TryDelete(() => Directory.Delete(staging, recursive: true));
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
        foreach (var directory in Directory.GetDirectories(source)) CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }

    private static void TryDelete(Action remove)
    {
        try { remove(); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
