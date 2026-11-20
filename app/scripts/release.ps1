param(
    [Parameter(Mandatory)]
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$Version,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked($Command, [string[]]$CommandArgs) {
    # PATH can hold several copies of a tool (e.g. two git.exe); use the first, as the shell would.
    $native = Get-Command $Command -CommandType Application -ErrorAction Stop | Select-Object -First 1
    # Windows PowerShell can emit normal native stderr as errors when output is redirected.
    $ErrorActionPreference = 'Continue'
    & $native @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE" }
}

function Update-Version($Path, $Pattern) {
    $file = (Resolve-Path -LiteralPath $Path).Path
    $contents = [IO.File]::ReadAllText($file)
    if ([regex]::Matches($contents, $Pattern).Count -ne 1) {
        throw "Expected one package version in $Path"
    }
    $updated = [regex]::Replace($contents, $Pattern, ('${1}' + $Version))
    if ($updated -cne $contents) {
        [IO.File]::WriteAllText($file, $updated)
    }
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
    $configPath = 'src-tauri/tauri.conf.json'
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $package = Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json
    $cargoPattern = '(?m)^(version = ")[^"]+(?=")'
    $cargoVersion = [regex]::Match((Get-Content -Raw 'src-tauri/Cargo.toml'), $cargoPattern)
    if ($Publish) {
        if ($config.version -ne $Version -or $package.version -ne $Version -or
            $cargoVersion.Value -ne ('version = "' + $Version)) {
            throw 'Prepare the requested version and commit the version bump before publishing.'
        }
        if (Invoke-Checked git @('status', '--porcelain')) {
            throw 'Commit the release source before publishing.'
        }
        $commit = Invoke-Checked git @('rev-parse', 'HEAD')
    } else {
        $jsonPattern = '(?m)^(  "version": ")[^"]+(?=")'
        Update-Version 'package.json' $jsonPattern
        Update-Version $configPath $jsonPattern
        Update-Version 'src-tauri/Cargo.toml' $cargoPattern
    }

    $gitDir = Invoke-Checked git @('rev-parse', '--path-format=absolute', '--git-common-dir')
    $keys = Join-Path (Split-Path -Parent $gitDir) 'keys'
    $key = (Resolve-Path -LiteralPath (Join-Path $keys 'updater-key.pem')).Path
    $publicKey = Join-Path $keys 'updater-public-key.pem'
    if ((Get-Content -Raw -LiteralPath $publicKey).Trim() -cne $config.plugins.updater.pubkey) {
        throw 'The local updater key does not match the configured public key.'
    }
    $passwordFile = Join-Path $keys 'updater-password-key.pem'

    Invoke-Checked pnpm.cmd @('check')
    Invoke-Checked node @('scripts/check-unused.mjs')
    Invoke-Checked node @('scripts/check-size.mjs')
    Invoke-Checked pnpm.cmd @('format:check')
    Invoke-Checked node @(
        'node_modules/vitest/vitest.mjs', 'run', 'src/features/settings',
        'src/app/runtime/variable-persistence.test.ts'
    )
    Invoke-Checked cargo @('fmt', '--all', '--', '--check')
    Invoke-Checked cargo @('check', '-p', 'supadashboard')
    Invoke-Checked cargo @('test', '-p', 'supadashboard')
    $metadata = Invoke-Checked cargo @('metadata', '--no-deps', '--format-version', '1') |
        ConvertFrom-Json
    $target = 'x86_64-pc-windows-msvc'

    try {
        $env:TAURI_SIGNING_PRIVATE_KEY = $key
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Raw -LiteralPath $passwordFile).Trim()
        Invoke-Checked pnpm.cmd @('tauri', 'build', '--target', $target, '--bundles', 'nsis', '--ci')
    } finally {
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }

    $bundle = Join-Path $metadata.target_directory "$target/release/bundle/nsis"
    $name = "SupaDashboard_${Version}_x64-setup.exe"
    $installer = (Resolve-Path -LiteralPath (Join-Path $bundle $name)).Path
    $signature = (Get-Content -Raw -LiteralPath "$installer.sig").Trim()
    if (!$signature) { throw 'Missing updater signature' }
    $repository = 'McFck/SupaDashboard'
    $tag = "v$Version"
    $manifest = @{
        version = $Version
        platforms = @{
            'windows-x86_64' = @{
                signature = $signature
                url = "https://github.com/$repository/releases/download/$tag/$name"
            }
        }
    }
    $latest = Join-Path $bundle 'latest.json'
    [IO.File]::WriteAllText($latest, ($manifest | ConvertTo-Json -Depth 4))
    if ($Publish) {
        if (Invoke-Checked git @('status', '--porcelain')) {
            throw 'The build changed the release source. Commit the changes before publishing.'
        }
        Invoke-Checked gh @(
            'release', 'create', $tag, $installer, "$installer.sig", $latest,
            '--repo', $repository, '--target', $commit, '--generate-notes', '--latest'
        )
    } else {
        Write-Output $installer, "$installer.sig", $latest
    }
} finally {
    Pop-Location
}
