# Loaded explicitly as UTF-8 by serve-viewer.ps1 (including Windows PowerShell 5.1).
# Public, unauthenticated metadata only. Never call game-session APIs here.
function Save-MonitorOfficialMetadata([object[]]$Rows) {
    $titles = Get-ScenarioMetadataEntries
    $groups = ConvertTo-MonitorHashtable (Read-JsonDataFile $LibraryGroupMetadataCache)
    $cards = ConvertTo-MonitorHashtable $groups.cards
    $identities = ConvertTo-MonitorHashtable (Read-JsonDataFile $CardIdentityCache)
    $identityCards = ConvertTo-MonitorHashtable $identities.cards
    $changed = $false
    foreach ($value in $Rows) {
        $row = ConvertTo-MonitorHashtable $value
        $id = [string]$row.eventId
        if ($row.eventType -ne 'produce_events' -or $id -notmatch '^[23]\d{8}$') { continue }
        $source = [string]$row.metadataSource
        if (-not $source) { $source = [string]$row.source }
        if ($source -notin @('official-game-api', 'shinycolors.moe', 'shinycolors.moe/card-event-id')) { continue }
        $key = "produce_events/$id"
        $old = $titles[$key]
        if ($row.storyTitle -and -not ($old.source -eq 'official-game-api' -and $source -ne 'official-game-api')) {
            $titles[$key] = @{eventType='produce_events'; eventId=$id; storyTitle=[string]$row.storyTitle; cardName=[string]$row.cardName; cardId=[string]$row.cardId; source=$source}
            $changed = $true
        }
        $prefix = $id.Substring(0,7)
        $oldCard = $cards[$prefix]
        if (-not $row.cardName -or ($oldCard.source -eq 'official-game-api' -and $source -ne 'official-game-api')) { continue }
        $character = $id.Substring(1,3)
        $shortNames = @('','真乃','灯织','巡','恋钟','摩美美','咲耶','结华','雾子','果穗','智代子','树里','凛世','夏叶','甘奈','甜花','千雪','朝日','冬优子','爱依','透','圆香','小糸','雏菜','日花','美琴','路加','羽那','阳希')
        $shortName = if ([int]$character -lt $shortNames.Count) { $shortNames[[int]$character] } else { "角色$character" }
        $title = [string]$row.cardName
        if ($title -match '【[^】]+】') { $title = $Matches[0] }
        $type = if ($id[0] -eq '2') { 'Produce' } else { 'Support' }
        $typeLabel = if ($type -eq 'Produce') { 'P卡' } else { 'S卡' }
        $cards[$prefix] = @{cardName=$title; rawCardName=[string]$row.cardName; characterId=$character; characterName=$shortName; cardType=$type; cardId=[string]$row.cardId; label="$shortName$typeLabel・$title"; source=$source}
        if ($row.cardId) { $identityCards[[string]$row.cardId] = @{cardId=[string]$row.cardId; rawCardName=[string]$row.cardName} }
        $changed = $true
    }
    if (-not $changed) { return }
    $now = [DateTime]::UtcNow.ToString('o')
    Write-AtomicText $ScenarioMetadataCache ((@{version=1; entries=$titles; updatedAt=$now} | ConvertTo-Json -Depth 64) + "`n")
    $groups.version = 1; $groups.cards = $cards; $groups.generatedAt = $now
    if (-not $groups.activities) { $groups.activities = @{} }
    Write-AtomicText $LibraryGroupMetadataCache (($groups | ConvertTo-Json -Depth 64) + "`n")
    $identities.version = 1; $identities.cards = $identityCards
    Write-AtomicText $CardIdentityCache (($identities | ConvertTo-Json -Depth 64) + "`n")
}

function Get-PublicCardJson([string]$Relative) {
    $url = 'https://api.shinycolors.moe/info/' + $Relative
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15 -Headers @{Accept='application/json'}
    return $response.Content | ConvertFrom-Json
}

