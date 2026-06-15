param(
    [string]$SecretPath = "data\secrets\cartesia_api_key"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$target = Join-Path $root $SecretPath
$targetDir = Split-Path -Parent $target

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$secret = Read-Host "Paste Cartesia API key" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($plain)) {
        throw "Cartesia API key cannot be empty."
    }
    [System.IO.File]::WriteAllText($target, $plain.Trim(), [System.Text.UTF8Encoding]::new($false))
}
finally {
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Write-Host "Cartesia API key saved to the local Docker-mounted secret file."
Write-Host "No key value was printed. Re-open /api/voice/config or run the provider probe to verify readiness."
