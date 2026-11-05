# Runs what CI runs. Use -Fast while working to skip the Rust lint and format check.
param([switch]$Fast)
# Exit codes decide failure. ErrorActionPreference=Stop would make Windows PowerShell 5.1 fail on
# cargo's ordinary progress lines, which it writes to stderr.
Set-Location (Join-Path $PSScriptRoot "..")

function Step($name, [scriptblock]$run) {
  Write-Host "==> $name"
  & $run
  if ($LASTEXITCODE -ne 0) { throw "$name failed" }
}

Step "typecheck" { pnpm typecheck }
Step "test" { pnpm test }
Step "cargo test" { cargo test --manifest-path src-tauri/Cargo.toml }
if (-not $Fast) {
  Step "cargo clippy" { cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings }
  Step "cargo fmt" { cargo fmt --manifest-path src-tauri/Cargo.toml --check }
}
Write-Host "All checks passed."
