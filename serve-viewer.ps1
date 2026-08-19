param(
    [string]$HostAddress = '127.0.0.1',
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$ProjectPrefix = $ProjectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$AssetRoot = Join-Path $ProjectRoot 'assets'
$ExportRoot = Join-Path $ProjectRoot 'exports'
$TranslationRoot = Join-Path $ProjectRoot 'translations'
$SpeakerRoot = Join-Path $ProjectRoot 'speaker'
$SpeakerCsv = Join-Path $SpeakerRoot 'speaker.csv'
$MetadataRoot = Join-Path $ProjectRoot 'metadata'
$ScenarioMetadataCache = Join-Path $MetadataRoot 'scenario-titles.json'
$LibraryGroupMetadataCache = Join-Path $MetadataRoot 'scenario-library-groups.json'
# LOCAL_MONITOR_BEGIN
$MonitorRoot = Join-Path $ProjectRoot 'monitor'
$MonitorState = Join-Path $MonitorRoot 'game-update-state.json'
# LOCAL_MONITOR_END
$BaseUrl = "http://${HostAddress}:$Port"
$AppUrl = "$BaseUrl/app.html"
$MaxBodySize = 128MB
$MaxExternalCardSize = 32MB
$MaxExternalMovieSize = 192MB
$CommunityCardRoot = 'https://cf-static.shinycolors.moe'
$RemoteScenarioRoots = @(
    'https://service.sc-viewer.top/custom/json',
    'https://service.sc-viewer.top/convert/cache/json'
)
$MaxHeaderSize = 64KB
$Utf8 = New-Object Text.UTF8Encoding($false)
$Ascii = [Text.Encoding]::ASCII
$AllowedAssetRoots = @('images', 'json', 'movies', 'particles', 'sounds', 'spine')
Add-Type -AssemblyName System.IO.Compression
# LOCAL_MONITOR_BEGIN
$MaxMonitorEntries = 20000
$MonitorStateVersion = 6
$MonitorV3RecoveryUpdates = [ordered]@{
    '2026-08-07T06:00:00Z' = @(
        'produce_events/201002001', 'produce_events/201002002', 'produce_events/201002003',
        'produce_events/201002004', 'produce_events/201002011',
        'produce_events/300402701', 'produce_events/300402702',
        'produce_events/300502501', 'produce_events/300502502',
        'produce_events/301302801',
        'produce_events/301602701', 'produce_events/301602702',
        'special_communications/4902008013'
    )
}
# LOCAL_MONITOR_END

function Test-SafeKey([object]$Value, [string]$Label) {
    $text = ([string]$Value).Trim()
    if ($text -notmatch '^[A-Za-z0-9_-]+$') { throw "Invalid ${Label}: '$text'" }
    return $text
}

function Ensure-Directory([string]$Path) {
    if (-not [IO.Directory]::Exists($Path)) { [IO.Directory]::CreateDirectory($Path) | Out-Null }
}

function Ensure-SpeakerArchive {
    Ensure-Directory $SpeakerRoot
    if (-not [IO.File]::Exists($SpeakerCsv)) {
        [IO.File]::WriteAllText($SpeakerCsv, "name,trans`n", $Utf8)
    }
}

function Escape-CsvCell([object]$Value) {
    $text = [string]$Value
    if ($text -match '[,"\r\n]') { return '"' + $text.Replace('"', '""') + '"' }
    return $text
}

function Read-SpeakerRows {
    Ensure-SpeakerArchive
    $rows = @()
    foreach ($row in (Import-Csv -LiteralPath $SpeakerCsv -Encoding UTF8)) {
        $name = ([string]$row.name).Trim()
        $trans = ([string]$row.trans).Trim()
        if ($name) { $rows += [PSCustomObject]@{ name = $name; trans = $trans } }
    }
    return $rows
}

function Write-SpeakerRows([object[]]$Updates) {
    $orderedNames = New-Object Collections.Generic.List[string]
    $mapping = New-Object 'Collections.Generic.Dictionary[string,string]'
    foreach ($row in (Read-SpeakerRows)) {
        if (-not $mapping.ContainsKey($row.name)) { $orderedNames.Add($row.name) }
        $mapping[$row.name] = $row.trans
    }
    foreach ($row in $Updates) {
        $name = ([string]$row.name).Trim()
        $trans = ([string]$row.trans).Trim()
        if (-not $name -or -not $trans) { continue }
        if (-not $mapping.ContainsKey($name)) { $orderedNames.Add($name) }
        $mapping[$name] = $trans
    }

    $lines = New-Object Collections.Generic.List[string]
    $lines.Add('name,trans')
    foreach ($name in $orderedNames) {
        $lines.Add("$(Escape-CsvCell $name),$(Escape-CsvCell $mapping[$name])")
    }
    $temporary = "$SpeakerCsv.tmp-$PID"
    [IO.File]::WriteAllText($temporary, (($lines -join "`n") + "`n"), $Utf8)
    Move-Item -LiteralPath $temporary -Destination $SpeakerCsv -Force
    return Read-SpeakerRows
}

function Write-AtomicText([string]$Destination, [string]$Content) {
    Ensure-Directory ([IO.Path]::GetDirectoryName($Destination))
    $temporary = "$Destination.tmp-$PID"
    [IO.File]::WriteAllText($temporary, $Content, $Utf8)
    Move-Item -LiteralPath $temporary -Destination $Destination -Force
}

function Write-AtomicBytes([string]$Destination, [byte[]]$Content) {
    Ensure-Directory ([IO.Path]::GetDirectoryName($Destination))
    $temporary = "$Destination.tmp-$PID"
    [IO.File]::WriteAllBytes($temporary, $Content)
    Move-Item -LiteralPath $temporary -Destination $Destination -Force
}

# LOCAL_MONITOR_BEGIN
function New-MonitorState {
    return [ordered]@{
        version = $MonitorStateVersion
        initialized = $false
        initializedAt = ''
        lastObservedAt = ''
        assetVersion = ''
        entries = @{}
        metadata = @{}
        cardResources = @{}
        listenerStatus = @{}
        lastEnrichmentAt = ''
        enrichmentStatus = @{}
    }
}

function ConvertTo-MonitorHashtable([object]$Value) {
    $result = @{}
    if ($null -eq $Value) { return $result }
    if ($Value -is [Collections.IDictionary]) {
        foreach ($key in $Value.Keys) { $result[[string]$key] = $Value[$key] }
    } else {
        foreach ($property in $Value.PSObject.Properties) { $result[$property.Name] = $property.Value }
    }
    return $result
}

function Update-MonitorStateSchema([object]$State, [int]$PreviousVersion) {
    if ($PreviousVersion -lt 4) {
        foreach ($row in $State.entries.Values) {
            if (([string]$row.updateKind) -eq 'implementation' -and ([string]$row.metadataSource) -eq 'shinycolors.moe') {
                $row.unread = $false
                $row.updateDetectedAt = ''
                $row.updateKind = 'baseline'
                $row.implementationChanges = ''
            }
        }
        foreach ($detectedAt in $MonitorV3RecoveryUpdates.Keys) {
            foreach ($key in $MonitorV3RecoveryUpdates[$detectedAt]) {
                if (-not $State.entries.ContainsKey($key)) { continue }
                $row = $State.entries[$key]
                $row.updateDetectedAt = $detectedAt
                $row.updateKind = 'recovered'
                $row.implementationChanges = ''
                $row.unread = $false
                if (([string]$row.eventId) -eq '301302801') {
                    $row.staticCardStatus = 'missing'
                    $row.dynamicCardStatus = 'not-applicable'
                    $row.implementationSource = 'baseline-recovery'
                    $row.updateKind = 'preload'
                }
            }
        }
    }
    if ($PreviousVersion -lt 5) {
        foreach ($row in $State.entries.Values) {
            if (([string]$row.updateKind) -eq 'implementation' -and ([string]$row.implementationChanges) -eq '页游实装状态') {
                $row.unread = $false
                $row.updateDetectedAt = ''
                $row.updateKind = 'baseline'
                $row.implementationChanges = ''
            }
        }
        foreach ($detectedAt in $MonitorV3RecoveryUpdates.Keys) {
            foreach ($key in $MonitorV3RecoveryUpdates[$detectedAt]) {
                if (-not $State.entries.ContainsKey($key)) { continue }
                $row = $State.entries[$key]
                $row.updateDetectedAt = $detectedAt
                $row.unread = $false
                $row.implementationChanges = ''
                $row.updateKind = $(if (([string]$row.eventId) -eq '301302801') { 'preload' } else { 'recovered' })
            }
        }
    }
    if ($PreviousVersion -lt 6) {
        foreach ($row in $State.entries.Values) {
            if (([string]$row.updateKind) -eq 'implementation') {
                $row.unread = $false
                $row.updateDetectedAt = ''
                $row.updateKind = 'baseline'
                $row.implementationChanges = ''
            }
        }
        foreach ($detectedAt in $MonitorV3RecoveryUpdates.Keys) {
            foreach ($key in $MonitorV3RecoveryUpdates[$detectedAt]) {
                if (-not $State.entries.ContainsKey($key)) { continue }
                $row = $State.entries[$key]
                $row.updateDetectedAt = $detectedAt
                $row.unread = $false
                $row.implementationChanges = ''
                $stillPreloaded = ([string]$row.eventId) -eq '301302801' -and ([string]$row.staticCardStatus) -ne 'available'
                $row.updateKind = $(if ($stillPreloaded) { 'preload' } else { 'recovered' })
            }
        }
    }
    $State.version = $MonitorStateVersion
    return $State
}

function Read-MonitorState {
    if (-not [IO.File]::Exists($MonitorState)) { return New-MonitorState }
    try {
        $raw = [IO.File]::ReadAllText($MonitorState, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $state = New-MonitorState
        foreach ($name in @('version', 'initialized', 'initializedAt', 'lastObservedAt', 'assetVersion', 'lastEnrichmentAt')) {
            if ($raw.PSObject.Properties.Name -contains $name) { $state[$name] = $raw.$name }
        }
        if ($null -ne $raw.listenerStatus) { $state.listenerStatus = ConvertTo-MonitorHashtable $raw.listenerStatus }
        if ($null -ne $raw.enrichmentStatus) { $state.enrichmentStatus = ConvertTo-MonitorHashtable $raw.enrichmentStatus }
        $state.entries = @{}
        if ($null -ne $raw.entries) {
            foreach ($property in $raw.entries.PSObject.Properties) {
                $state.entries[$property.Name] = ConvertTo-MonitorHashtable $property.Value
            }
        }
        $state.metadata = @{}
        if ($null -ne $raw.metadata) {
            foreach ($property in $raw.metadata.PSObject.Properties) {
                $state.metadata[$property.Name] = ConvertTo-MonitorHashtable $property.Value
            }
        }
        $state.cardResources = @{}
        if ($null -ne $raw.cardResources) {
            foreach ($property in $raw.cardResources.PSObject.Properties) {
                $state.cardResources[$property.Name] = ConvertTo-MonitorHashtable $property.Value
            }
        }
        $previousVersion = $(if ($null -ne $raw.version) { [int]$raw.version } else { 1 })
        return Update-MonitorStateSchema $state $previousVersion
    } catch {
        return New-MonitorState
    }
}

function Write-MonitorState([object]$State) {
    $content = ($State | ConvertTo-Json -Depth 64) + "`n"
    Write-AtomicText $MonitorState $content
}

function ConvertTo-ValidatedMonitorRow([object]$Value) {
    if ($null -eq $Value) { throw 'monitor entry must be an object' }
    $source = ConvertTo-MonitorHashtable $Value
    $eventType = Test-SafeKey $source.eventType 'eventType'
    $eventId = Test-SafeKey $source.eventId 'eventId'
    $row = @{ eventType = $eventType; eventId = $eventId; key = "$eventType/$eventId" }
    foreach ($name in @(
        'path', 'characterId', 'characterName', 'characterNameJp', 'cardType',
        'cardSequence', 'storySequence', 'cardId', 'cardName', 'cardRarity', 'storyTitle', 'metadataSource',
        'scenarioStatus', 'metadataStatus', 'cardNameStatus', 'storyTitleStatus',
        'staticCardStatus', 'dynamicCardStatus', 'staticCardMirrorStatus', 'dynamicCardMirrorStatus',
        'staticCardSyncStatus', 'dynamicCardSyncStatus', 'staticCardPath', 'dynamicCardPath',
        'staticCardSaved', 'dynamicCardSaved', 'implementationSource', 'updateKind', 'implementationChanges',
        'implementationAuditAt'
    )) {
        $text = ([string]$source[$name]).Trim()
        if ($text.Length -gt 500) { throw "monitor field is too long: $name" }
        if ($text) { $row[$name] = $text }
    }
    return $row
}

function Merge-MonitorRows([object]$Base, [object]$Extra) {
    $result = ConvertTo-MonitorHashtable $Base
    foreach ($key in (ConvertTo-MonitorHashtable $Extra).Keys) {
        $value = (ConvertTo-MonitorHashtable $Extra)[$key]
        if ($null -ne $value -and ([string]$value) -ne '') { $result[$key] = $value }
    }
    return $result
}

function ConvertTo-ValidatedCardResource([object]$Value) {
    $source = ConvertTo-MonitorHashtable $Value
    $cardType = ([string]$source.cardType).Trim()
    if ($cardType -notin @('Produce', 'Support')) { throw 'invalid monitor card resource type' }
    $cardId = Test-SafeKey $source.cardId 'cardId'
    $row = @{ key = "$cardType/$cardId"; cardType = $cardType; cardId = $cardId }
    foreach ($name in @(
        'staticCardStatus', 'dynamicCardStatus', 'staticCardPath', 'dynamicCardPath',
        'staticCardSyncStatus', 'dynamicCardSyncStatus', 'staticCardSaved', 'dynamicCardSaved',
        'implementationSource'
    )) {
        $text = ([string]$source[$name]).Trim()
        if ($text.Length -gt 500) { throw "monitor card resource field is too long: $name" }
        if ($text) { $row[$name] = $text }
    }
    return $row
}

function Add-MonitorCardLibraryFields([object]$Row, [object]$Cards) {
    $source = ConvertTo-MonitorHashtable $Row
    $eventType = ([string]$source.eventType).Trim()
    $eventId = ([string]$source.eventId).Trim()
    if ($eventType -ne 'produce_events' -or $eventId -notmatch '^[23]\d{8}$') { return $source }
    $cardMap = ConvertTo-MonitorHashtable $Cards
    $groupId = $eventId.Substring(0, 7)
    if (-not $cardMap.ContainsKey($groupId)) { return $source }
    $card = ConvertTo-MonitorHashtable $cardMap[$groupId]
    if (([string]$card.source) -eq 'shinycolors.moe/idolInfo') { return $source }
    foreach ($name in @('cardId', 'cardName', 'cardType', 'characterId', 'characterName')) {
        $value = ([string]$card[$name]).Trim()
        if ($value -and -not ([string]$source[$name]).Trim()) { $source[$name] = $value }
    }
    return $source
}

function Add-MonitorCardResource([object]$State, [object]$Row, [bool]$OfficialInventoryComplete = $false) {
    $source = ConvertTo-MonitorHashtable $Row
    $cardType = ([string]$source.cardType).Trim()
    $cardId = ([string]$source.cardId).Trim()
    if (-not $cardType -or -not $cardId) { return $source }
    $key = "$cardType/$cardId"
    if ($State.cardResources.ContainsKey($key)) { return Merge-MonitorRows $source $State.cardResources[$key] }
    if ($OfficialInventoryComplete) {
        $source.staticCardStatus = 'missing'
        $source.dynamicCardStatus = $(if ($cardType -eq 'Produce') { 'missing' } else { 'not-applicable' })
        $source.implementationSource = 'official-game-asset-map'
    }
    return $source
}

function Get-MonitorPublicState([object]$State, [int]$Limit = $MaxMonitorEntries) {
    $items = @($State.entries.Values | Sort-Object `
        @{ Expression = { if ($_.unread) { 1 } else { 0 } }; Descending = $true }, `
        @{ Expression = { [string]$_.firstSeenAt }; Descending = $true }, `
        @{ Expression = { [string]$_.key }; Descending = $true })
    $unread = @($items | Where-Object { $_.unread }).Count
    return [ordered]@{
        initialized = [bool]$State.initialized
        initializedAt = [string]$State.initializedAt
        lastObservedAt = [string]$State.lastObservedAt
        assetVersion = [string]$State.assetVersion
        totalCount = $items.Count
        unreadCount = $unread
        items = @($items | Select-Object -First $Limit)
        listenerStatus = $State.listenerStatus
        lastEnrichmentAt = [string]$State.lastEnrichmentAt
        enrichmentStatus = $State.enrichmentStatus
    }
}

function Get-MonitorImplementationChanges([object]$Old, [object]$New) {
    $before = ConvertTo-MonitorHashtable $Old
    $after = ConvertTo-MonitorHashtable $New
    $labels = [ordered]@{
        cardName = '卡名'; storyTitle = '单话标题'; metadataStatus = '卡片主数据'
        staticCardStatus = '页游静态卡图'; dynamicCardStatus = '页游动态卡图'
        staticCardMirrorStatus = '资料站静态卡图'; dynamicCardMirrorStatus = '资料站动态卡图'
        staticCardSyncStatus = '静态卡图本地同步'; dynamicCardSyncStatus = '动态卡图本地同步'
    }
    $changes = New-Object Collections.Generic.List[string]
    foreach ($key in $labels.Keys) {
        $oldText = ([string]$before[$key]).Trim()
        $newText = ([string]$after[$key]).Trim()
        if (-not $newText -or $oldText -eq $newText) { continue }
        if ($key -in @('cardName', 'storyTitle')) {
            $changes.Add($(if ($oldText) { "$($labels[$key])更新" } else { $labels[$key] }))
        } elseif ($newText -in @('available', 'synced')) {
            $changes.Add($labels[$key])
        }
    }
    return @($changes)
}

function Save-GameUpdateStatus([object]$Payload) {
    $allowed = @(
        'script-started', 'webpack-captured', 'webpack-missed', 'asset-map-found',
        'asset-map-missing', 'empty-asset-map', 'scan-error', 'baseline-sent',
        'local-http-error'
    )
    $stage = ([string]$Payload.stage).Trim()
    if ($stage -notin $allowed) { throw 'unsupported listener status' }
    $message = ([string]$Payload.message).Trim()
    if ($message.Length -gt 500) { $message = $message.Substring(0, 500) }
    $scriptVersion = ([string]$Payload.scriptVersion).Trim()
    if ($scriptVersion.Length -gt 50) { $scriptVersion = $scriptVersion.Substring(0, 50) }
    $pageUrl = ([string]$Payload.pageUrl).Trim()
    if ($pageUrl.Length -gt 1000) { $pageUrl = $pageUrl.Substring(0, 1000) }
    $status = @{
        stage = $stage
        message = $message
        scriptVersion = $scriptVersion
        pageUrl = $pageUrl
        reportedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    if ($null -ne $Payload.details) { $status.details = ConvertTo-MonitorHashtable $Payload.details }
    $state = Read-MonitorState
    $state.listenerStatus = $status
    Write-MonitorState $state
    return Get-MonitorPublicState $state
}

function Save-GameUpdateObservation([object]$Payload) {
    $rawEntries = @($Payload.entries)
    $rawMetadata = @($Payload.metadata)
    $rawResources = @($Payload.resources)
    if ($rawEntries.Count -gt $MaxMonitorEntries -or $rawMetadata.Count -gt $MaxMonitorEntries -or $rawResources.Count -gt $MaxMonitorEntries) {
        throw 'monitor observation is too large'
    }
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $state = Read-MonitorState
    $wasInitialized = [bool]$state.initialized
    $officialInventoryComplete = $rawResources.Count -gt 0
    $libraryMetadata = Read-JsonDataFile $LibraryGroupMetadataCache
    $libraryCards = ConvertTo-MonitorHashtable $(if ($null -ne $libraryMetadata) { $libraryMetadata.cards } else { @{} })
    $newKeys = New-Object Collections.Generic.List[string]

    foreach ($value in $rawResources) {
        if ($null -eq $value) { continue }
        $resource = ConvertTo-ValidatedCardResource $value
        $old = $(if ($state.cardResources.ContainsKey($resource.key)) { $state.cardResources[$resource.key] } else { @{} })
        $mergedResource = Merge-MonitorRows $old $resource
        $mergedResource.updatedAt = $now
        $state.cardResources[$resource.key] = $mergedResource
    }

    foreach ($value in $rawMetadata) {
        if ($null -eq $value) { continue }
        $row = Add-MonitorCardLibraryFields (ConvertTo-ValidatedMonitorRow $value) $libraryCards
        $old = $(if ($state.metadata.ContainsKey($row.key)) { $state.metadata[$row.key] } else { @{} })
        $merged = Merge-MonitorRows $old $row
        $merged.updatedAt = $now
        $state.metadata[$row.key] = $merged
    }

    foreach ($value in $rawEntries) {
        if ($null -eq $value) { continue }
        $row = Add-MonitorCardLibraryFields (ConvertTo-ValidatedMonitorRow $value) $libraryCards
        if ($state.metadata.ContainsKey($row.key)) { $row = Merge-MonitorRows $row $state.metadata[$row.key] }
        $row = Add-MonitorCardResource $state $row $officialInventoryComplete
        if (-not $state.entries.ContainsKey($row.key)) {
            $row.firstSeenAt = $now
            $row.lastSeenAt = $now
            $row.unread = $wasInitialized
            $row.updateDetectedAt = $(if ($wasInitialized) { $now } else { '' })
            $row.updateKind = $(if ($wasInitialized) { 'scenario' } else { 'baseline' })
            $row.implementationChanges = $(if ($wasInitialized) { '剧情 JSON' } else { '' })
            $state.entries[$row.key] = $row
            if ($wasInitialized) { $newKeys.Add($row.key) }
        } else {
            $old = $state.entries[$row.key]
            $merged = Merge-MonitorRows $old $row
            $firstOfficialAudit = $wasInitialized -and $officialInventoryComplete `
                -and ([string]$merged.eventType) -eq 'produce_events' `
                -and ([string]$merged.eventId) -match '^[23]\d{8}$' `
                -and -not ([string]$old.implementationAuditAt).Trim() `
                -and -not ([string]$old.updateDetectedAt).Trim() `
                -and ([string]$merged.staticCardStatus) -in @('available', 'missing')
            if ($firstOfficialAudit) {
                $preloaded = ([string]$merged.staticCardStatus) -eq 'missing'
                $merged.firstSeenAt = $(if ($old.firstSeenAt) { $old.firstSeenAt } else { $now })
                $merged.lastSeenAt = $now
                $merged.implementationAuditAt = $now
                $merged.unread = [bool]$old.unread -or $preloaded
                $merged.updateDetectedAt = $(if ($preloaded) { $now } else { [string]$old.updateDetectedAt })
                $merged.updateKind = $(if ($preloaded) { 'preload' } elseif ($old.updateKind) { [string]$old.updateKind } else { 'baseline' })
                $merged.implementationChanges = $(if ($preloaded) { '页游未实装' } else { [string]$old.implementationChanges })
                $state.entries[$row.key] = $merged
                continue
            }
            $implementedNow = ([string]$old.updateKind) -eq 'preload' -and ([string]$merged.staticCardStatus) -eq 'available'
            $merged.firstSeenAt = $(if ($old.firstSeenAt) { $old.firstSeenAt } else { $now })
            $merged.lastSeenAt = $now
            $merged.unread = [bool]$old.unread
            $merged.updateDetectedAt = [string]$old.updateDetectedAt
            $merged.updateKind = $(if ($implementedNow) { 'recovered' } else { [string]$old.updateKind })
            $merged.implementationChanges = $(if ($implementedNow) { '' } else { [string]$old.implementationChanges })
            $state.entries[$row.key] = $merged
        }
    }

    foreach ($key in @($state.metadata.Keys)) {
        if (-not $state.entries.ContainsKey($key)) { continue }
        $old = $state.entries[$key]
        $metadataRow = Add-MonitorCardLibraryFields $state.metadata[$key] $libraryCards
        $merged = Merge-MonitorRows $old (Add-MonitorCardResource $state $metadataRow $officialInventoryComplete)
        $implementedNow = ([string]$old.updateKind) -eq 'preload' -and ([string]$merged.staticCardStatus) -eq 'available'
        $merged.firstSeenAt = $(if ($old.firstSeenAt) { $old.firstSeenAt } else { $now })
        $merged.lastSeenAt = $(if ($old.lastSeenAt) { $old.lastSeenAt } else { $now })
        $merged.unread = [bool]$old.unread
        $merged.updateDetectedAt = [string]$old.updateDetectedAt
        $merged.updateKind = $(if ($implementedNow) { 'recovered' } else { [string]$old.updateKind })
        $merged.implementationChanges = $(if ($implementedNow) { '' } else { [string]$old.implementationChanges })
        $state.entries[$key] = $merged
    }

    if (-not $wasInitialized) {
        $state.initialized = $true
        $state.initializedAt = $now
    }
    $state.lastObservedAt = $now
    $state.assetVersion = ([string]$Payload.assetVersion).Substring(0, [Math]::Min(100, ([string]$Payload.assetVersion).Length))
    Write-MonitorState $state
    $public = Get-MonitorPublicState $state
    $public.baselineCreated = -not $wasInitialized
    $public.newCount = $newKeys.Count
    $public.newKeys = @($newKeys)
    return $public
}

function Acknowledge-GameUpdates {
    $state = Read-MonitorState
    foreach ($row in $state.entries.Values) { $row.unread = $false }
    Write-MonitorState $state
    return Get-MonitorPublicState $state
}
# LOCAL_MONITOR_END

function Read-JsonDataFile([string]$Path) {
    if (-not [IO.File]::Exists($Path)) { return $null }
    try { return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json }
    catch { return $null }
}

function Get-ScenarioMetadataEntries {
    $data = Read-JsonDataFile $ScenarioMetadataCache
    if ($null -eq $data -or $null -eq $data.entries) { return @{} }
    return ConvertTo-MonitorHashtable $data.entries
}

function Get-ScenarioLibraryLabels {
    $groups = Read-JsonDataFile $LibraryGroupMetadataCache
    if ($null -eq $groups) {
        $groups = [PSCustomObject]@{
            version = 1; generatedAt = ''; cards = @{}; activities = @{}; errors = @(); stats = @{}
        }
    }
    $stories = [ordered]@{}
    $metadataEntries = Get-ScenarioMetadataEntries
    foreach ($key in $metadataEntries.Keys) {
        $row = $metadataEntries[$key]
        $title = ([string]$row.storyTitle).Trim()
        if ($title) {
            $stories[$key] = [ordered]@{ storyTitle = $title; source = ([string]$row.source).Trim() }
        }
    }
    $state = Read-MonitorState
    foreach ($key in $state.entries.Keys) {
        if ($stories.Contains($key)) { continue }
        $title = ([string]$state.entries[$key].storyTitle).Trim()
        if ($title) { $stories[$key] = [ordered]@{ storyTitle = $title; source = 'official-game-api' } }
    }
    $stats = ConvertTo-MonitorHashtable $groups.stats
    $stats.namedStories = $stories.Count
    return [ordered]@{
        version = $groups.version
        generatedAt = $groups.generatedAt
        cards = $(if ($null -ne $groups.cards) { $groups.cards } else { @{} })
        activities = $(if ($null -ne $groups.activities) { $groups.activities } else { @{} })
        errors = @($groups.errors)
        stats = $stats
        stories = $stories
    }
}

function Get-KnownScenarioTypes([object]$RawEventId) {
    $eventId = Test-SafeKey $RawEventId 'eventId'
    $types = New-Object Collections.Generic.HashSet[string]
    foreach ($row in (Read-MonitorState).entries.Values) {
        if (([string]$row.eventId).Trim() -eq $eventId -and ([string]$row.eventType).Trim()) {
            [void]$types.Add(([string]$row.eventType).Trim())
        }
    }
    return @($types | Sort-Object)
}

function Get-ScenarioMetadata([object]$RawEventType, [object]$RawEventId) {
    $eventType = Test-SafeKey $RawEventType 'eventType'
    $eventId = Test-SafeKey $RawEventId 'eventId'
    $key = "$eventType/$eventId"
    $entries = Get-ScenarioMetadataEntries
    if ($entries.ContainsKey($key) -and ([string]$entries[$key].storyTitle).Trim()) {
        return $entries[$key]
    }
    $state = Read-MonitorState
    if ($state.entries.ContainsKey($key) -and ([string]$state.entries[$key].storyTitle).Trim()) {
        $row = $state.entries[$key]
        return [ordered]@{
            eventType = $eventType; eventId = $eventId
            storyTitle = ([string]$row.storyTitle).Trim()
            cardName = ([string]$row.cardName).Trim()
            cardId = ([string]$row.cardId).Trim()
            source = 'official-game-api'
        }
    }
    return [ordered]@{ eventType = $eventType; eventId = $eventId; storyTitle = ''; source = 'fallback' }
}

function Get-StoryPrefix([string]$EventType, [string]$EventId) {
    $sequence = $(if ($EventId.Length -ge 2) { $EventId.Substring($EventId.Length - 2) } else { $EventId })
    if ($EventType -eq 'produce_events' -and $EventId -match '^[23]\d{8}$') {
        return $(if ($sequence -eq '11') { 'TE' } else { $sequence })
    }
    if ($EventType -eq 'game_event_communications' -and $EventId -match '^4001\d{5}$') {
        if ($sequence -eq '01') { return '序章' }
        if ($sequence -eq '08') { return '终章' }
        if ($sequence -match '^\d+$' -and [int]$sequence -ge 2 -and [int]$sequence -le 7) {
            return ([int]$sequence - 1).ToString('00')
        }
    }
    if ($EventType -eq 'produce_events' -and $EventId -match '^1\d{3}(\d{3})(\d{2,3})$') {
        $rules = @{
            '000' = @('01','02'); '001' = @('01','02','03','04','05','11')
            '002' = @('01','02','11'); '003' = @('01','02','03','04','05','09')
            '004' = @('01','02','03','04','05','06'); '005' = @('01','02','03','04','05','06')
        }
        if ($rules.ContainsKey($Matches[1]) -and $Matches[2] -in $rules[$Matches[1]]) {
            return $(if ($Matches[2] -eq '11') { 'TE' } else { $Matches[2] })
        }
    }
    return ''
}

function Get-SafeFilenamePart([object]$Value, [string]$Fallback) {
    $text = ([string]$Value).Trim() -replace '[<>:"/\\|?*\x00-\x1f]', ([string][char]0xFF3F)
    $text = $text.TrimEnd().TrimEnd('.')
    if (-not $text) { $text = $Fallback }
    return $text.Substring(0, [Math]::Min(160, $text.Length))
}

function Get-ScenarioCsvFilename([object]$Metadata) {
    $eventType = ([string]$Metadata.eventType).Trim()
    $eventId = ([string]$Metadata.eventId).Trim()
    $prefix = Get-StoryPrefix $eventType $eventId
    $title = Get-SafeFilenamePart $Metadata.storyTitle $eventId
    return $(if ($prefix) { "$(Get-SafeFilenamePart $prefix $eventId).$title.csv" } else { "$title.csv" })
}

function Get-RemoteScenarioTracks([string]$EventType, [string]$EventId) {
    $errors = New-Object Collections.Generic.List[string]
    foreach ($root in $RemoteScenarioRoots) {
        try {
            $response = Invoke-WebRequest -Uri "$root/$EventType/$EventId.json" -UseBasicParsing -TimeoutSec 45
            $tracks = $response.Content | ConvertFrom-Json
            if (@($tracks).Count -eq 0) { throw 'scenario JSON is empty' }
            return @($tracks)
        } catch { $errors.Add("$root`: $($_.Exception.Message)") }
    }
    throw "剧情抓取失败：$($errors -join ' | ')"
}

function Get-TranslatorName([object]$Value) {
    $name = ([string]$Value).Trim()
    if ($name.Length -gt 80) { throw 'translator must be 80 characters or fewer' }
    return $name
}

function Add-ScenarioCsvMetadata([string]$Content, [string]$EventType, [string]$EventId, [string]$Translator = '') {
    if ($Content -notmatch '(?im)^\ufeff?id\s*,\s*name\s*,\s*text\s*,\s*trans\s*$') {
        throw 'CSV header id,name,text,trans was not found'
    }
    $source = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    $lines = @($source -split "`n")
    $result = New-Object Collections.Generic.List[string]
    $infoAdded = $false
    $translatorSeen = $false
    $translatorName = Get-TranslatorName $Translator
    foreach ($line in $lines) {
        if ($line -match '^(?:"?info"?),') {
            if (-not $infoAdded) {
                $result.Add("info,$EventType/$EventId.json,,")
                $infoAdded = $true
            }
            continue
        }
        if ($line -match '^(?:"?译者"?),') {
            if (-not $infoAdded) {
                $result.Add("info,$EventType/$EventId.json,,")
                $infoAdded = $true
            }
            $translatorSeen = $true
            if ($translatorName) { $result.Add("译者,$(Escape-CsvCell $translatorName),,") }
            else { $result.Add($line) }
            continue
        }
        $result.Add($line)
    }
    while ($result.Count -gt 0 -and $result[$result.Count - 1] -eq '') { $result.RemoveAt($result.Count - 1) }
    if (-not $infoAdded) { $result.Add("info,$EventType/$EventId.json,,") }
    if (-not $translatorSeen) { $result.Add("译者,$(Escape-CsvCell $translatorName),,") }
    return ($result -join "`n") + "`n"
}

function Convert-TracksToCsv([object[]]$Tracks, [string]$EventType = '', [string]$EventId = '', [string]$Translator = '') {
    $lines = New-Object Collections.Generic.List[string]
    $lines.Add('id,name,text,trans')
    foreach ($track in $Tracks) {
        if ($null -eq $track) { continue }
        $hasText = $track.PSObject.Properties.Name -contains 'text' -and $null -ne $track.text
        $hasSelect = $track.PSObject.Properties.Name -contains 'select' -and $null -ne $track.select
        if (-not $hasText -and -not $hasSelect) { continue }
        $identifier = $(if ($hasSelect) { 'select' } elseif ($track.id) { [string]$track.id } else { '0000000000000' })
        $speaker = $(if ($hasSelect) { '' } else { [string]$track.speaker })
        $source = [string]$(if ($hasText) { $track.text } else { $track.select })
        $source = $source.Replace("`r`n", "`n").Replace("`r", "`n").Replace("`n", '\n')
        $lines.Add("$(Escape-CsvCell $identifier),$(Escape-CsvCell $speaker),$(Escape-CsvCell $source),")
    }
    if ($EventType -and $EventId) {
        $lines.Add("info,$EventType/$EventId.json,,")
        $lines.Add("译者,$(Escape-CsvCell (Get-TranslatorName $Translator)),,")
    }
    return ($lines -join "`n") + "`n"
}

function Get-GroupSignature([string]$EventType, [string]$EventId) {
    if ($EventType -eq 'special_communications' -and $EventId -match '^4902(\d{3})(\d{3})$') { return "4902$($Matches[1])" }
    if ($EventType -eq 'special_communications' -and $EventId -match '^490(\d{2})0(\d{3})$') { return "490$($Matches[1])" }
    return $(if ($EventId.Length -gt 2) { $EventId.Substring(0, $EventId.Length - 2) } else { $EventId })
}

function Get-GroupArchiveLabel([string]$EventType, [string[]]$EventIds, [object]$Payload) {
    $requested = ([string]$Payload.groupLabel).Trim()
    $groups = Read-JsonDataFile $LibraryGroupMetadataCache
    $first = $EventIds[0]
    # Card/event nodes use short UI labels (for example “第20张”), while the
    # packaged metadata cache contains the complete archive name.  Prefer that
    # richer label before accepting the caller's display label.
    if ($EventType -eq 'produce_events' -and $first -match '^[23]\d{8}$' -and $null -ne $groups.cards) {
        $key = $first.Substring(0, 7)
        $property = $groups.cards.PSObject.Properties[$key]
        if ($null -ne $property -and ([string]$property.Value.label).Trim()) { return ([string]$property.Value.label).Trim() }
    }
    if ($EventType -eq 'game_event_communications' -and $first -match '^4001(\d{3})\d{2}$' -and $null -ne $groups.activities) {
        $property = $groups.activities.PSObject.Properties[$Matches[1]]
        if ($null -ne $property -and ([string]$property.Value.label).Trim()) { return ([string]$property.Value.label).Trim() }
    }
    if ($requested -and $requested -notin @('主线剧情','杂项','篇章杂项','育成模式杂项','其他过场')) { return $requested }
    return "$(Get-GroupSignature $EventType $first)__"
}

function Get-SpecialStorySpeaker([object[]]$Tracks) {
    $mapping = @{}
    foreach ($row in (Read-SpeakerRows)) { $mapping[$row.name] = $row.trans }
    foreach ($track in $Tracks) {
        $speaker = ([string]$track.speaker).Trim()
        if (-not $speaker -or $speaker -match 'プロデューサー|制作人|ナレーション') { continue }
        if ($mapping.ContainsKey($speaker) -and ([string]$mapping[$speaker]).Trim()) { return ([string]$mapping[$speaker]).Trim() }
        return $speaker
    }
    return ''
}

function New-ScenarioGroupArchive([object]$Payload) {
    $eventType = Test-SafeKey $Payload.eventType 'eventType'
    $translator = Get-TranslatorName $Payload.translator
    $ids = New-Object Collections.Generic.List[string]
    foreach ($raw in @($Payload.eventIds)) {
        $id = Test-SafeKey $raw 'eventId'
        if (-not $ids.Contains($id)) { $ids.Add($id) }
    }
    if ($ids.Count -lt 1 -or $ids.Count -gt 160) { throw '整组导出必须包含 1 到 160 个剧情编号' }
    $signatures = @($ids | ForEach-Object { Get-GroupSignature $eventType $_ } | Sort-Object -Unique)
    if ($signatures.Count -ne 1) { throw '整组导出的剧情编号必须属于同一张卡、同一次活动或同批剧情' }
    $ordered = @($ids | Sort-Object { if ($_.Length -ge 2 -and $_.Substring($_.Length - 2) -match '^\d+$') { [int]$_.Substring($_.Length - 2) } else { 999 } }, { $_ })
    $memory = New-Object IO.MemoryStream
    $zip = New-Object IO.Compression.ZipArchive($memory, [IO.Compression.ZipArchiveMode]::Create, $true)
    $used = @{}
    $speakerCounts = @{}
    try {
        foreach ($id in $ordered) {
            $tracks = Get-RemoteScenarioTracks $eventType $id
            $metadata = Get-ScenarioMetadata $eventType $id
            if ($eventType -eq 'special_communications') {
                $speaker = Get-SpecialStorySpeaker $tracks
                if (-not $speaker) { $speaker = $id }
                $speakerCounts[$speaker] = 1 + [int]$speakerCounts[$speaker]
                $speakerNumber = ([int]$speakerCounts[$speaker]).ToString('00')
                $filename = "$(Get-SafeFilenamePart $speaker $id)$speakerNumber.csv"
            } else { $filename = Get-ScenarioCsvFilename $metadata }
            if ($used.ContainsKey($filename)) { $filename = "$id.$filename" }
            $used[$filename] = $true
            $entry = $zip.CreateEntry($filename, [IO.Compression.CompressionLevel]::Optimal)
            $writer = New-Object IO.StreamWriter($entry.Open(), (New-Object Text.UTF8Encoding($true)))
            try { $writer.Write((Convert-TracksToCsv $tracks $eventType $id $translator)) } finally { $writer.Dispose() }
        }
    } finally {
        $zip.Dispose()
    }
    $bytes = $memory.ToArray()
    $memory.Dispose()
    $label = Get-GroupArchiveLabel $eventType @($ordered) $Payload
    return [ordered]@{ bytes = $bytes; filename = "$(Get-SafeFilenamePart $label 'scenario-group').zip"; count = $ordered.Count }
}

function Fetch-CommunityCardResource([string]$Kind, [object]$RawId) {
    $cardId = Test-SafeKey $RawId 'card id'
    $definitions = @{
        'produce-still' = @{ relative = "images/content/idols/card/$cardId.jpg"; type = 'image/'; max = $MaxExternalCardSize }
        'support-still' = @{ relative = "images/content/support_idols/card/$cardId.jpg"; type = 'image/'; max = $MaxExternalCardSize }
        'produce-movie' = @{ relative = "movies/idols/card/$cardId.mp4"; type = 'video/'; max = $MaxExternalMovieSize }
        'produce-costume-movie' = @{ relative = "movies/idols/card_costume/$cardId.mp4"; type = 'video/'; max = $MaxExternalMovieSize }
    }
    if (-not $definitions.ContainsKey($Kind)) { throw "Unsupported community card resource: '$Kind'" }
    $definition = $definitions[$Kind]
    $relative = [string]$definition.relative
    $expectedType = [string]$definition.type
    $maxSize = [long]$definition.max
    $remoteUrl = "$CommunityCardRoot/$relative"
    $destination = Resolve-AssetDestination $relative
    if ([IO.File]::Exists($destination)) {
        $existingLength = (Get-Item -LiteralPath $destination).Length
        if ($existingLength -ge 512 -and $existingLength -le $maxSize) {
            return [PSCustomObject]@{
                saved = "assets/$relative"
                bytes = $existingLength
                source = $remoteUrl
                cached = $true
            }
        }
    }

    Add-Type -AssemblyName System.Net.Http
    $client = New-Object Net.Http.HttpClient
    try {
        $client.Timeout = [TimeSpan]::FromSeconds(45)
        $client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 ShinyScenarioWorkshop/1.0')
        $client.DefaultRequestHeaders.Referrer = [Uri]'https://shinycolors.moe/'
        $response = $client.GetAsync($remoteUrl).GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) { throw "shinycolors.moe returned HTTP $([int]$response.StatusCode)" }
            $length = $response.Content.Headers.ContentLength
            if ($null -ne $length -and $length -gt $maxSize) { throw 'Community card resource is too large' }
            $contentType = [string]$response.Content.Headers.ContentType.MediaType
            if ($contentType -and -not $contentType.StartsWith($expectedType, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Unexpected community card content type: $contentType"
            }
            $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
            if ($bytes.Length -lt 512 -or $bytes.Length -gt $maxSize) { throw 'Community card resource size is invalid' }
            Write-AtomicBytes $destination $bytes
            return [PSCustomObject]@{
                saved = "assets/$relative"
                bytes = $bytes.Length
                source = $remoteUrl
            }
        } finally {
            $response.Dispose()
        }
    } finally {
        $client.Dispose()
    }
}

