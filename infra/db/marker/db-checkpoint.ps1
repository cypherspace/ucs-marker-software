<#
.SYNOPSIS
  Take a manual ("on-demand") backup of the production marker database before a
  risky change, then keep only the newest N manual backups (default 3).

.DESCRIPTION
  Cloud SQL deletes AUTOMATED (daily) backups by itself, using the retention count
  set on the instance (5). It never deletes ON_DEMAND backups, and has no setting
  to limit them, so this script does it: it creates a new on-demand backup, waits
  for it to succeed, and only then deletes on-demand backups older than the newest
  $Keep (so with 3 already stored, taking a new one deletes the oldest).
  Automated backups are never touched.

  Run it before a migration, a data fix or any change you might get wrong without
  noticing. The three newest manual backups are your "before the change" safety
  net; the 5 daily backups cover the last 5 days.

  Deleting a backup cannot be undone. Needs `gcloud auth login` with access to the
  ucs-marking-software project. Running it against production needs the owner's
  go-ahead (see CLAUDE.md).

.EXAMPLE
  .\infra\db\marker\db-checkpoint.ps1 -Description "Before migration 16"
  .\infra\db\marker\db-checkpoint.ps1 -PruneOnly -WhatIf   # show what would be deleted
#>
[CmdletBinding()]
param(
  [string]$Description = 'manual checkpoint',
  [ValidateRange(1, 20)][int]$Keep = 3,
  [switch]$PruneOnly,   # skip creating a new backup; just prune
  [switch]$WhatIf       # list what would be deleted, delete nothing
)

$project = 'ucs-marking-software'
$instance = 'marker-postgres'

if (-not $PruneOnly) {
  Write-Host "Creating on-demand backup of $instance ($Description)..."
  gcloud sql backups create "--instance=$instance" "--project=$project" "--description=$Description"
  if ($LASTEXITCODE -ne 0) { throw "Backup failed; nothing was pruned." }
}

# Newest first. Only successful on-demand backups count toward the keep limit.
$json = gcloud sql backups list "--instance=$instance" "--project=$project" `
  '--filter=type=ON_DEMAND AND status=SUCCESSFUL' '--sort-by=~enqueuedTime' --format=json
if ($LASTEXITCODE -ne 0) { throw "Could not list backups; nothing was pruned." }
# gcloud prints multi-line JSON; join it first (Windows PowerShell 5.1 would
# otherwise parse it line by line) and drop empty results.
$onDemand = @((($json -join "`n") | ConvertFrom-Json) | Where-Object { $_ -ne $null })

Write-Host ("{0} successful on-demand backup(s); keeping the newest {1}." -f $onDemand.Count, $Keep)
$old = @($onDemand | Select-Object -Skip $Keep)
foreach ($b in $onDemand | Select-Object -First $Keep) {
  Write-Host ("  keep   {0}  {1}  {2}" -f $b.id, $b.enqueuedTime, $b.description)
}
foreach ($b in $old) {
  if ($WhatIf) {
    Write-Host ("  WOULD DELETE {0}  {1}  {2}" -f $b.id, $b.enqueuedTime, $b.description)
  } else {
    Write-Host ("  deleting     {0}  {1}  {2}" -f $b.id, $b.enqueuedTime, $b.description)
    gcloud sql backups delete $b.id "--instance=$instance" "--project=$project" --quiet
  }
}
