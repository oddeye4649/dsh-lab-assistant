# Idempotent GitHub Release publisher.
# Invoked by .github/workflows/release.yml when a v* tag is pushed.
# Kept ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less UTF-8
# scripts as ANSI, which would corrupt any non-ASCII literal in this file.
# Chinese text lives in scripts/release-notes-foot.md (read explicitly as UTF-8)
# and in the Title argument supplied by the workflow (UTF-8 YAML, pwsh 7).
param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Title = '',
  [string]$NotesFile = 'RELEASE_NOTES.md',
  [string]$DistDir = 'dist',
  [string]$FootFile = 'scripts/release-notes-foot.md'
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not $Title) { $Title = "Lab Assistant $Tag" }

$pkg = @(Get-ChildItem -Path (Join-Path $DistDir '*.tgz') -ErrorAction SilentlyContinue) | Select-Object -First 1
if (-not $pkg) { throw "No .tgz found under $DistDir" }
$asset = $pkg.Name
$sha = (Get-FileHash -Path $pkg.FullName -Algorithm SHA256).Hash.ToLower()

if (-not (Test-Path $NotesFile)) { throw "Missing $NotesFile (run the CHANGELOG extraction step first)" }
if (-not (Test-Path $FootFile)) {
  $besideScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'release-notes-foot.md'
  if (Test-Path $besideScript) { $FootFile = $besideScript }
}
if (-not (Test-Path $FootFile)) { throw "Missing $FootFile" }
$notesPath = (Resolve-Path $NotesFile).Path
$footPath = (Resolve-Path $FootFile).Path

$notes = [System.IO.File]::ReadAllText($notesPath, [System.Text.Encoding]::UTF8).TrimEnd()
$foot = [System.IO.File]::ReadAllText($footPath, [System.Text.Encoding]::UTF8).TrimEnd()
# Re-running the workflow (or a manual retry) must not append the footer twice.
# The marker is the first (HTML-comment) line of the template, so this stays ASCII-only.
$marker = @($foot -split "`n" | Select-Object -First 1)[0].Trim()
if ($marker) {
  $cut = $notes.IndexOf($marker)
  if ($cut -ge 0) { $notes = $notes.Substring(0, $cut).TrimEnd() }
}
$foot = $foot.Replace('{{ASSET}}', $asset).Replace('{{SHA256}}', $sha)
$notes = $notes + "`n`n" + $foot + "`n"
[System.IO.File]::WriteAllText($notesPath, $notes, $Utf8NoBom)

# A release with the same tag may already exist (manual publish, rerun, retry).
# gh release create fails with "a release with the same tag name already exists",
# so update the existing release instead of turning the whole workflow red.
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& gh release view $Tag 2>$null | Out-Null
$exists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $previous

if ($exists) {
  Write-Host "Release $Tag already exists: update notes and replace the asset"
  & gh release edit $Tag --notes-file $NotesFile --title $Title
  if ($LASTEXITCODE -ne 0) { throw "gh release edit failed (exit $LASTEXITCODE)" }
  & gh release upload $Tag $pkg.FullName --clobber
  if ($LASTEXITCODE -ne 0) { throw "gh release upload failed (exit $LASTEXITCODE)" }
} else {
  Write-Host "Release $Tag does not exist: create it with the asset"
  & gh release create $Tag $pkg.FullName --notes-file $NotesFile --title $Title
  if ($LASTEXITCODE -ne 0) { throw "gh release create failed (exit $LASTEXITCODE)" }
}

Write-Host "Done: $Tag / $asset / sha256=$sha"
