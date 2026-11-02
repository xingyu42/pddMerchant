[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9._-]{0,63}$')]
    [string]$ObservationId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9._-]{0,63}$')]
    [string]$SampleLabel,

    [Parameter(Mandatory = $true)]
    [DateTimeOffset]$BaselineUtc,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [ValidateRange(0, 600)]
    [int]$DurationSeconds = 0,

    [ValidateRange(100, 5000)]
    [int]$IntervalMilliseconds = 500,

    [string[]]$Artifact = @()
)

$ErrorActionPreference = 'Stop'

function Get-WindowState {
    param([string]$Title)

    $loginTitle = -join @([char]0x767B, [char]0x5F55)
    $workbenchTitle = -join @(
        [char]0x62FC,
        [char]0x591A,
        [char]0x591A,
        [char]0x5DE5,
        [char]0x4F5C,
        [char]0x53F0
    )
    if ([string]::IsNullOrEmpty($Title)) {
        return 'empty'
    }
    if ($Title -eq $loginTitle) {
        return 'login'
    }
    if ($Title -eq $workbenchTitle) {
        return 'workbench'
    }
    return 'other'
}

function Get-ArtifactMetadata {
    param([string[]]$Specs)

    $seenRoles = @{}
    $results = [Collections.Generic.List[object]]::new()
    foreach ($spec in $Specs) {
        $separatorIndex = $spec.IndexOf('=')
        if ($separatorIndex -lt 1 -or $separatorIndex -eq ($spec.Length - 1)) {
            throw 'Each artifact must use role=absolute-path format.'
        }

        $role = $spec.Substring(0, $separatorIndex)
        $path = $spec.Substring($separatorIndex + 1)
        if ($role -notmatch '^[a-z][a-z0-9._-]{0,63}$') {
            throw 'Artifact roles must be lowercase non-sensitive labels.'
        }
        if ($seenRoles.ContainsKey($role)) {
            throw "Duplicate artifact role: $role"
        }
        if ($path -notmatch '^(?:[A-Za-z]:[\\/]|\\\\)') {
            throw "Artifact path for role '$role' must be an absolute filesystem path."
        }
        $seenRoles[$role] = $true

        $isFile = [IO.File]::Exists($path)
        $isDirectory = [IO.Directory]::Exists($path)
        if (-not $isFile -and -not $isDirectory) {
            $results.Add([pscustomobject]@{
                role = $role
                exists = $false
                kind = 'missing'
                last_write_utc = $null
                size_bytes = $null
            }) | Out-Null
            continue
        }

        # Get-Item reads only metadata for this exact path; there is no recursion or content read.
        $item = Get-Item -LiteralPath $path -Force
        if ($item.PSProvider.Name -ne 'FileSystem') {
            throw "Artifact role '$role' did not resolve to the filesystem."
        }
        $results.Add([pscustomobject]@{
            role = $role
            exists = $true
            kind = if ($isDirectory) { 'directory' } else { 'file' }
            last_write_utc = $item.LastWriteTimeUtc.ToString('o')
            size_bytes = if ($isFile) { [long]$item.Length } else { $null }
        }) | Out-Null
    }
    return @($results)
}

function Get-ProcessSnapshot {
    param(
        [Diagnostics.Stopwatch]$Watch,
        [Collections.Generic.List[object]]$Timeline,
        [string]$PreviousSignature
    )

    $processes = @(Get-Process -Name PddWorkbench -ErrorAction SilentlyContinue)
    $states = [Collections.Generic.List[string]]::new()
    $responding = $false
    foreach ($process in $processes) {
        try {
            # The raw title is classified in memory and is never returned or written.
            $states.Add((Get-WindowState ([string]$process.MainWindowTitle))) | Out-Null
            $responding = $responding -or [bool]$process.Responding
        }
        catch {
            # A process may exit between enumeration and property access.
            $states.Add('empty') | Out-Null
        }
    }
    $states = @($states | Sort-Object -Unique)
    $signature = '{0}|{1}|{2}' -f $processes.Count, ($states -join ','), $responding
    if ($signature -ne $PreviousSignature) {
        $Timeline.Add([pscustomobject]@{
            elapsed_msec = $Watch.ElapsedMilliseconds
            process_count = $processes.Count
            window_states = $states
            any_responding = $responding
        }) | Out-Null
    }
    return $signature
}

