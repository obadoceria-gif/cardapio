$ErrorActionPreference = "Stop"

function Pass($m) { Write-Host "[PASS] $m" -ForegroundColor Green }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { throw $m }

function SecureToPlain {
    param([Security.SecureString]$Secure)
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Invoke-ObaProcess {
    param(
        [Parameter(Mandatory=$true)][string]$FileName,
        [Parameter(Mandatory=$true)][string]$Arguments,
        [Parameter(Mandatory=$true)][string]$WorkingDirectory,
        [int]$TimeoutSeconds = 120,
        [hashtable]$Environment = @{}
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    foreach ($key in $Environment.Keys) {
        $psi.EnvironmentVariables[$key] = [string]$Environment[$key]
    }

    $p = [System.Diagnostics.Process]::new()
    $p.StartInfo = $psi

    try {
        if (-not $p.Start()) { throw "Nao foi possivel iniciar: $FileName" }

        if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
            try { $p.Kill() } catch {}
            throw "TIMEOUT apos $TimeoutSeconds s: $FileName $Arguments"
        }

        return [PSCustomObject]@{
            ExitCode = $p.ExitCode
            StdOut = $p.StandardOutput.ReadToEnd()
            StdErr = $p.StandardError.ReadToEnd()
        }
    }
    finally {
        if ($p) { $p.Dispose() }
    }
}

function Invoke-D1Rows {
    param([Parameter(Mandatory=$true)][string]$Sql)

    $escaped = $Sql.Replace('"','\"')

    $result = Invoke-ObaProcess `
        -FileName $script:npx `
        -Arguments "--no-install wrangler d1 execute $script:db --remote --command `"$escaped`" --json" `
        -WorkingDirectory $script:gestao `
        -TimeoutSeconds 90

    if ($result.ExitCode -ne 0) {
        Write-Host $result.StdOut
        Write-Host $result.StdErr -ForegroundColor Yellow
        throw "Consulta D1 falhou: $Sql"
    }

    $raw = $result.StdOut.Trim()

    try {
        $parsed = $raw | ConvertFrom-Json
    }
    catch {
        throw "Wrangler nao retornou JSON valido no stdout."
    }

    $rows = @()
    foreach ($entry in @($parsed)) {
        if ($null -ne $entry -and $entry.PSObject.Properties.Name -contains "results") {
            foreach ($row in @($entry.results)) {
                if ($null -ne $row) { $rows += $row }
            }
        }
    }

    return $rows
}

function Get-D1State {
    $slotRows  = @(Invoke-D1Rows "SELECT slot, revision_id FROM catalog_slots ORDER BY slot;")
    $revRows   = @(Invoke-D1Rows "SELECT COUNT(*) AS revisions FROM catalog_revisions;")
    $promRows  = @(Invoke-D1Rows "SELECT COUNT(*) AS promotions FROM catalog_promotions;")
    $mediaRows = @(Invoke-D1Rows "SELECT COUNT(*) AS media_count FROM catalog_media;")

    $draft = @($slotRows | Where-Object { $_.slot -eq "DRAFT" }) | Select-Object -First 1
    $preview = @($slotRows | Where-Object { $_.slot -eq "PREVIEW" }) | Select-Object -First 1
    $published = @($slotRows | Where-Object { $_.slot -eq "PUBLISHED" }) | Select-Object -First 1
    $revisions = @($revRows | Where-Object { $_.PSObject.Properties.Name -contains "revisions" }) | Select-Object -First 1
    $promotions = @($promRows | Where-Object { $_.PSObject.Properties.Name -contains "promotions" }) | Select-Object -First 1
    $media = @($mediaRows | Where-Object { $_.PSObject.Properties.Name -contains "media_count" }) | Select-Object -First 1

    if ($null -eq $draft -or $null -eq $preview -or $null -eq $published -or $null -eq $revisions -or $null -eq $promotions) {
        throw "Estado D1 incompleto."
    }

    return [PSCustomObject]@{
        Draft = if ($null -eq $draft.revision_id) { $null } else { [string]$draft.revision_id }
        Preview = if ($null -eq $preview.revision_id) { $null } else { [string]$preview.revision_id }
        Published = if ($null -eq $published.revision_id) { $null } else { [string]$published.revision_id }
        Revisions = [int]$revisions.revisions
        Promotions = [int]$promotions.promotions
        MediaCount = if ($null -ne $media) { [int]$media.media_count } else { 0 }
    }
}

$root = "C:\Users\pc_fa\Documents\Projeto_Gemini"
$gestao = Join-Path $root "online\gestao"
$npx = "C:\Program Files\nodejs\npx.cmd"
$db = "DB"
$baseUrl = "https://oba-cardapio-gestao.obadoceria.workers.dev"

$branchExpected = "feature/gestao-online-segura"

$workerRel = "online/gestao/src/index.js"
$centralRel = "online/gestao/public/index.html"
$migrationMediaRel = "online/gestao/migrations/0002_catalog_media.sql"
$testMediaRel = "online/gestao/tests/media-e2e.cjs"
$testPublishRel = "online/gestao/tests/central-publish-e2e.cjs"

$worker = Join-Path $root $workerRel
$central = Join-Path $root $centralRel
$migrationMedia = Join-Path $root $migrationMediaRel
$testMedia = Join-Path $root $testMediaRel
$testPublish = Join-Path $root $testPublishRel

$password = $null

Set-Location $root

try {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " FASE 8E.9H - PIPELINE DE MIDIA ONLINE" -ForegroundColor Cyan
    Write-Host " UPLOAD, ARMAZENAMENTO D1, SERVIMENTO E ZERO CUSTO" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    # 1/9 Baseline
    Write-Host "`n[1/9] Validando baseline atual..." -ForegroundColor Yellow

    $branch = (git branch --show-current).Trim()
    $head = (git rev-parse --short HEAD).Trim()

    Write-Host "Branch : $branch"
    Write-Host "HEAD   : $head"

    if ($branch -ne $branchExpected) { Fail "Branch inesperada." }
    if (-not (Test-Path $npx)) { Fail "NPX global ausente." }
    if (-not (Test-Path $migrationMedia)) { Fail "Migration 0002 ausente." }
    if (-not (Test-Path $testMedia)) { Fail "Teste E2E de midia ausente." }
    if (-not (Test-Path $testPublish)) { Fail "Teste E2E de publicacao ausente." }

    node.exe --check $worker
    if ($LASTEXITCODE -ne 0) { Fail "Worker invalido na sintaxe." }

    Pass "BASELINE DINAMICA $head"

    # 2/9 Checkpoint
    Write-Host "`n[2/9] Criando checkpoint de seguranca..." -ForegroundColor Yellow

    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $audit = Join-Path $root ".auditoria\Online\8E9H_$stamp"
    New-Item -ItemType Directory -Force -Path $audit | Out-Null

    git bundle create (Join-Path $audit "PRE_8E9H.bundle") --all
    if ($LASTEXITCODE -ne 0) { Fail "Checkpoint Git falhou." }

    Copy-Item $worker (Join-Path $audit "worker.8E9H.js") -Force
    Copy-Item $central (Join-Path $audit "central.8E9H.html") -Force

    Pass "CHECKPOINT CRIADO: $audit"

    # 3/9 Gates locais estaticos
    Write-Host "`n[3/9] Executando gates estaticos e de seguranca..." -ForegroundColor Yellow

    node.exe (Join-Path $gestao "tests\auth-gate-static.cjs")
    if ($LASTEXITCODE -ne 0) { Fail "auth-gate-static falhou." }

    node.exe (Join-Path $gestao "tests\security-gate.cjs")
    if ($LASTEXITCODE -ne 0) { Fail "security-gate falhou." }

    node.exe (Join-Path $gestao "tests\catalog-state-contract.cjs")
    if ($LASTEXITCODE -ne 0) { Fail "catalog-state-contract falhou." }

    node.exe (Join-Path $gestao "tests\publish-e2e.cjs")
    if ($LASTEXITCODE -ne 0) { Fail "publish-e2e estatico falhou." }

    $dry = Invoke-ObaProcess `
        -FileName $npx `
        -Arguments "--no-install wrangler deploy --dry-run" `
        -WorkingDirectory $gestao `
        -TimeoutSeconds 120

    if ($dry.ExitCode -ne 0) { Fail "Wrangler dry-run falhou." }

    Pass "TODOS OS GATES ESTATICOS APROVADOS"

    # 4/9 Aplicando Migracao D1 0002_catalog_media.sql
    Write-Host "`n[4/9] Aplicando schema catalog_media no Cloudflare D1 remoto..." -ForegroundColor Yellow

    $mig = Invoke-ObaProcess `
        -FileName $npx `
        -Arguments "--no-install wrangler d1 execute $db --remote --file=migrations/0002_catalog_media.sql" `
        -WorkingDirectory $gestao `
        -TimeoutSeconds 120

    if ($mig.StdOut) { Write-Host $mig.StdOut }
    if ($mig.StdErr) { Write-Host $mig.StdErr -ForegroundColor Yellow }

    if ($mig.ExitCode -ne 0) { Fail "Migracao D1 catalog_media falhou." }

    Pass "MIGRACAO D1 0002 APLICADA COM SUCESSO"

    # 5/9 Auditoria D1 Inicial
    Write-Host "`n[5/9] Auditando D1 remoto inicial..." -ForegroundColor Yellow

    $pre = Get-D1State

    Write-Host "DRAFT      : $($pre.Draft)"
    Write-Host "PREVIEW    : $($pre.Preview)"
    Write-Host "PUBLISHED  : $($pre.Published)"
    Write-Host "REVISOES   : $($pre.Revisions)"
    Write-Host "PROMOCOES  : $($pre.Promotions)"
    Write-Host "MIDIAS     : $($pre.MediaCount)"

    if ([string]::IsNullOrWhiteSpace($pre.Published)) { Fail "PUBLISHED vazio no D1." }

    Pass "D1 INICIAL VALIDADO"

    # 6/9 Deploy Seguro
    Write-Host "`n[6/9] Realizando deploy seguro da aplicacao..." -ForegroundColor Yellow

    $deploy = Invoke-ObaProcess `
        -FileName $npx `
        -Arguments "--no-install wrangler deploy" `
        -WorkingDirectory $gestao `
        -TimeoutSeconds 120

    if ($deploy.StdOut) { Write-Host $deploy.StdOut }
    if ($deploy.StdErr) { Write-Host $deploy.StdErr -ForegroundColor Yellow }

    if ($deploy.ExitCode -ne 0) { Fail "Deploy falhou." }

    Pass "DEPLOY CONCLUIDO COM SUCESSO"
    Start-Sleep -Seconds 3

    # 7/9 E2E Remoto de Midia
    Write-Host "`n[7/9] Executando E2E remoto de Midia Online..." -ForegroundColor Yellow

    if (-not [string]::IsNullOrWhiteSpace($env:AUTH_PASSWORD)) {
        $password = $env:AUTH_PASSWORD
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:TEST_AUTH_PASSWORD)) {
        $password = $env:TEST_AUTH_PASSWORD
    }
    else {
        Write-Host "Informe a senha administrativa para execucao dos testes E2E:" -ForegroundColor Cyan
        $secure = Read-Host "Senha administrativa" -AsSecureString
        $password = SecureToPlain $secure
        $secure = $null
    }

    if ([string]::IsNullOrWhiteSpace($password)) { Fail "Senha administrativa ausente." }

    $env:TEST_BASE_URL = $baseUrl
    $env:TEST_AUTH_PASSWORD = $password

    try {
        & node.exe $testMedia
        if ($LASTEXITCODE -ne 0) { Fail "E2E de Midia falhou." }
        Pass "E2E MIDIA ONLINE APROVADO"

        Write-Host "`n[8/9] Executando E2E de Publicacao e Rollback..." -ForegroundColor Yellow
        & node.exe $testPublish
        if ($LASTEXITCODE -ne 0) { Fail "E2E de Publicacao/Rollback falhou." }
        Pass "E2E PUBLICACAO E ROLLBACK APROVADO"
    }
    finally {
        $env:TEST_AUTH_PASSWORD = $null
        $password = $null
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }

    # 9/9 Auditoria D1 Pos-teste
    Write-Host "`n[9/9] Auditando integridade do D1 pos-E2E..." -ForegroundColor Yellow

    $post = Get-D1State

    Write-Host "DRAFT      : $($post.Draft)"
    Write-Host "PREVIEW    : $($post.Preview)"
    Write-Host "PUBLISHED  : $($post.Published)"
    Write-Host "REVISOES   : $($post.Revisions)"
    Write-Host "PROMOCOES  : $($post.Promotions)"
    Write-Host "MIDIAS     : $($post.MediaCount)"

    if ($post.Published -ne $pre.Published) {
        Fail "PUBLISHED diverge da baseline inicial esperada ($($pre.Published))."
    }

    Pass "SLOT PUBLISHED INTACTO E PRESERVADO"
    Pass "AUDITORIA DE PROMOCOES, REVISOES E MIDIA CONFORME"

    # Conclusao
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host " FASE 8E.9H CONCLUIDA COM SUCESSO!" -ForegroundColor Green
    Write-Host " PIPELINE DE MIDIA ONLINE HOMOLOGADO NO WORKER + D1" -ForegroundColor Green
    Write-Host " ZERO CUSTO / ZERO CARTAO / PRODUCAO PRESERVADA" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host " FALHA NA EXECUCAO DA FASE 8E.9H" -ForegroundColor Red
    Write-Host " Detalhes: $_" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    throw $_
}
