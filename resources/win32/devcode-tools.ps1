<#
  DEV CODE - instalação das ferramentas das aulas (executado pelo instalador do DEV CODE).

  Ferramentas (-Tools, separadas por vírgula):
    python32  Python 3 (32 bits, última versão com instalador oficial de 32 bits)
    python64  Python 3 (64 bits, última versão)
    firebird  Firebird (última estável)            SYSDBA / masterkey
    mysql     MySQL Community Server 8.4 LTS        root / (sem senha), serviço "MySQL"
    postgres  PostgreSQL (última versão)            postgres / postgres
    node      Node.js (última versão; atualiza se já existir versão mais antiga)
    android   Emulador Android (SDK + emulador + Android 14 AOSP) em C:\DevCode\android
    php       PHP (última versão, NTS x64) em C:\DevCode\php, no PATH
    git       Git for Windows (última versão)

  Só pede administrador (UAC) se houver algo para instalar/atualizar.
  Uso:  devcode-tools.ps1 -Tools python32,firebird,node,android
        devcode-tools.ps1 -Update          (só verifica/atualiza o Node.js)
        devcode-tools.ps1 -Tools ... -Check (só mostra o que faria)
#>
param(
	[string]$Tools = 'python32,firebird,node,android',
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
$Root = 'C:\DevCode'

function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Add-MachinePath($dir) {
	$p = [Environment]::GetEnvironmentVariable('Path', 'Machine')
	if (($p -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', "$p;$dir", 'Machine'); Log "PATH += $dir" }
}
function Download($url, $name) {
	$dest = Join-Path $env:TEMP $name
	Log "Baixando $url"
	Invoke-WebRequest -Uri $url -OutFile $dest -Headers $Headers -UseBasicParsing
	return $dest
}
function Unzip($zip, $dest) {
	New-Item -ItemType Directory -Force $dest | Out-Null
	$tar = Join-Path $env:SystemRoot 'System32\tar.exe'   # bsdtar do Windows (rápido); o tar do Git não entende "C:"
	if (Test-Path $tar) { & $tar -xf $zip -C $dest; if ($LASTEXITCODE -eq 0) { return } }
	Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
}
function Test-Url($url) { try { (Invoke-WebRequest -Uri $url -Method Head -Headers $Headers -UseBasicParsing).StatusCode -eq 200 } catch { $false } }

# ================================================================== Python
function Test-Python($bits) {
	$roots = if ($bits -eq 32) { @('HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore', 'HKCU:\SOFTWARE\Python\PythonCore') } else { @('HKLM:\SOFTWARE\Python\PythonCore', 'HKCU:\SOFTWARE\Python\PythonCore') }
	foreach ($root in $roots) {
		foreach ($k in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
			$is32 = $k.PSChildName -match '-32$' -or $root -like '*WOW6432Node*'
			if (($bits -eq 32) -eq $is32) { return $true }
		}
	}
	return $false
}
function Get-LatestPython($bits) {
	$html = (Invoke-WebRequest 'https://www.python.org/ftp/python/' -Headers $Headers -UseBasicParsing).Content
	$versions = [regex]::Matches($html, 'href="(3\.\d+\.\d+)/"') | ForEach-Object { [version]$_.Groups[1].Value } | Sort-Object -Descending
	$suffix = if ($bits -eq 32) { '' } else { '-amd64' }
	foreach ($v in $versions) {
		$url = "https://www.python.org/ftp/python/$v/python-$v$suffix.exe"
		if (Test-Url $url) { return @{ Version = "$v"; Url = $url } }
	}
	throw "Nenhum instalador do Python $bits bits encontrado."
}
function Install-Python($bits) {
	$p = Get-LatestPython $bits
	$exe = Download $p.Url "python-$($p.Version)-$bits.exe"
	Log "Instalando Python $($p.Version) ($bits bits)"
	$proc = Start-Process $exe -ArgumentList '/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0', 'Include_launcher=1', 'Include_pip=1' -Wait -PassThru
	Log "Python $bits bits: código $($proc.ExitCode)"
}

# ================================================================== Firebird
function Test-Firebird { [bool](Get-Service -Name 'FirebirdServer*', 'FirebirdGuardian*' -ErrorAction SilentlyContinue) -or (Test-Path 'C:\Program Files\Firebird') }
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
	Log "Firebird: código $($proc.ExitCode)"
}

# ================================================================== MySQL (8.4 LTS, zip + serviço)
function Test-MySQL { [bool](Get-Service -Name 'MySQL*' -ErrorAction SilentlyContinue) -or (Test-Path "$Root\mysql\bin\mysqld.exe") }
function Get-LatestMySQL {
	# o site da Oracle bloqueia downloads automatizados; a versão vem das tags oficiais e o arquivo da CDN oficial
	$tags = Invoke-RestMethod 'https://api.github.com/repos/mysql/mysql-server/git/matching-refs/tags/mysql-8.4.' -Headers $Headers
	$versions = $tags | ForEach-Object { if ($_.ref -match 'mysql-(8\.4\.\d+)$') { [version]$Matches[1] } } | Sort-Object -Descending
	foreach ($v in $versions) {
		$url = "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-$v-winx64.zip"
		if (Test-Url $url) { return @{ Version = "$v"; Url = $url } }
	}
	throw 'Versão do MySQL 8.4 não encontrada.'
}
function Install-MySQL {
	# programas externos escrevem avisos na saída de erro; isso não pode abortar a instalação
	$ErrorActionPreference = 'Continue'
	$my = Get-LatestMySQL
	$zip = Download $my.Url "mysql-$($my.Version).zip"
	Log "Instalando MySQL $($my.Version)"
	$tmp = "$Root\mysql-extract"; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
	Unzip $zip $tmp
	$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
	Remove-Item "$Root\mysql" -Recurse -Force -ErrorAction SilentlyContinue
	Move-Item $inner.FullName "$Root\mysql"; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
	$base = $Root -replace '\\', '/'
	"[mysqld]`r`nbasedir=$base/mysql`r`ndatadir=$base/mysql/data`r`nport=3306`r`ncharacter-set-server=utf8mb4`r`n" | Set-Content "$Root\mysql\my.ini" -Encoding ASCII
	& "$Root\mysql\bin\mysqld.exe" --defaults-file="$Root\mysql\my.ini" --initialize-insecure --console 2>&1 | Out-Null
	& "$Root\mysql\bin\mysqld.exe" --install MySQL --defaults-file="$Root\mysql\my.ini" 2>&1 | Out-Null
	Start-Service MySQL -ErrorAction SilentlyContinue
	Add-MachinePath "$Root\mysql\bin"
	Log 'MySQL: instalado (usuário root, sem senha, porta 3306)'
}

# ================================================================== PostgreSQL
function Test-Postgres { [bool](Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue) }
function Get-LatestPostgres {
	$v = Invoke-RestMethod 'https://www.postgresql.org/versions.json' -Headers $Headers
	foreach ($rel in ($v | Where-Object { $_.supported } | Sort-Object { [int]$_.major } -Descending)) {
		$ver = "$($rel.major).$($rel.latestMinor)"
		$url = "https://get.enterprisedb.com/postgresql/postgresql-$ver-1-windows-x64.exe"
		if (Test-Url $url) { return @{ Version = $ver; Url = $url } }
	}
	throw 'Instalador do PostgreSQL não encontrado.'
}
function Install-Postgres {
	$pg = Get-LatestPostgres
	$exe = Download $pg.Url "postgresql-$($pg.Version).exe"
	Log "Instalando PostgreSQL $($pg.Version)"
	$proc = Start-Process $exe -ArgumentList '--mode', 'unattended', '--unattendedmodeui', 'none', '--superpassword', 'postgres', '--serverport', '5432', '--disable-components', 'stackbuilder' -Wait -PassThru
	$bin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
	if ($bin) { Add-MachinePath (Join-Path $bin.FullName 'bin') }
	Log "PostgreSQL: código $($proc.ExitCode) (usuário postgres, senha postgres)"
}

# ================================================================== Node.js
function Get-InstalledNode { Refresh-Path; try { $v = (& node --version 2>$null); if ($v) { return [version]($v.Trim().TrimStart('v')) } } catch { }; return $null }
function Get-LatestNode {
	$index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -Headers $Headers
	$latest = $index | Where-Object { $_.version -match '^v\d+\.\d+\.\d+$' -and $_.files -contains 'win-x64-msi' } | Select-Object -First 1
	return @{ Version = [version]($latest.version.TrimStart('v')); Tag = $latest.version }
}
function Test-Git { Refresh-Path; [bool](Get-Command git -ErrorAction SilentlyContinue) -or (Test-Path "$env:ProgramFiles\Git\cmd\git.exe") }
function Get-LatestGit {
	$rel = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers $Headers
	$asset = $rel.assets | Where-Object { $_.name -match '^Git-[\d.]+-64-bit\.exe$' } | Select-Object -First 1
	return @{ Version = $rel.tag_name; Url = $asset.browser_download_url; Name = $asset.name }
}
function Install-Git {
	$g = Get-LatestGit
	$exe = Download $g.Url $g.Name
	Log "Instalando Git $($g.Version)"
	$proc = Start-Process $exe -ArgumentList '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES', '/COMPONENTS="icons,exteg\shellhere,assoc,assoc_sh"' -Wait -PassThru
	Log "Git: código $($proc.ExitCode)"
}

function Install-Node($tag) {
	$msi = Download "https://nodejs.org/dist/$tag/node-$tag-x64.msi" "node-$tag-x64.msi"
	Log "Instalando/atualizando Node.js $tag"
	$proc = Start-Process 'msiexec.exe' -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait -PassThru
	Log "Node: código $($proc.ExitCode)"
}

# ================================================================== PHP
function Test-PHP { Refresh-Path; [bool](Get-Command php -ErrorAction SilentlyContinue) -or (Test-Path "$Root\php\php.exe") }
function Get-LatestPHP {
	$rel = Invoke-RestMethod 'https://windows.php.net/downloads/releases/releases.json' -Headers $Headers
	$latest = $rel.PSObject.Properties | Sort-Object { [version]($_.Value.version -replace '[^\d.].*$', '') } -Descending | Select-Object -First 1
	$build = $latest.Value.PSObject.Properties | Where-Object { $_.Name -match '^nts-.*x64$' } | Select-Object -First 1
	return @{ Version = $latest.Value.version; Url = "https://windows.php.net/downloads/releases/$($build.Value.zip.path)" }
}
function Install-PHP {
	$php = Get-LatestPHP
	$zip = Download $php.Url "php-$($php.Version).zip"
	Log "Instalando PHP $($php.Version)"
	Remove-Item "$Root\php" -Recurse -Force -ErrorAction SilentlyContinue
	Unzip $zip "$Root\php"
	if (Test-Path "$Root\php\php.ini-development") {
		(Get-Content "$Root\php\php.ini-development") -replace ';extension_dir = "ext"', 'extension_dir = "ext"' -replace ';extension=(curl|mbstring|openssl|pdo_mysql|pdo_pgsql|pdo_sqlite|mysqli|pgsql|sqlite3|fileinfo|intl)', 'extension=$1' |
			Set-Content "$Root\php\php.ini" -Encoding ASCII
	}
	Add-MachinePath "$Root\php"
	Log 'PHP: instalado'
}

# ================================================================== Emulador Android (para todos os usuários)
$AndroidBase = "$Root\android"
$AndroidSdk = "$AndroidBase\sdk"
$AndroidImage = 'system-images;android-34;default;x86_64'
function Test-Android { (Test-Path "$AndroidSdk\emulator\emulator.exe") -and (Test-Path "$AndroidSdk\platform-tools\adb.exe") -and (Test-Path "$AndroidSdk\system-images\android-34\default\x86_64") }
function Get-AndroidToolsName {
	$xml = (Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-3.xml' -Headers $Headers -UseBasicParsing).Content
	return ([regex]::Match($xml, 'commandlinetools-win-\d+_latest\.zip')).Value
}
function Install-Android {
	# programas externos escrevem avisos na saída de erro; isso não pode abortar a instalação
	$ErrorActionPreference = 'Continue'
	New-Item -ItemType Directory -Force $AndroidSdk | Out-Null
	# Java 17 (para o sdkmanager)
	$java = Get-ChildItem "$AndroidBase\jre" -Recurse -Filter java.exe -ErrorAction SilentlyContinue | Select-Object -First 1
	if (-not $java) {
		$zip = Download 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse' 'devcode-jre17.zip'
		Unzip $zip "$AndroidBase\jre"
		$java = Get-ChildItem "$AndroidBase\jre" -Recurse -Filter java.exe | Select-Object -First 1
	}
	$env:JAVA_HOME = Split-Path (Split-Path $java.FullName)
	# command-line tools
	$mgr = "$AndroidSdk\cmdline-tools\latest\bin\sdkmanager.bat"
	if (-not (Test-Path $mgr)) {
		$name = Get-AndroidToolsName
		$zip = Download "https://dl.google.com/android/repository/$name" $name
		Remove-Item "$AndroidBase\cmdline-extract" -Recurse -Force -ErrorAction SilentlyContinue
		Unzip $zip "$AndroidBase\cmdline-extract"
		New-Item -ItemType Directory -Force "$AndroidSdk\cmdline-tools" | Out-Null
		Move-Item "$AndroidBase\cmdline-extract\cmdline-tools" "$AndroidSdk\cmdline-tools\latest"
		Remove-Item "$AndroidBase\cmdline-extract" -Recurse -Force -ErrorAction SilentlyContinue
	}
	Log 'Android: aceitando licenças e baixando platform-tools, emulator e Android 14 (pode levar vários minutos)'
	(("y`n") * 30) | & cmd /c "`"$mgr`" --sdk_root=`"$AndroidSdk`" --licenses" 2>&1 | Out-Null
	& cmd /c "`"$mgr`" --sdk_root=`"$AndroidSdk`" `"platform-tools`" `"emulator`" `"$AndroidImage`"" 2>&1 | Select-Object -Last 3 | ForEach-Object { Log "  $_" }
	[Environment]::SetEnvironmentVariable('ANDROID_HOME', $AndroidSdk, 'Machine')
	[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $AndroidSdk, 'Machine')
	Add-MachinePath "$AndroidSdk\platform-tools"
	# os alunos usam o SDK (somente leitura); cada um cria o próprio aparelho virtual no primeiro uso
	icacls $AndroidBase /grant '*S-1-5-32-545:(OI)(CI)RX' /T /Q | Out-Null
	# aceleração do emulador: Plataforma do Hipervisor do Windows (precisa reiniciar uma vez)
	try {
		$f = Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform
		if ($f.State -ne 'Enabled') { Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -NoRestart -All | Out-Null; Log 'Android: Plataforma do Hipervisor ativada (reinicie o computador uma vez)' }
	} catch { Log "Android: não foi possível ativar a Plataforma do Hipervisor ($($_.Exception.Message))" }
	Log 'Android: pronto'
}

# ================================================================== plano
$checks = [ordered]@{
	python32 = @{ Test = { Test-Python 32 }; Name = 'Python 32 bits'; Latest = { (Get-LatestPython 32).Version } }
	python64 = @{ Test = { Test-Python 64 }; Name = 'Python 64 bits'; Latest = { (Get-LatestPython 64).Version } }
	firebird = @{ Test = { Test-Firebird }; Name = 'Firebird'; Latest = { (Get-LatestFirebird).Tag } }
	mysql    = @{ Test = { Test-MySQL }; Name = 'MySQL'; Latest = { (Get-LatestMySQL).Version } }
	postgres = @{ Test = { Test-Postgres }; Name = 'PostgreSQL'; Latest = { (Get-LatestPostgres).Version } }
	android  = @{ Test = { Test-Android }; Name = 'Emulador Android'; Latest = { Get-AndroidToolsName } }
	php      = @{ Test = { Test-PHP }; Name = 'PHP'; Latest = { (Get-LatestPHP).Version } }
	git      = @{ Test = { Test-Git }; Name = 'Git'; Latest = { (Get-LatestGit).Version } }
}

try {
	if (-not $Elevated) {
		Log "=== DEV CODE: verificando ferramentas ($(if ($Update) { 'atualização' } else { $Tools })) ==="
		$wanted = if ($Update) { @('node') } else { $Tools.ToLower() -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne 'none' } }
		$todo = @()
		foreach ($t in $wanted) {
			if ($t -eq 'node') {
				try {
					$latest = Get-LatestNode; $installed = Get-InstalledNode
					if (-not $installed) { Log "Node.js: não instalado (última: $($latest.Tag))"; $todo += "node=$($latest.Tag)" }
					elseif ($installed -lt $latest.Version) { Log "Node.js: $installed -> atualizar para $($latest.Tag)"; $todo += "node=$($latest.Tag)" }
					else { Log "Node.js: $installed já é a última versão" }
				} catch { Log "Node.js: não foi possível verificar a última versão ($($_.Exception.Message))" }
			} elseif ($checks.Contains($t)) {
				if (& $checks[$t].Test) { Log "$($checks[$t].Name): já instalado" } else { $todo += $t }
				if ($Check) { try { Log "  $($checks[$t].Name) disponível para download: $(& $checks[$t].Latest)" } catch { Log "  $($checks[$t].Name): ERRO ao descobrir a versão: $($_.Exception.Message)" } }
			}
		}
		if ($Check) { Log "Plano: $($todo -join ',')"; exit 0 }
		if ($todo.Count -eq 0) { Log 'Nada para instalar.'; exit 0 }

		$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
		$planArg = ($todo -join ',')
		if ($isAdmin) { $Plan = $planArg }
		else {
			Log "Solicitando permissão de administrador para: $planArg"
			$p = Start-Process 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated', '-Plan', $planArg
			exit $p.ExitCode
		}
	}
	New-Item -ItemType Directory -Force $Root | Out-Null
	foreach ($item in ($Plan -split ',')) {
		try {
			switch -Regex ($item) {
				'^python32$' { Install-Python 32 }
				'^python64$' { Install-Python 64 }
				'^firebird$' { Install-Firebird }
				'^mysql$' { Install-MySQL }
				'^postgres$' { Install-Postgres }
				'^node=(.+)$' { Install-Node $Matches[1] }
				'^android$' { Install-Android }
				'^php$' { Install-PHP }
				'^git$' { Install-Git }
			}
		} catch { Log "ERRO em ${item}: $($_.Exception.Message)" }
	}
	Log '=== Ferramentas verificadas ==='
	exit 0
} catch {
	Log "ERRO: $($_.Exception.Message)"
	exit 0   # nunca bloquear a instalação do DEV CODE
}
