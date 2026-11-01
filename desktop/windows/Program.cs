using System;
using System.Windows.Forms;

namespace PersonalTaskBoard.Windows;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        try { Application.Run(new MainForm()); }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Personal Jira Board could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