function Find-PublicCardMetadata([string]$EventId, [string]$ExactId) {
    if ($EventId -notmatch '^([23])(\d{3})(\d{3})(\d{2})$') { return @() }
    $produce = $Matches[1] -eq '2'; $character = [int]$Matches[2]; $sequence = [int]$Matches[3]
    $info = Get-PublicCardJson "idolInfo?idolId=$character"
    $candidates = @($info.cardLists | Where-Object {
        $_.cardUuid -and $(if ($produce) { $_.cardType -like 'P_*' -and $_.cardType -ne 'P_R' } else { $_.cardType -like 'S_*' -and $_.cardType -notin @('S_N','S_R') })
    } | Sort-Object releaseDate, cardIndex)
    if ($ExactId) { $candidates = @($candidates | Where-Object { [string]$_.enzaId -eq $ExactId }) }
    else {
        # Sequence is only query priority, NEVER evidence for matching a card.
        $ranked = for ($i=0; $i -lt $candidates.Count; $i++) { @{card=$candidates[$i]; distance=[Math]::Abs($i-($sequence-1))} }
        $candidates = @($ranked | Sort-Object distance | ForEach-Object { $_.card })
    }
    $endpoint = if ($produce) { 'pCardInfo' } else { 'sCardInfo' }
    $field = if ($produce) { 'cardIdolEvents' } else { 'cardSupportEvents' }
    foreach ($card in $candidates) {
        $detail = Get-PublicCardJson "$endpoint`?cardId=$([Uri]::EscapeDataString([string]$card.cardUuid))"
        if (-not @($detail.$field | Where-Object { [string]$_.eventId -eq $EventId }).Count) { continue }
        $rows = @($detail.$field | ForEach-Object {
            $title = if ($_.eventTitle) { [string]$_.eventTitle } else { [string]$_.eventName }
            if ([string]$_.eventId -match '^[23]\d{8}$' -and $title) {
                @{eventType='produce_events'; eventId=[string]$_.eventId; storyTitle=$title; cardName=$(if ($detail.cardName) { [string]$detail.cardName } else { [string]$card.cardName }); cardId=$(if ($detail.enzaId) { [string]$detail.enzaId } else { [string]$card.enzaId }); metadataSource='shinycolors.moe/card-event-id'}
            }
        })
        Save-MonitorOfficialMetadata $rows
        return $rows
    }
    return @()
}

function Update-PortableLibraryLabels {
    $state = Read-MonitorState
    Save-MonitorOfficialMetadata @($state.metadata.Values + $state.entries.Values)
    $titles = Get-ScenarioMetadataEntries
    $groups = @{}
    foreach ($entry in $state.entries.Values) {
        $id = [string]$entry.eventId
        if ($entry.eventType -ne 'produce_events' -or $id -notmatch '^[23]\d{8}$') { continue }
        $prefix = $id.Substring(0,7)
        if (-not $groups.ContainsKey($prefix)) { $groups[$prefix] = @{ids=@(); cardIds=@(); date=''} }
        $group = $groups[$prefix]; $group.ids += $id
        if ($entry.cardId) { $group.cardIds += [string]$entry.cardId }
        if ([string]$entry.firstSeenAt -gt $group.date) { $group.date = [string]$entry.firstSeenAt }
    }
    $errors = @(); $count = 0
    foreach ($group in @($groups.Values | Sort-Object { $_.date } -Descending)) {
        $missing = @($group.ids | Sort-Object -Unique | Where-Object { -not $titles["produce_events/$_"].storyTitle })
        if (-not $missing.Count) { continue }
        if ($count++ -ge 12) { break }
        $exactIds = @($group.cardIds | Sort-Object -Unique)
        if ($exactIds.Count -gt 1) { $errors += "$($missing[0]): 卡号证据冲突，未猜测"; continue }
        $exact = if ($exactIds.Count) { $exactIds[0] } else { '' }
        try { $null = Find-PublicCardMetadata $missing[0] $exact }
        catch { $errors += "$($missing[0]): $($_.Exception.Message)" }
    }
    $result = Get-ScenarioLibraryLabels
    $result.errors = $errors
    $result.stats.knownCardGroups = $groups.Count
    $cards = ConvertTo-MonitorHashtable $result.cards
    $result.stats.namedCardGroups = @($groups.Keys | Where-Object { $cards.ContainsKey($_) }).Count
    return $result
}