if (-not [IO.Path]::IsPathRooted($OutputPath)) {
    throw 'OutputPath must be absolute.'
}
if (Test-Path -LiteralPath $OutputPath) {
    throw 'OutputPath already exists; refusing to overwrite evidence.'
}
$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    throw 'OutputPath parent directory does not exist.'
}

$baseline = $BaselineUtc.ToUniversalTime()
$startedAt = [DateTimeOffset]::UtcNow
if ($baseline -gt $startedAt.AddMinutes(5)) {
    throw 'BaselineUtc cannot be in the future.'
}

$artifactMetadata = @(Get-ArtifactMetadata -Specs $Artifact)
$timeline = [Collections.Generic.List[object]]::new()
$watch = [Diagnostics.Stopwatch]::StartNew()
$previousSignature = $null
$sampleCount = 0

do {
    $previousSignature = Get-ProcessSnapshot `
        -Watch $watch `
        -Timeline $timeline `
        -PreviousSignature $previousSignature
    $sampleCount += 1
    if ($watch.Elapsed.TotalSeconds -ge $DurationSeconds) {
        break
    }
    Start-Sleep -Milliseconds $IntervalMilliseconds
} while ($true)

$watch.Stop()
$observedAt = [DateTimeOffset]::UtcNow
$allStates = @($timeline | ForEach-Object { @($_.window_states) } | Sort-Object -Unique)
$sawAnyProcess = @($timeline | Where-Object { $_.process_count -gt 0 }).Count -gt 0
$sawLogin = $allStates -contains 'login'
$sawWorkbench = $allStates -contains 'workbench'
$firstStates = if ($timeline.Count -gt 0) { @($timeline[0].window_states) } else { @() }
$maxProcessCount = @($timeline | ForEach-Object { $_.process_count } | Measure-Object -Maximum)[0].Maximum
$multipleProcessesSeen = $maxProcessCount -gt 1

$outcome = if ($multipleProcessesSeen) {
    'ambiguous_multiple_processes'
} elseif (-not $sawAnyProcess) {
    'no_target_process'
} elseif ($sawWorkbench -and $sawLogin) {
    'workbench_reached_after_login_seen'
} elseif ($sawWorkbench -and ($firstStates -contains 'workbench')) {
    'workbench_only'
} elseif ($sawWorkbench) {
    'workbench_reached_without_observed_login'
} elseif ($sawLogin) {
    'login_only'
} else {
    'process_observed_without_recognized_window'
}

$result = [pscustomobject]@{
    schema_version = 1
    observation_id = $ObservationId
    sample_label = $SampleLabel
    baseline_utc = $baseline.ToString('o')
    observed_at_utc = $observedAt.ToString('o')
    elapsed_days = [Math]::Round(($observedAt - $baseline).TotalDays, 6)
    duration_seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 3)
    sample_count = $sampleCount
    timeline = @($timeline)
    artifact_metadata = $artifactMetadata
    summary = [pscustomobject]@{
        outcome = $outcome
        saw_login_window = $sawLogin
        saw_workbench_window = $sawWorkbench
        max_process_count = $maxProcessCount
        contamination_detected = $multipleProcessesSeen
        interpretation_limit = 'Window state alone does not prove protocol choice, renewal, or absence of manual interaction.'
    }
    safety = [pscustomobject]@{
        process_lifecycle_changed = $false
        registry_read_or_written = $false
        network_capture_enabled = $false
        process_memory_read = $false
        process_command_line_read = $false
        artifact_content_read = $false
        artifact_hash_calculated = $false
        recursive_enumeration = $false
        raw_window_title_written = $false
        artifact_path_written = $false
        request_or_auth_values_inspected = $false
    }
}

$temporaryPath = Join-Path `
    $outputDirectory `
    ('.{0}.{1}.tmp' -f ([IO.Path]::GetFileName($OutputPath)), [Guid]::NewGuid().ToString('N'))
try {
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $OutputPath
}
finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}
