param(
    [ValidateSet("win-x64", "win-arm64")]
    [string]$Runtime,
    [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
    [string]$BuildName,
    [switch]$UseLocalAccount
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$WindowsProject = Join-Path $PSScriptRoot "PersonalTaskBoard.Windows.csproj"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw "Install the .NET SDK (8 or later) to build the Windows app: https://dotnet.microsoft.com/download"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22.16 or newer is required to run Personal Jira Board."
}
$NodeInfo = & node -p 'JSON.stringify({ version: process.versions.node, arch: process.arch })'
if ($LASTEXITCODE -ne 0) { throw "Node.js could not start." }
$NodeInfo = $NodeInfo | ConvertFrom-Json
if ([version]$NodeInfo.version -lt [version]"22.16.0") { throw "Install Node.js 22.16 or newer, then reopen the terminal." }
# Portable packages currently bundle x64 Node for both native shell architectures.
if ($NodeInfo.arch -ne "x64") { throw "Install the Windows x64 version of Node.js. The portable package currently bundles x64 Node (including on ARM PCs)." }
if (-not $Runtime) { $Runtime = "win-x64" }
if ($Runtime -notin @("win-x64", "win-arm64")) { throw "Only x64 and ARM64 Windows builds are supported." }
if (-not (Test-Path (Join-Path $ProjectDirectory "node_modules\vinext\dist\cli.js"))) {
    throw "Dependencies are missing. Run npm.cmd ci in the project folder before building the Windows app."
}
# Named local builds leave the existing portable app untouched. Release builds
# retain the standard architecture-specific path expected by release packaging.
if ($UseLocalAccount -and $env:PJB_RELEASE_BUILD -eq "1") {
    throw "Release builds must use the neutral account configuration."
}
if ($BuildName -and $env:PJB_RELEASE_BUILD -eq "1") {
    throw "Named output folders are for local builds only. Release builds use the standard output folder."
}
$OutputFolder = if ($BuildName) { "$Runtime-$BuildName" } else { $Runtime }
$OutputDirectory = Join-Path $ProjectDirectory "outputs\windows\$OutputFolder"

# Windows cannot replace a running executable. Check before publishing; never stop the user's app or discard unsaved edits automatically.
$OutputExecutable = Join-Path $OutputDirectory "PersonalTaskBoard.exe"
if (Test-Path -LiteralPath $OutputExecutable) {
    try {
        $OutputProbe = [System.IO.File]::Open($OutputExecutable, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $OutputProbe.Dispose()
    }
    catch {
        $LockReason = $_.Exception.GetBaseException().Message
        throw "Cannot replace '$OutputExecutable'. Windows reported: $LockReason Finish your edits and close the app, or build into a separate folder with: npm run windows:build -- -BuildName fresh. If 'fresh' is already in use, choose another name. No running process was stopped."
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Push-Location $ProjectDirectory
try { $AppVersion = & node scripts/stamp-version.mjs; if ($LASTEXITCODE -ne 0) { throw "Version stamping failed." } }
finally { Pop-Location }
& dotnet publish $WindowsProject `
    --configuration Release `
    --runtime $Runtime `
    --self-contained true `
    -p:Version=$AppVersion `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:PublishTrimmed=false `
    --output $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw "Windows compilation failed. See the dotnet error above." }
if (-not (Test-Path (Join-Path $OutputDirectory "PersonalTaskBoard.exe"))) { throw "The Windows executable was not created." }

Push-Location $ProjectDirectory
try {
    $PackagingArgs = @($OutputDirectory)
    if ($UseLocalAccount) { $PackagingArgs += "--use-local-account" }
    & node scripts/package-windows-runtime.mjs @PackagingArgs
    if ($LASTEXITCODE -ne 0) { throw "Runtime packaging failed." }
}
finally { Pop-Location }
Write-Host "Portable Windows app created at: $OutputDirectory\PersonalTaskBoard.exe"