function Get-OfficialResourceRelative([string]$Kind, [string]$CardId) {
    $safeId = Test-SafeKey $CardId 'card id'
    switch ($Kind) {
        'produce-still' { return "images/content/idols/card/$safeId.jpg" }
        'support-still' { return "images/content/support_idols/card/$safeId.jpg" }
        'produce-movie' { return "movies/idols/card/$safeId.mp4" }
        'produce-costume-movie' { return "movies/idols/card_costume/$safeId.mp4" }
        default { throw 'Unsupported official card resource kind' }
    }
}

function Complete-OfficialResourceRequest([string]$Kind, [string]$CardId) {
    $relative = Get-OfficialResourceRelative $Kind $CardId
    $destination = Resolve-AssetDestination $relative
    if (-not [IO.File]::Exists($destination) -or (Get-Item -LiteralPath $destination).Length -lt 512) { return }
    $state = Read-MonitorState; $key = "$Kind/$CardId"; $saved = "assets/$relative"
    if ($state.resourceRequests.ContainsKey($key)) {
        $state.resourceRequests[$key].status = 'ready'
        $state.resourceRequests[$key].saved = $saved
        $state.resourceRequests[$key].completedAt = [DateTime]::UtcNow.ToString('o')
    }
    $prefix = if ($Kind -like '*-still') { 'staticCard' } else { 'dynamicCard' }
    foreach ($row in @($state.cardResources.Values + $state.entries.Values)) {
        if ([string]$row.cardId -ne $CardId) { continue }
        $row["${prefix}SyncStatus"] = 'synced'; $row["${prefix}Saved"] = $saved
    }
    Write-MonitorState $state
}

function Request-OfficialCardResource([string]$Kind, [string]$CardId) {
    $relative = Get-OfficialResourceRelative $Kind $CardId
    $destination = Resolve-AssetDestination $relative
    $ready = [IO.File]::Exists($destination) -and (Get-Item -LiteralPath $destination).Length -ge 512
    $state = Read-MonitorState
    $active = $false
    try { $active = ([DateTime]::UtcNow - [DateTime]::Parse([string]$state.lastObservedAt).ToUniversalTime()).TotalMinutes -le 20 } catch {}
    if ($ready) { Complete-OfficialResourceRequest $Kind $CardId }
    else {
        $key = "$Kind/$CardId"
        $state.resourceRequests[$key] = @{key=$key; kind=$Kind; cardId=$CardId; path=$relative; status='pending'; requestedAt=[DateTime]::UtcNow.ToString('o')}
        Write-MonitorState $state
    }
    return @{status=$(if ($ready) { 'ready' } else { 'pending' }); kind=$Kind; cardId=$CardId; path=$relative; saved=$(if ($ready) { "assets/$relative" } else { '' }); listenerActive=$active}
}

function Get-OfficialCardResourceRequests {
    $state = Read-MonitorState; $items = @()
    foreach ($row in $state.resourceRequests.Values) {
        if ($row.status -ne 'pending') { continue }
        try {
            $relative = Get-OfficialResourceRelative $row.kind $row.cardId
            $destination = Resolve-AssetDestination $relative
            if ([IO.File]::Exists($destination) -and (Get-Item -LiteralPath $destination).Length -ge 512) { Complete-OfficialResourceRequest $row.kind $row.cardId }
            else { $items += @{kind=$row.kind; cardId=$row.cardId; path=$relative} }
        } catch { continue }
    }
    return @{items=$items; count=$items.Count}
}