function Import-OfficialCardResource([string]$Kind, [object]$RawId, [byte[]]$Bytes, [string]$ContentType) {
    $cardId = Test-SafeKey $RawId 'card id'
    $definitions = @{
        'produce-still' = @{ relative = "images/content/idols/card/$cardId.jpg"; type = 'image/'; max = $MaxExternalCardSize }
        'support-still' = @{ relative = "images/content/support_idols/card/$cardId.jpg"; type = 'image/'; max = $MaxExternalCardSize }
        'produce-movie' = @{ relative = "movies/idols/card/$cardId.mp4"; type = 'video/'; max = $MaxExternalMovieSize }
        'produce-costume-movie' = @{ relative = "movies/idols/card_costume/$cardId.mp4"; type = 'video/'; max = $MaxExternalMovieSize }
    }
    if (-not $definitions.ContainsKey($Kind)) { throw "Unsupported official card resource: '$Kind'" }
    $definition = $definitions[$Kind]
    $expectedType = [string]$definition.type
    $normalizedType = ([string]$ContentType).Split(';')[0].Trim().ToLowerInvariant()
    if ($normalizedType -and $normalizedType -ne 'application/octet-stream' -and -not $normalizedType.StartsWith($expectedType, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unexpected official card content type: $normalizedType"
    }
    $maxSize = [Math]::Min([long]$definition.max, [long]$MaxBodySize)
    if ($Bytes.Length -lt 512 -or $Bytes.Length -gt $maxSize) { throw 'Official card resource size is invalid' }
    if ($expectedType -eq 'image/') {
        $isJpeg = $Bytes.Length -ge 3 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xD8 -and $Bytes[2] -eq 0xFF
        $isPng = $Bytes.Length -ge 8 -and $Bytes[0] -eq 0x89 -and $Bytes[1] -eq 0x50 -and $Bytes[2] -eq 0x4E -and $Bytes[3] -eq 0x47
        $isWebp = $Bytes.Length -ge 12 -and [Text.Encoding]::ASCII.GetString($Bytes, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($Bytes, 8, 4) -eq 'WEBP'
        if (-not ($isJpeg -or $isPng -or $isWebp)) { throw 'Official card image signature is invalid' }
    } elseif ($Bytes.Length -lt 12 -or [Text.Encoding]::ASCII.GetString($Bytes, 4, 4) -ne 'ftyp') {
        throw 'Official card movie signature is invalid'
    }
    $relative = [string]$definition.relative
    $destination = Resolve-AssetDestination $relative
    Write-AtomicBytes $destination $Bytes
    return [PSCustomObject]@{
        saved = "assets/$relative"
        bytes = $Bytes.Length
        source = 'official-game-session'
        kind = $Kind
        cardId = $cardId
    }
}

function Resolve-AssetDestination([string]$Relative) {
    $normalized = ([string]$Relative).Replace('\', '/').TrimStart('/')
    if (-not $normalized -or $normalized -match '(^|/)\.\.?(/|$)') { throw 'Unsafe asset path' }
    $parts = $normalized.Split('/')
    if ($parts.Count -lt 2 -or $AllowedAssetRoots -notcontains $parts[0]) { throw 'Unsupported asset path' }
    $destination = [IO.Path]::GetFullPath((Join-Path $AssetRoot ($normalized.Replace('/', [IO.Path]::DirectorySeparatorChar))))
    $assetPrefix = [IO.Path]::GetFullPath($AssetRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $destination.StartsWith($assetPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe asset path' }
    return $destination
}

function Resolve-StaticFile([string]$UrlPath) {
    $decoded = [Uri]::UnescapeDataString($UrlPath).TrimStart('/')
    if (-not $decoded) { $decoded = 'index.html' }
    $relative = $decoded.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $full = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $relative))
    if (-not $full.StartsWith($ProjectPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe static path' }
    if ([IO.Directory]::Exists($full)) { $full = Join-Path $full 'index.html' }
    return $full
}

function Get-ContentType([string]$Path) {
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.css' { return 'text/css; charset=utf-8' }
        '.js' { return 'application/javascript; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.csv' { return 'text/csv; charset=utf-8' }
        '.txt' { return 'text/plain; charset=utf-8' }
        '.md' { return 'text/markdown; charset=utf-8' }
        '.png' { return 'image/png' }
        '.jpg' { return 'image/jpeg' }
        '.jpeg' { return 'image/jpeg' }
        '.webp' { return 'image/webp' }
        '.gif' { return 'image/gif' }
        '.svg' { return 'image/svg+xml' }
        '.woff2' { return 'font/woff2' }
        '.ttf' { return 'font/ttf' }
        '.otf' { return 'font/otf' }
        '.m4a' { return 'audio/mp4' }
        '.mp3' { return 'audio/mpeg' }
        '.ogg' { return 'audio/ogg' }
        '.mp4' { return 'video/mp4' }
        '.atlas' { return 'text/plain; charset=utf-8' }
        default { return 'application/octet-stream' }
    }
}

function Read-HttpRequest([IO.Stream]$Stream) {
    $headerStream = New-Object IO.MemoryStream
    try {
        $matched = 0
        while ($headerStream.Length -lt $MaxHeaderSize) {
            $value = $Stream.ReadByte()
            if ($value -lt 0) { break }
            $headerStream.WriteByte([byte]$value)
            $expected = @(13, 10, 13, 10)
            if ($value -eq $expected[$matched]) {
                $matched++
                if ($matched -eq 4) { break }
            } else {
                $matched = $(if ($value -eq 13) { 1 } else { 0 })
            }
        }
        if ($matched -ne 4) { throw 'Invalid or oversized HTTP header' }
        $headerText = $Ascii.GetString($headerStream.ToArray())
    } finally {
        $headerStream.Dispose()
    }

    $lines = $headerText -split "`r`n"
    if ($lines[0] -notmatch '^(\S+)\s+(\S+)\s+HTTP/\d(?:\.\d)?$') { throw 'Invalid HTTP request line' }
    $method = $Matches[1].ToUpperInvariant()
    $target = $Matches[2]
    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if (-not $lines[$i]) { continue }
        $separator = $lines[$i].IndexOf(':')
        if ($separator -le 0) { continue }
        $name = $lines[$i].Substring(0, $separator).Trim()
        $value = $lines[$i].Substring($separator + 1).Trim()
        $headers[$name] = $value
    }

    $contentLength = 0
    if ($headers.ContainsKey('Content-Length')) {
        if (-not [long]::TryParse($headers['Content-Length'], [ref]$contentLength)) { throw 'Invalid Content-Length' }
    }
    if ($contentLength -lt 0 -or $contentLength -gt $MaxBodySize) { throw 'Request body is too large' }
    $body = New-Object byte[] ([int]$contentLength)
    $offset = 0
    while ($offset -lt $body.Length) {
        $read = $Stream.Read($body, $offset, $body.Length - $offset)
        if ($read -le 0) { throw 'Unexpected end of request body' }
        $offset += $read
    }

    $uri = New-Object Uri("http://127.0.0.1$target")
    return [PSCustomObject]@{
        Method = $method
        Target = $target
        Path = $uri.AbsolutePath
        Query = $uri.Query
        Headers = $headers
        Body = $body
    }
}

function Get-QueryValue([string]$Query, [string]$Name) {
    foreach ($part in $Query.TrimStart('?').Split('&')) {
        if (-not $part) { continue }
        $pair = $part.Split('=', 2)
        $key = [Uri]::UnescapeDataString($pair[0].Replace('+', ' '))
        if ($key -ne $Name) { continue }
        if ($pair.Count -lt 2) { return '' }
        return [Uri]::UnescapeDataString($pair[1].Replace('+', ' '))
    }
    return $null
}

function Get-StatusReason([int]$StatusCode) {
    switch ($StatusCode) {
        200 { return 'OK' }
        206 { return 'Partial Content' }
        400 { return 'Bad Request' }
        403 { return 'Forbidden' }
        404 { return 'Not Found' }
        405 { return 'Method Not Allowed' }
        416 { return 'Range Not Satisfiable' }
        500 { return 'Internal Server Error' }
        default { return 'OK' }
    }
}

function Write-HttpHeader(
    [IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$ContentType,
    [long]$ContentLength,
    [hashtable]$ExtraHeaders = @{}
) {
    $lines = New-Object Collections.Generic.List[string]
    $lines.Add("HTTP/1.1 $StatusCode $(Get-StatusReason $StatusCode)")
    $lines.Add("Content-Type: $ContentType")
    $lines.Add("Content-Length: $ContentLength")
    $lines.Add('Connection: close')
    $lines.Add('X-Content-Type-Options: nosniff')
    foreach ($name in $ExtraHeaders.Keys) { $lines.Add("${name}: $($ExtraHeaders[$name])") }
    $header = ($lines -join "`r`n") + "`r`n`r`n"
    $bytes = $Ascii.GetBytes($header)
    $Stream.Write($bytes, 0, $bytes.Length)
}

function Write-JsonResponse([IO.Stream]$Stream, [object]$Data, [int]$StatusCode = 200) {
    $json = ($Data | ConvertTo-Json -Depth 64 -Compress) + "`n"
    $bytes = $Utf8.GetBytes($json)
    Write-HttpHeader $Stream $StatusCode 'application/json; charset=utf-8' $bytes.Length @{ 'Cache-Control' = 'no-store' }
    $Stream.Write($bytes, 0, $bytes.Length)
}

function Write-BytesResponse(
    [IO.Stream]$Stream,
    [byte[]]$Bytes,
    [string]$ContentType,
    [hashtable]$Headers = @{}
) {
    $extra = @{ 'Cache-Control' = 'no-store' }
    foreach ($name in $Headers.Keys) { $extra[$name] = $Headers[$name] }
    Write-HttpHeader $Stream 200 $ContentType $Bytes.Length $extra
    $Stream.Write($Bytes, 0, $Bytes.Length)
}

function Write-ErrorResponse([IO.Stream]$Stream, [int]$StatusCode, [string]$Message) {
    Write-JsonResponse $Stream ([PSCustomObject]@{ error = $Message }) $StatusCode
}

function Write-StaticResponse([IO.Stream]$Stream, [object]$Request) {
    $file = Resolve-StaticFile $Request.Path
    if (-not [IO.File]::Exists($file)) { Write-ErrorResponse $Stream 404 'File not found'; return }

    $info = New-Object IO.FileInfo($file)
    $start = [long]0
    $end = $info.Length - 1
    $partial = $false
    $range = $Request.Headers['Range']
    if ($range -and $range -match '^bytes=(\d*)-(\d*)$') {
        if ($Matches[1]) { $start = [long]$Matches[1] }
        if ($Matches[2]) { $end = [long]$Matches[2] }
        if (-not $Matches[1] -and $Matches[2]) {
            $suffix = [long]$Matches[2]
            $start = [Math]::Max(0, $info.Length - $suffix)
            $end = $info.Length - 1
        }
        if ($start -lt 0 -or $end -lt $start -or $start -ge $info.Length) {
            Write-HttpHeader $Stream 416 'text/plain; charset=utf-8' 0 @{ 'Content-Range' = "bytes */$($info.Length)" }
            return
        }
        $end = [Math]::Min($end, $info.Length - 1)
        $partial = $true
    }

    $count = $end - $start + 1
    $status = $(if ($partial) { 206 } else { 200 })
    $extra = @{ 'Accept-Ranges' = 'bytes' }
    if ($partial) { $extra['Content-Range'] = "bytes $start-$end/$($info.Length)" }
    if ($file -match '\.(html|js|css|csv)$') { $extra['Cache-Control'] = 'no-store' }
    Write-HttpHeader $Stream $status (Get-ContentType $file) $count $extra
    if ($Request.Method -eq 'HEAD') { return }

    $fileStream = [IO.File]::OpenRead($file)
    try {
        $fileStream.Position = $start
        $buffer = New-Object byte[] 65536
        $remaining = $count
        while ($remaining -gt 0) {
            $wanted = [int][Math]::Min($buffer.Length, $remaining)
            $read = $fileStream.Read($buffer, 0, $wanted)
            if ($read -le 0) { break }
            $Stream.Write($buffer, 0, $read)
            $remaining -= $read
        }
    } finally {
        $fileStream.Dispose()
    }
}

function Read-JsonBody([object]$Request) {
    if (-not $Request.Body -or $Request.Body.Length -eq 0) { throw 'JSON request body is empty' }
    return $Utf8.GetString($Request.Body) | ConvertFrom-Json
}

function Handle-ApiRequest([IO.Stream]$Stream, [object]$Request) {
    if ($Request.Method -eq 'GET' -and $Request.Path -eq '/api/state') {
        Write-JsonResponse $Stream ([PSCustomObject]@{
            speakers = @(Read-SpeakerRows)
            speakerArchive = $SpeakerCsv
            legacySpeakerArchive = $null
        })
        return
    }
    if ($Request.Method -eq 'GET' -and $Request.Path -eq '/api/scenario-metadata') {
        Write-JsonResponse $Stream (Get-ScenarioMetadata `
            (Get-QueryValue $Request.Query 'eventType') `
            (Get-QueryValue $Request.Query 'eventId'))
        return
    }
    # LOCAL_MONITOR_BEGIN
    if ($Request.Method -eq 'GET' -and $Request.Path -eq '/api/game-update-monitor') {
        Write-JsonResponse $Stream (Get-MonitorPublicState (Read-MonitorState))
        return
    }
    if ($Request.Method -eq 'GET' -and $Request.Path -eq '/api/scenario-library-labels') {
        Write-JsonResponse $Stream (Get-ScenarioLibraryLabels)
        return
    }
    if ($Request.Method -eq 'GET' -and $Request.Path -eq '/api/scenario-types') {
        $eventId = Get-QueryValue $Request.Query 'eventId'
        Write-JsonResponse $Stream ([ordered]@{ eventId = $eventId; eventTypes = @(Get-KnownScenarioTypes $eventId) })
        return
    }
    # LOCAL_MONITOR_END
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/speakers') {
        $payload = Read-JsonBody $Request
        if ($null -eq $payload.entries) { throw 'entries must be an array' }
        Write-JsonResponse $Stream ([PSCustomObject]@{ speakers = @(Write-SpeakerRows @($payload.entries)) })
        return
    }
    # LOCAL_MONITOR_BEGIN
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/game-update-observation') {
        $payload = Read-JsonBody $Request
        Write-JsonResponse $Stream (Save-GameUpdateObservation $payload)
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/game-update-status') {
        $payload = Read-JsonBody $Request
        Write-JsonResponse $Stream (Save-GameUpdateStatus $payload)
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/game-update-acknowledge') {
        Write-JsonResponse $Stream (Acknowledge-GameUpdates)
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/rebuild-scenario-library-labels') {
        Write-JsonResponse $Stream (Get-ScenarioLibraryLabels)
        return
    }
    # LOCAL_MONITOR_END
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/scenario-group-summary') {
        $payload = Read-JsonBody $Request
        $eventType = Test-SafeKey $payload.eventType 'eventType'
        $ids = @($payload.eventIds | ForEach-Object { Test-SafeKey $_ 'eventId' })
        if ($ids.Count -lt 1 -or $ids.Count -gt 160) { throw '整组识别必须包含 1 到 160 个剧情编号' }
        $label = Get-GroupArchiveLabel $eventType $ids $payload
        Write-JsonResponse $Stream ([ordered]@{
            label = $label
            archiveName = "$(Get-SafeFilenamePart $label 'scenario-group').zip"
        })
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/export-scenario-group') {
        $archive = New-ScenarioGroupArchive (Read-JsonBody $Request)
        $encodedName = [Uri]::EscapeDataString([string]$archive.filename)
        Write-BytesResponse $Stream $archive.bytes 'application/zip' @{
            'Content-Disposition' = "attachment; filename*=UTF-8''$encodedName"
            'X-Scenario-Count' = [string]$archive.count
        }
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/fetch-card-resource') {
        $kind = Get-QueryValue $Request.Query 'kind'
        $cardId = Get-QueryValue $Request.Query 'id'
        Write-JsonResponse $Stream (Fetch-CommunityCardResource $kind $cardId)
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/import-official-card-resource') {
        $kind = Get-QueryValue $Request.Query 'kind'
        $cardId = Get-QueryValue $Request.Query 'id'
        $contentType = if ($Request.Headers.ContainsKey('Content-Type')) { $Request.Headers['Content-Type'] } else { '' }
        Write-JsonResponse $Stream (Import-OfficialCardResource $kind $cardId $Request.Body $contentType)
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/cache-resource') {
        $relative = Get-QueryValue $Request.Query 'path'
        $destination = Resolve-AssetDestination $relative
        Write-AtomicBytes $destination $Request.Body
        Write-JsonResponse $Stream ([PSCustomObject]@{
            saved = "assets/$(([string]$relative).Replace('\', '/').TrimStart('/'))"
            bytes = $Request.Body.Length
        })
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/save-export') {
        $payload = Read-JsonBody $Request
        $kind = ([string]$payload.kind).Trim().ToLowerInvariant()
        if ($kind -notin @('japanese', 'translated')) { throw 'kind must be japanese or translated' }
        $eventType = Test-SafeKey $payload.eventType 'eventType'
        $eventId = Test-SafeKey $payload.eventId 'eventId'
        if ($null -ne $payload.content) { $content = [string]$payload.content }
        elseif ($null -ne $payload.tracks) { $content = ($payload.tracks | ConvertTo-Json -Depth 64) + "`n" }
        else { throw 'content or tracks is required' }
        $destination = Join-Path (Join-Path (Join-Path $ExportRoot $kind) $eventType) "$eventId.json"
        Write-AtomicText $destination $content
        Write-JsonResponse $Stream ([PSCustomObject]@{
            saved = "exports/$kind/$eventType/$eventId.json"
            bytes = $Utf8.GetByteCount($content)
        })
        return
    }
    if ($Request.Method -eq 'POST' -and $Request.Path -eq '/api/save-translation') {
        $payload = Read-JsonBody $Request
        $eventType = Test-SafeKey $payload.eventType 'eventType'
        $eventId = Test-SafeKey $payload.eventId 'eventId'
        if ($null -eq $payload.content) { throw 'content must be a string' }
        $content = Add-ScenarioCsvMetadata ([string]$payload.content) $eventType $eventId (Get-TranslatorName $payload.translator)
        $destination = Join-Path (Join-Path $TranslationRoot $eventType) "$eventId.csv"
        Write-AtomicText $destination $content
        Write-JsonResponse $Stream ([PSCustomObject]@{
            saved = "translations/$eventType/$eventId.csv"
            bytes = $Utf8.GetByteCount($content)
        })
        return
    }
    Write-ErrorResponse $Stream 404 'Unknown API route'
}

function Test-ViewerAlreadyRunning {
    try {
        $response = Invoke-WebRequest -Uri $AppUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match 'Shiny Scenario Workshop'
    } catch { return $false }
}

Ensure-SpeakerArchive
if (Test-ViewerAlreadyRunning) {
    if (-not $NoBrowser) { Start-Process $AppUrl }
    Write-Host 'Shiny Scenario Workshop is already running.'
    exit 0
}

$ip = [Net.IPAddress]::Parse($HostAddress)
$listener = New-Object Net.Sockets.TcpListener($ip, $Port)
try {
    $listener.Start(64)
} catch {
    Write-Host "Could not start Shiny Scenario Workshop on $BaseUrl" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host "Shiny Scenario Workshop: $AppUrl" -ForegroundColor Cyan
Write-Host 'Close this window or press Ctrl+C to stop the local app.'
if (-not $NoBrowser) { Start-Process $AppUrl }

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 30000
            $client.SendTimeout = 30000
            $stream = $client.GetStream()
            try {
                $request = Read-HttpRequest $stream
                if ($request.Path.StartsWith('/api/')) { Handle-ApiRequest $stream $request }
                elseif ($request.Method -in @('GET', 'HEAD')) { Write-StaticResponse $stream $request }
                else { Write-ErrorResponse $stream 405 'Method not allowed' }
                $stream.Flush()
            } catch {
                try { Write-ErrorResponse $stream 500 $_.Exception.Message; $stream.Flush() } catch {}
            } finally {
                $stream.Dispose()
            }
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
