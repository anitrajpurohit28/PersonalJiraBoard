param(
    [ValidateSet("win-x64", "win-arm64")]
    [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$WindowsProject = Join-Path $PSScriptRoot "PersonalTaskBoard.Windows.csproj"
$IconSource = Join-Path $ProjectDirectory "desktop\assets\PersonalTaskBoard.png"
$IconOutput = Join-Path $PSScriptRoot "PersonalTaskBoard.ico"
$OutputDirectory = Join-Path $ProjectDirectory "outputs\windows\$Runtime"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw "The .NET 8 SDK is required to build the Windows app. Install it from https://dotnet.microsoft.com/download/dotnet/8.0"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
    -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js 22.13 or newer is required to run PersonalTaskBoard."
}
if (-not (Test-Path (Join-Path $ProjectDirectory "node_modules"))) {
    throw "Dependencies are missing. Run npm install before building the Windows app."
}

# Create a Windows .ico from the same source artwork used by the macOS Dock.
# System.Drawing is available in Windows PowerShell and avoids maintaining two
# independently edited logo files.
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile($IconSource)
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($source, 0, 0, 256, 256)
$iconHandle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$stream = [System.IO.File]::Create($IconOutput)
try {
    $icon.Save($stream)
}
finally {
    $stream.Dispose()
    $icon.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $source.Dispose()
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
dotnet publish $WindowsProject `
    --configuration Release `
    --runtime $Runtime `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:PublishTrimmed=false `
    --output $OutputDirectory

$instructions = @"
PersonalTaskBoard for Windows

1. Keep this output folder inside the PersonalTaskBoard repository.
2. Double-click PersonalTaskBoard.exe.
3. Put your Jira API token in config/credentials.json or enter it in Connect Jira.

Requirements at runtime:
- Node.js 22.13 or newer
- Microsoft Edge WebView2 Runtime (included with current Windows 10/11)

Personal data: %LOCALAPPDATA%\PersonalTaskBoard\data
Diagnostics:  %LOCALAPPDATA%\PersonalTaskBoard\Logs\app.log

If the executable is moved outside the repository, set the environment
variable PERSONAL_TASK_BOARD_PROJECT_DIR to the repository's full path.
"@
Set-Content -Path (Join-Path $OutputDirectory "README-Windows.txt") -Value $instructions

Write-Host "Windows app created at: $OutputDirectory\PersonalTaskBoard.exe"
