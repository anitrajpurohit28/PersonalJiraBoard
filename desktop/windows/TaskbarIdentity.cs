using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace PersonalTaskBoard.Windows;

internal static class TaskbarIdentity
{
    private const string ApplicationId = "PersonalJiraBoard.Desktop";
    private const ushort VariantTypeString = 31; // VT_LPWSTR
    private static readonly Guid AppUserModelFormat = new("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private static readonly PropertyKey RelaunchCommand = new(AppUserModelFormat, 2);
    private static readonly PropertyKey RelaunchIcon = new(AppUserModelFormat, 3);
    private static readonly PropertyKey RelaunchDisplayName = new(AppUserModelFormat, 4);
    private static readonly PropertyKey AppUserModelId = new(AppUserModelFormat, 5);

    internal static void Apply(IntPtr window, string displayName)
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Launcher path unavailable.");
        var icon = GetIconPath();
        var store = GetWindowProperties(window);
        try
        {
            SetProperty(store, RelaunchCommand, $"\"{executable}\"");
            SetProperty(store, RelaunchDisplayName, displayName);
            SetProperty(store, RelaunchIcon, $"{icon},0");
            // Setting the ID notifies the taskbar, so set it after the shortcut properties.
            SetProperty(store, AppUserModelId, ApplicationId);
        }
        finally { Marshal.ReleaseComObject(store); }
    }

    internal static void Clear(IntPtr window)
    {
        var store = GetWindowProperties(window);
        try
        {
            SetProperty(store, RelaunchCommand, null);
            SetProperty(store, RelaunchDisplayName, null);
            SetProperty(store, RelaunchIcon, null);
            SetProperty(store, AppUserModelId, null);
        }
        finally { Marshal.ReleaseComObject(store); }
    }

    private static string GetIconPath()
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PersonalJiraBoard", "icons");
        using var resource = typeof(TaskbarIdentity).Assembly.GetManifestResourceStream("PersonalJiraBoard.Icon.Light.ico")
            ?? throw new InvalidOperationException("Embedded taskbar icon unavailable.");
        using var buffer = new MemoryStream();
        resource.CopyTo(buffer);
        var icon = buffer.ToArray();
        // Keep pinned shortcuts valid across builds and give new artwork a new cache key.
        var digest = Convert.ToHexString(SHA256.HashData(icon));
        var path = Path.Combine(directory, $"AppIcon-{digest}.ico");
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(directory);
            var temporary = Path.Combine(directory, $"{Guid.NewGuid():N}.tmp");
            try
            {
                File.WriteAllBytes(temporary, icon);
                File.Move(temporary, path);
            }
            catch (IOException) when (File.Exists(path)) { } // Another launcher wrote the same icon.
            finally { File.Delete(temporary); }
        }
        return path;
    }

    private static IPropertyStore GetWindowProperties(IntPtr window)
    {
        var interfaceId = typeof(IPropertyStore).GUID;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, in interfaceId, out var store));
        return store;
    }

    private static void SetProperty(IPropertyStore store, PropertyKey key, string? text)
    {
        var value = new PropertyValue();
        if (text is not null)
        {
            value.Type = VariantTypeString;
            value.String = Marshal.StringToCoTaskMemUni(text);
        }
        try { Marshal.ThrowExceptionForHR(store.SetValue(in key, in value)); }
        finally { Marshal.FreeCoTaskMem(value.String); }
    }

    [DllImport("shell32.dll", ExactSpelling = true)]
    private static extern int SHGetPropertyStoreForWindow(IntPtr window, in Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(in PropertyKey key, out PropertyValue value);
        [PreserveSig] int SetValue(in PropertyKey key, in PropertyValue value);
        [PreserveSig] int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct PropertyKey(Guid format, uint id)
    {
        private readonly Guid formatId = format;
        private readonly uint propertyId = id;
    }

    // PROPVARIANT on the supported Windows x64 and ARM64 launchers.
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropertyValue
    {
        [FieldOffset(0)] internal ushort Type;
        [FieldOffset(8)] internal IntPtr String;
    }
}
