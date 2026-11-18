import { spawn } from 'node:child_process';

// Drain both pipes continuously; verbose extractors must not exhaust execFile's maxBuffer.
export function runUpdateCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = Buffer.alloc(0);
    const collect = chunk => { tail = Buffer.concat([tail, chunk]).subarray(-32768); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Update command ${command} failed (${signal || code}). ${tail.toString('utf8').trim()}`));
    });
  });
}
export async function extractUpdateArchive(archive, destination, { platform = process.platform, run = runUpdateCommand } = {}) {
  if (platform === 'darwin') return run('/usr/bin/ditto', ['-x', '-k', archive, destination]);
  if (platform !== 'win32') throw new Error('Desktop updates require macOS or Windows.');
  // Windows 10 includes PowerShell 5.1 and .NET ZIP support. Avoid Expand-Archive's
  // per-file progress/error output, while preserving extraction failures.
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PJB_ARCHIVE, $env:PJB_UNPACK)"],
    { env: { ...process.env, PJB_ARCHIVE: archive, PJB_UNPACK: destination } });
}
