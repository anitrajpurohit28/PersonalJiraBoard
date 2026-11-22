using System;
using System.Windows.Forms;

namespace PersonalTaskBoard.Windows;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var logFile = MainForm.CreateLogPath();
        MainForm.AppendLog(logFile, $"[windows] Starting Personal Jira Board {typeof(Program).Assembly.GetName().Version} from {Environment.ProcessPath}.");
        try { Application.Run(new MainForm(logFile, Array.Exists(args, argument => argument == "--setup"))); }
        catch (OperationCanceledException) { }
        catch (Exception error)
        {
            MainForm.AppendLog(logFile, $"[windows] Startup failed: {error.Message}");
            MessageBox.Show(error.Message, "Personal Jira Board could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
