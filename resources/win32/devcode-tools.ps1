<#
  DEV CODE - instalação das ferramentas das aulas.
  Executado pelo instalador do DEV CODE (e a cada atualização).

    - Python 32 bits (última versão 3.x que ainda tem instalador oficial de 32 bits)
    - Firebird (última versão estável, servidor 64 bits, senha SYSDBA = masterkey)
    - Node.js (última versão; se já estiver instalado e houver versão mais nova, atualiza)

  Só pede permissão de administrador (UAC) se houver algo para instalar/atualizar.
  Uso:  devcode-tools.ps1 [-Update] [-Check]
        -Update = só verifica/atualiza o Node    -Check = só mostra o que faria
#>
param(
	[switch]$Update,
	[switch]$Elevated,
	[switch]$Check,
	[string]$Plan = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$LogFile = Join-Path $env:TEMP 'devcode-tools.log'
function Log($msg) { $line = "$(Get-Date -Format 'HH:mm:ss') $msg"; Write-Host $line; Add-Content -Path $LogFile -Value $line -Encoding UTF8 }
$Headers = @{ 'User-Agent' = 'DEV-CODE-installer' }

function Refresh-Path {
	$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Download($url, $name) {
	$dest = Join-Path $env:TEMP $name
	Log "Baixando $url"
	Invoke-WebRequest -Uri $url -OutFile $dest -Headers $Headers -UseBasicParsing
	return $dest
}

# ------------------------------------------------------------------ Python 32 bits
function Test-Python32 {
	foreach ($root in @('HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore', 'HKCU:\SOFTWARE\Python\PythonCore', 'HKLM:\SOFTWARE\Python\PythonCore')) {
		if (Test-Path $root) {
			foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
				if ($k.PSChildName -match '-32$' -or $root -like '*WOW6432Node*') { return $true }
			}
		}
	}
	return $false
}

function Get-LatestPython32 {
	$html = (Invoke-WebRequest 'https://www.python.org/ftp/python/' -Headers $Headers -UseBasicParsing).Content
	$versions = [regex]::Matches($html, 'href="(3\.\d+\.\d+)/"') | ForEach-Object { [version]$_.Groups[1].Value } | Sort-Object -Descending
	foreach ($v in $versions) {
		$url = "https://www.python.org/ftp/python/$v/python-$v.exe"   # sem "-amd64" = instalador de 32 bits
		try {
			$r = Invoke-WebRequest -Uri $url -Method Head -Headers $Headers -UseBasicParsing
			if ($r.StatusCode -eq 200) { return @{ Version = "$v"; Url = $url } }
		} catch { }
	}
	throw 'Nenhum instalador do Python 32 bits encontrado.'
}

function Install-Python32 {
	$p = Get-LatestPython32
	$exe = Download $p.Url "python-$($p.Version)-32.exe"
	Log "Instalando Python $($p.Version) (32 bits)"
	$proc = Start-Process $exe -ArgumentList '/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0', 'Include_launcher=1', 'Include_pip=1' -Wait -PassThru
	Log "Python: código de saída $($proc.ExitCode)"
}

# ------------------------------------------------------------------ Firebird
function Test-Firebird {
	return [bool](Get-Service -Name 'FirebirdServer*', 'FirebirdGuardian*' -ErrorAction SilentlyContinue) -or
		(Test-Path 'C:\Program Files\Firebird') -or (Test-Path 'C:\Program Files (x86)\Firebird')
}

function Get-LatestFirebird {
	$rel = Invoke-RestMethod 'https://api.github.com/repos/FirebirdSQL/firebird/releases/latest' -Headers $Headers
	$asset = $rel.assets | Where-Object { $_.name -match '(?i)windows-x64\.exe$' -and $_.name -notmatch '(?i)pdb|debug' } | Select-Object -First 1
	if (-not $asset) { throw "Instalador do Firebird não encontrado em $($rel.tag_name)" }
	return @{ Tag = $rel.tag_name; Name = $asset.name; Url = $asset.browser_download_url }
}

function Install-Firebird {
	$fb = Get-LatestFirebird
	$exe = Download $fb.Url $fb.Name
	Log "Instalando Firebird $($fb.Tag)"
	$proc = Start-Process $exe -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/SYSDBAPASSWORD="masterkey"' -Wait -PassThru
	Log "Firebird: código de saída $($proc.ExitCode)"
}

# ------------------------------------------------------------------ Node.js
function Get-InstalledNode {
	Refresh-Path
	try { $v = (& node --version 2>$null); if ($v) { return [version]($v.Trim().TrimStart('v')) } } catch { }
	return $null
}

function Get-LatestNode {
	$index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -Headers $Headers
	$latest = $index | Where-Object { $_.version -match '^v\d+\.\d+\.\d+$' -and $_.files -contains 'win-x64-msi' } | Select-Object -First 1
	return @{ Version = [version]($latest.version.TrimStart('v')); Tag = $latest.version }
}

function Install-Node($tag) {
	$msi = Download "https://nodejs.org/dist/$tag/node-$tag-x64.msi" "node-$tag-x64.msi"
	Log "Instalando/atualizando Node.js $tag"
	$proc = Start-Process 'msiexec.exe' -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait -PassThru
	Log "Node: código de saída $($proc.ExitCode)"
}

# ------------------------------------------------------------------ plano
try {
	if (-not $Elevated) {
		Log '=== DEV CODE: verificando ferramentas ==='
		$todo = @()
		if (-not $Update) {
			if (-not (Test-Python32)) { $todo += 'python' } else { Log 'Python 32 bits: já instalado' }
			if (-not (Test-Firebird)) { $todo += 'firebird' } else { Log 'Firebird: já instalado' }
		}
		try {
			$latest = Get-LatestNode
			$installed = Get-InstalledNode
			if (-not $installed) { Log "Node: não instalado (última: $($latest.Tag))"; $todo += "node=$($latest.Tag)" }
			elseif ($installed -lt $latest.Version) { Log "Node: $installed -> atualizar para $($latest.Tag)"; $todo += "node=$($latest.Tag)" }
			else { Log "Node: $installed já é a última versão" }
		} catch { Log "Node: não foi possível verificar a última versão ($($_.Exception.Message))" }

		if ($Check) {
			try { $py = Get-LatestPython32; Log "Python 32 bits disponível: $($py.Version) ($($py.Url))" } catch { Log $_.Exception.Message }
			try { $fb = Get-LatestFirebird; Log "Firebird disponível: $($fb.Tag) -> $($fb.Name)" } catch { Log $_.Exception.Message }
			Log "Plano: $($todo -join ',')"
			exit 0
		}
		if ($todo.Count -eq 0) { Log 'Nada para instalar.'; exit 0 }

		# precisa de administrador: reexecuta elevado (UAC) só com o que falta
		$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
		$planArg = ($todo -join ',')
		if ($isAdmin) {
			$Plan = $planArg
		} else {
			Log "Solicitando permissão de administrador para: $planArg"
			$p = Start-Process 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated', '-Plan', $planArg
			exit $p.ExitCode
		}
	}

	foreach ($item in ($Plan -split ',')) {
		try {
			switch -Regex ($item) {
				'^python$' { Install-Python32 }
				'^firebird$' { Install-Firebird }
				'^node=(.+)$' { Install-Node $Matches[1] }
			}
		} catch { Log "ERRO em ${item}: $($_.Exception.Message)" }
	}
	Log '=== Ferramentas verificadas ==='
	exit 0
} catch {
	Log "ERRO: $($_.Exception.Message)"
	exit 0   # nunca bloquear a instalação do DEV CODE
}
