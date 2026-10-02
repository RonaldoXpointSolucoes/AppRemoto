#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('List', 'Get', 'Deliver', 'Comment')]
    [string]$Action = 'List',
    [ValidateSet('development', 'all', 'backlog', 'analysis', 'testing', 'production')]
    [string]$Status = 'development',
    [string]$CardId,
    [string]$ReportPath,
    [string]$CommentPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = 'C:\Users\NOTE-(FORM)02JUL26\Documents\Projetos\Antigravity\AppRemoto'
$currentPath = [IO.Path]::GetFullPath((Get-Location).Path).TrimEnd('\')
if ($currentPath -ne $projectRoot -and -not $currentPath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Esta skill é exclusiva do projeto AppRemoto. Execute dentro da raiz autorizada.'
}
$installedRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
if ($installedRoot.TrimEnd('\') -ne $projectRoot) {
    throw 'Cliente fora da instalação autorizada em AppRemoto/.agents/skills.'
}
$apiBase = 'https://owckk0k8w8soo40w40owc4ss.69.62.92.212.sslip.io/api/v1/crm'
$boardId = '64ea89ca-c413-49eb-be7f-80349620b92c'
$boardRoute = '/boards/' + $boardId
if ($Action -ne 'List' -and $CardId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    throw 'Informe o UUID do card.'
}
$secretPath = Join-Path $projectRoot '.local\fila-dev\api-key.dpapi'
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Credencial local não configurada.' }
$secret = (Get-Content -LiteralPath $secretPath -Raw).Trim() | ConvertTo-SecureString
$credential = [PSCredential]::new('x-api-key', $secret)
$apiKey = $credential.GetNetworkCredential().Password

function Invoke-Crm {
    param([string]$Route, [string]$Method = 'GET', [object]$Body)
    if (-not $Route.StartsWith($boardRoute + '/', [StringComparison]::Ordinal)) { throw 'Rota fora do quadro autorizado.' }
    $request = @{
        Uri = $apiBase + $Route
        Method = $Method
        Headers = @{'x-api-key' = $apiKey; Accept = 'application/json'}
        TimeoutSec = 30
        MaximumRedirection = 0
        SkipHttpErrorCheck = $true
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $request.ContentType = 'application/json; charset=utf-8'
        $request.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 40 -Compress))
    }
    try {
        $response = Invoke-WebRequest @request
    } catch {
        throw ('Falha de transporte HTTPS na API do quadro: ' + $_.Exception.Message.Replace($apiKey, '[REDACTED_SECRET]'))
    }
    if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) {
        throw ('API retornou HTTP ' + [int]$response.StatusCode + '. Nenhuma repetição automática foi feita.')
    }
    $data = $response.Content | ConvertFrom-Json -AsHashtable
    if ($data.ok -ne $true) { throw 'A API não confirmou sucesso.' }
    if ($data.ContainsKey('board') -and $data.board.id -ne $boardId) { throw 'Quadro inesperado na resposta.' }
    return $data
}

function Get-VerifiedCard {
    $response = Invoke-Crm -Route ($boardRoute + '/cards/' + $CardId)
    if (-not $response.ContainsKey('card')) { throw 'Resposta de detalhe sem campo card; inspecione o contrato antes de continuar.' }
    $card = $response.card
    if ($card.id -ne $CardId -or $card.board_id -ne $boardId) { throw 'Card ou quadro inesperado.' }
    return $response
}

try {
    switch ($Action) {
        'List' {
            $cards = [Collections.Generic.List[object]]::new()
            $seen = [Collections.Generic.HashSet[string]]::new()
            $offset = 0
            do {
                $query = '?limit=100&offset=' + $offset
                if ($Status -ne 'all') { $query += '&status=' + $Status }
                $page = Invoke-Crm -Route ($boardRoute + '/cards' + $query)
                if (-not $page.ContainsKey('cards') -or -not $page.ContainsKey('total')) { throw 'Paginação inesperada: faltam cards/total.' }
                $batch = @($page.cards)
                foreach ($card in $batch) {
                    if ($card.board_id -ne $boardId) { throw 'Card pertence a outro quadro.' }
                    if ($Status -ne 'all' -and $card.status -ne $Status) { throw 'API retornou card fora do status solicitado.' }
                    if (-not $seen.Add([string]$card.id)) { throw 'Paginação repetiu um card; repita a leitura antes de agir.' }
                    $cards.Add($card)
                }
                $offset += $batch.Count
                if ($batch.Count -eq 0 -and $offset -lt [int]$page.total) { throw 'Página vazia antes do total informado.' }
            } while ($offset -lt [int]$page.total)
            $output = @{ok=$true; board=$page.board; total=$cards.Count; status=$Status; cards=@($cards.ToArray()); checked_at=(Get-Date).ToUniversalTime().ToString('o')}
        }
        'Get' { $output = Get-VerifiedCard }
        'Deliver' {
            if (-not $ReportPath) { throw 'Informe ReportPath com o relatório validado.' }
            $report = Get-Content -LiteralPath $ReportPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
            if (-not ($report.summary -is [string]) -or [string]::IsNullOrWhiteSpace($report.summary) -or -not ($report.files -is [array])) {
                throw 'Relatório exige summary não vazio e files como array.'
            }
            if (@($report.files | Where-Object { $_ -isnot [string] }).Count -gt 0) { throw 'files deve conter somente caminhos em texto.' }
            $before = Get-VerifiedCard
            if ($before.card.status -ne 'development') { throw 'Entrega bloqueada: card não está em development.' }
            $body = @{
                targetStage='testing'
                agentName='Codex — AppRemoto'
                comment='Entrega concluída e validada conforme relatório técnico. Encaminhada para testes e homologação.'
                deliveryReport=@{summary=$report.summary; files=$report.files}
            }
            $null = Invoke-Crm -Route ($boardRoute + '/cards/' + $CardId + '/move') -Method POST -Body $body
            $output = Get-VerifiedCard
            if ($output.card.status -ne 'testing') { throw 'POST enviado, mas testing não confirmado. Consulte histórico antes de repetir.' }
        }
        'Comment' {
            if (-not $CommentPath) { throw 'Informe CommentPath com a anotação.' }
            $comment = Get-Content -LiteralPath $CommentPath -Raw -Encoding utf8
            if ([string]::IsNullOrWhiteSpace($comment)) { throw 'Comentário vazio.' }
            $before = Get-VerifiedCard
            if ($before.card.status -ne 'development') { throw 'Comentário bloqueado: card não está em development.' }
            $output = Invoke-Crm -Route ($boardRoute + '/cards/' + $CardId + '/comment') -Method POST -Body @{comment=$comment; author='Codex — AppRemoto'}
        }
    }
    ($output | ConvertTo-Json -Depth 60).Replace($apiKey, '[REDACTED_SECRET]')
} finally {
    $apiKey = $null
    $credential = $null
    $secret.Dispose()
}
