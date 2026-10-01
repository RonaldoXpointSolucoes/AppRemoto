param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$protected = $null
$plain = $null
try {
  $protected = [IO.File]::ReadAllBytes($Path)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} finally {
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
  if ($protected) { [Array]::Clear($protected, 0, $protected.Length) }
}
