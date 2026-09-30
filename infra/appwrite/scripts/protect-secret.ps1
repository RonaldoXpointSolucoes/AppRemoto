$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$plaintext = $null
$bytes = $null
try {
    if ($args.Count -ne 0) { throw 'Arguments are not accepted' }
    Add-Type -AssemblyName System.Security
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
    $directory = Join-Path $root '.local/remote-platform'
    foreach ($path in @((Join-Path $root '.local'), $directory)) {
        if (Test-Path -LiteralPath $path) {
            if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse path refused' }
        } else {
            [void][IO.Directory]::CreateDirectory($path)
        }
    }
    $plaintext = [Console]::In.ReadToEnd()
    if ($plaintext.Length -ne 32) { throw 'Invalid input' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($plaintext)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $name = 'bootstrap-' + [Guid]::NewGuid().ToString() + '.dpapi'
    $file = [IO.File]::Open((Join-Path $directory $name), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $file.Write($protected, 0, $protected.Length); $file.Flush($true) } finally { $file.Dispose() }
    [Console]::Out.WriteLine('.local/remote-platform/' + $name)
} catch {
    [Console]::Error.WriteLine('DPAPI secret protection failed')
    exit 1
} finally {
    if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    $plaintext = $null
}
