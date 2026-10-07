param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$Utf8 = New-Object Text.UTF8Encoding($false)
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Root 'serve-viewer.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($fn in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    . ([ScriptBlock]::Create($fn.Extent.Text))
}
. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $Root 'scripts/PortableMetadata.ps1'), [Text.Encoding]::UTF8)))
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('ssv-portable-metadata-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($tempRoot)
$AssetRoot = Join-Path $tempRoot 'assets'
$MetadataRoot = Join-Path $tempRoot 'metadata'
$ScenarioMetadataCache = Join-Path $MetadataRoot 'titles.json'
$LibraryGroupMetadataCache = Join-Path $MetadataRoot 'groups.json'
$CardIdentityCache = Join-Path $MetadataRoot 'cards.json'
$MonitorRoot = Join-Path $tempRoot 'monitor'
$MonitorState = Join-Path $MonitorRoot 'state.json'
$MonitorStateVersion=6; $MaxMonitorEntries=20000; $AllowedAssetRoots=@('images','movies')
function Assert($Value, $Message) { if (-not $Value) { throw $Message } }
$state = New-MonitorState
$state.initialized=$true
$state.lastObservedAt=[DateTime]::UtcNow.ToString('o')
$state.entries['produce_events/200602001'] = @{eventType='produce_events'; eventId='200602001'; cardId='1040060200'; cardType='Produce'; firstSeenAt='2026-09-29'; unread=$false}
Write-MonitorState $state
function Get-PublicCardJson([string]$Relative) {
    if ($Relative -like 'idolInfo*') { return @{cardLists=@(@{cardType='P_SSR'; cardUuid='correct'; enzaId='1040060200'}, @{cardType='P_SSR'; cardUuid='wrong'; enzaId='1040060210'})} }
    Assert ($Relative -eq 'pCardInfo?cardId=correct') 'Exact card id must constrain lookup'
    return @{cardName='Test card'; enzaId='1040060200'; cardIdolEvents=@(@{eventId='200602001'; eventName='Episode one'}, @{eventId='200602002'; eventTitle='Episode two'})}
}
$result = Update-PortableLibraryLabels
Assert ($result.stories['produce_events/200602001'].storyTitle -eq 'Episode one') 'eventName title missing'
Assert ($result.stories['produce_events/200602002'].storyTitle -eq 'Episode two') 'eventTitle fallback missing'
Assert ($result.cards.'2006020'.cardId -eq '1040060200') 'Exact card identity missing'
Assert ((Read-MonitorState).entries['produce_events/200602001'].firstSeenAt -eq '2026-09-29') 'Title completion changed update history'
Save-MonitorOfficialMetadata @(@{eventType='produce_events'; eventId='200602001'; cardName='Official'; storyTitle='Official title'; metadataSource='official-game-api'; cardId='1040060200'})
Save-MonitorOfficialMetadata @(@{eventType='produce_events'; eventId='200602001'; cardName='Lower priority'; storyTitle='Wrong title'; metadataSource='shinycolors.moe'; cardId='1040060200'})
Assert ((Get-ScenarioMetadataEntries)['produce_events/200602001'].storyTitle -eq 'Official title') 'Official precedence lost'
$request = Request-OfficialCardResource 'produce-still' '1040060200'
Assert ($request.status -eq 'pending' -and $request.listenerActive) 'Pending resource request failed'
Assert ((Get-OfficialCardResourceRequests).count -eq 1) 'Request polling failed'
$relative = Get-OfficialResourceRelative 'produce-still' '1040060200'
Write-AtomicBytes (Resolve-AssetDestination $relative) (New-Object byte[] 600)
Assert ((Get-OfficialCardResourceRequests).count -eq 0) 'Ready resource not removed from pending queue'
Assert ((Read-MonitorState).entries['produce_events/200602001'].staticCardSyncStatus -eq 'synced') 'Resource completion not reflected in library'
$unsafeRejected=$false
try { Request-OfficialCardResource 'produce-still' '../escape' | Out-Null } catch { $unsafeRejected=$true }
Assert $unsafeRejected 'Unsafe card id accepted'
$rows=@(@{eventType='produce_events'; eventId='300602501'; characterId='006'; cardType='Support'; key='produce_events/300602501'})
$resources=@{'Support/2040060210'=@{cardId='2040060210'; cardType='Support'; staticCardStatus='available'}}
$matched=Get-MonitorResourceCorrelations @{} $rows $resources @('Support/2040060210')
Assert ($matched['3006025'] -eq '2040060210') 'Unique resource correlation failed'
$rows += @{eventType='produce_events'; eventId='300602601'; characterId='006'; cardType='Support'; key='produce_events/300602601'}
Assert ((Get-MonitorResourceCorrelations @{} $rows $resources @('Support/2040060210')).Count -eq 0) 'Ambiguous resource guessed'
$observation = Save-GameUpdateObservation @{assetVersion='test-version'; entries=@(@{eventType='produce_events'; eventId='300602501'; characterId='006'; cardType='Support'}); metadata=@(); resources=@(@{cardId='2040060210'; cardType='Support'; staticCardStatus='available'; dynamicCardStatus='not-applicable'})}
Assert ($observation.resourceCorrelationCount -eq 1) 'Observation did not correlate new card resources'
Assert ((Get-OfficialCardResourceRequests).count -eq 1) 'Correlated still not queued for local cache'
Assert ((Read-MonitorState).entries['produce_events/300602501'].pageImplementationStatus -eq 'available') 'Implementation state missing'
Write-Output 'PASS: portable metadata, exact IDs, official precedence, requests, completion, safety and ambiguous correlation'
