# DEV CODE: IDE educacional baseada no VS Code

Fork do [microsoft/vscode](https://github.com/microsoft/vscode) (1.148), no branch `devcode`.

## Identidade visual
- **Nome do aplicativo:** `DEV CODE` (`product.json`: `nameShort`, `nameLong`, `win32DirName`…). O executável continua sendo `devcode`.
- **Ícone (a calopsita):** gerado a partir de `resources/devcode/devcode-icon-1024.png`, com o fundo branco de fora removido:
  - Windows: `resources/win32/code.ico` (16 a 256 px), `code_70x70.png` e `code_150x150.png`;
  - Linux: `resources/linux/code.png`;
  - macOS: `resources/darwin/code.icns`;
  - versão web: `resources/server/favicon.ico`, `code-192.png` e `code-512.png`;
  - ícone da barra de título: `src/vs/workbench/browser/media/code-icon.svg`.
- **Logo "Dev Code"** (`resources/devcode/devcode-logo.png`): aparece como marca d'água do editor vazio no tema claro (`letterpress-light.svg`). Nos temas escuros aparece o ícone, porque o texto "Dev" do logo é preto.
- **Tema padrão: DEV CODE Light.** É o *Light 2026* com o azul de destaque trocado pelo **vermelho do logo** (`#D10A0A`): botões, links, seleção, badges, foco, barra de progresso e a borda da aba e da barra de atividades ativas. A barra de título fica vermelha com texto branco. A cor de sintaxe do código não mudou.
  - Também existe o **DEV CODE Dark**, o *Dark 2026* com vermelho `#F0473F`. Ele é o tema padrão quando o modo escuro do sistema está ativado.
  - O tema claro é o padrão em qualquer sistema (`themeConfiguration.ts`). As cores iniciais, usadas antes de o tema carregar, também foram trocadas para vermelho.
  - Arquivos: `extensions/theme-defaults/themes/devcode-light.json` e `devcode-dark.json`.

## O que foi alterado

| Objetivo | Onde | Como |
|---|---|---|
| **Sem instalar extensões** | `src/vs/platform/extensionManagement/common/extensionsScannerService.ts` | `scanUserExtensions` sempre retorna `[]`: nenhuma extensão do usuário é carregada, nem as copiadas à mão para a pasta. |
| | `src/vs/platform/devcode/common/lockedSettings.ts` | `extensions.allowed = {}` travado: instalar pela galeria, por VSIX ou com `--install-extension` é recusado. |
| | `product.json` | Sem `extensionsGallery` (sem marketplace). Marca renomeada para DevCode. |
| **Sem IA** | `build/gulpfile.vscode.ts`, `build/gulpfile.reh.ts`, `package.json` | Extensão embutida do Copilot retirada do build. |
| | `extensionsScannerService.ts` | Filtro que descarta qualquer extensão de sistema com copilot/chat/codex/claude/openai/gemini/… no id. |
| | `lockedSettings.ts` | `chat.disableAIFeatures = true`, `editor.inlineSuggest.enabled = false` e outras, travadas. |
| **Sem copiar/colar** | `src/vs/workbench/services/clipboard/electron-browser/clipboardService.ts` | Ler e gravar na área de transferência do sistema não faz nada. |
| | `src/vs/workbench/contrib/devcode/browser/devcode.contribution.ts` | Bloqueia em todas as janelas os eventos `paste`/`copy`/`cut`/`drop` e `beforeinput` do tipo insertFromPaste/Drop. Ctrl+C/V/X, Shift+Insert e Ctrl+Insert passam a mostrar um aviso. |
| | `lockedSettings.ts` | Arrastar e soltar no editor, colar no terminal com o botão direito, copiar ao selecionar etc. desligados. |
| **Pergunta antes de executar** | `extensions/devcode-quiz/` (extensão embutida, JS puro) | Veja abaixo. |

### Configurações travadas
`lockedSettings.ts` é aplicado dentro de `getValue()`/`inspect()` dos serviços de configuração (workbench e plataforma). O aluno pode editar o `settings.json`, mas o valor travado sempre prevalece. Para travar mais alguma configuração, basta adicioná-la a `DEVCODE_LOCKED_SETTINGS`.

### Quiz: verificação de entendimento (`extensions/devcode-quiz`)
- **F5, Ctrl+F5 ou o botão ▶** fazem uma pergunta de múltipla escolha sobre o arquivo ativo. Se o aluno acertar, o código salvo roda no terminal "DevCode ▶ Executar".
- As perguntas são geradas **offline, sem IA**, a partir do próprio código: quantas vezes um laço executa, último valor da variável do laço, resultado de uma expressão aritmética, número de parâmetros de uma função, operador de comparação de um `if`/`while`, tipo de um valor atribuído, o que um `print` mostra, que estrutura uma linha usa. A linha da pergunta fica destacada no editor.
- **Errou:** aparece a resposta certa, há uma espera (10 s, 20 s… até 60 s) e depois vem **outra** pergunta.
- **A aprovação vale para aquele conteúdo:** qualquer edição no arquivo exige responder de novo.
- **Outros caminhos também são verificados:** depuração via `launch.json` é cancelada; tarefas (`tasks.json`) são encerradas; se o aluno digitar `python x.py`, `node`, `gcc`, `java`, `./a.out`… no terminal sem ter sido aprovado, o terminal é fechado. Isso depende da integração de shell.
- Linguagens do botão Executar: Python, JavaScript, TypeScript (tsx), Java, C, C++, C#, Go, PHP, Ruby, Rust, Bash, PowerShell.

## Extensões pré-configuradas (embutidas)
O aluno não consegue instalar nada. Estas vêm dentro da IDE:

| Para quê | Extensão | Como entra |
|---|---|---|
| Ícones | **Material Icon Theme** 5.40.0 (MIT), já ativado como tema de ícones padrão | VSIX em `devcode-extensions/`, listado em `product.json` → `builtInExtensions` |
| Python | **basedpyright** 1.40.2 (MIT): autocomplete, assinatura das funções, documentação ao passar o mouse e erros, sem IA | idem |
| JavaScript / TypeScript | `typescript-language-features` (já faz parte do VS Code) | nativo |
| HTML / CSS | `html-language-features`, `css-language-features` e `emmet` (já fazem parte do VS Code) | nativo |

Os VSIX vieram do Open VSX e o build confere o SHA-256 deles. O Pylance e a extensão Python da Microsoft não foram usados porque a licença do Pylance proíbe o uso fora dos produtos da Microsoft.

## Novo Projeto: Python, HTML, React ou React Native
Em **Arquivo → Novo Arquivo… → Novo Projeto…**, ou no menu que aparece ao abrir a IDE, o aluno escolhe **Python**, **HTML / CSS / JavaScript**, **React** ou **React Native (Expo)**. Também há a opção **Projeto do Git**.

### Python (estilo PyCharm)
Também fica em **Arquivo → Novo Arquivo… → Novo Projeto Python**, na paleta de comandos (`DevCode: Novo Projeto Python…`) e no botão do Explorer quando não há pasta aberta.
1. O aluno informa o nome do projeto e escolhe a pasta onde ele será criado.
2. O DevCode procura os Pythons instalados (`py -0p`, `where python`, `%LOCALAPPDATA%\Programs\Python`) e mostra a versão de cada um. Também dá para **procurar o executável** manualmente.
3. A IDE cria `projeto/.venv` (`python -m venv`), `main.py`, `requirements.txt`, `.gitignore`, `pyrightconfig.json` (para o autocomplete enxergar a venv) e `.vscode/settings.json`. O terminal do projeto já abre com a venv ativa, então `pip install` instala dentro dela.
4. A pasta é aberta e o `main.py` aparece no editor. O botão ▶ usa o Python da `.venv` automaticamente.

### HTML / CSS / JavaScript (com Live Server)
- O assistente pergunta o nome e a pasta e cria `index.html` (já ligado ao CSS e ao JS), `css/style.css`, `js/script.js` e a pasta `img/`.
- O botão **▶ / F5**, o botão **Go Live** na barra de status ou o clique direito no HTML iniciam o **Live Server embutido** (`src/liveServer.js`, sem dependências). Ele roda em `http://127.0.0.1:5500` e abre a página no navegador interno, ao lado do código. Também dá para usar o navegador do sistema com `devcode.liveServer.browser = "externo"`.
- Ao salvar, a página recarrega sozinha. Se o arquivo salvo for CSS, só o estilo é atualizado, sem recarregar a página.
- Para **iniciar** o servidor, o aluno precisa responder uma pergunta sobre o HTML, CSS ou JS aberto: para que serve uma tag, qual atributo, quantos `<li>` a lista tem, o que um seletor seleciona, qual propriedade CSS, o que significa `rem`/`px`/`%`… Depois de iniciado, o servidor recarrega livremente.

### React e React Native: mínimos, sem TypeScript (`extensions/devcode-quiz/src/jsProjects.js`)
Os dois precisam do **Node.js (LTS)** e de internet na criação.

| | React (Vite) | React Native (Expo) |
|---|---|---|
| Como é criado | Arquivos escritos pelo DevCode + `npm install react react-dom` e `npm install -D vite @vitejs/plugin-react` | Template oficial **blank** (`create-expo-app --template blank`) |
| Arquivos | `index.html`, `vite.config.js`, `package.json`, `src/main.jsx`, `src/App.jsx` (só um `<h1>`) | `App.js`, `index.js`, `app.json`, `package.json`, `assets/` |
| Removido | Nada de ESLint, CSS de exemplo, logos ou TypeScript | `tsconfig`, `LICENSE`, `.git` e os **arquivos de agentes de IA que o template traz** (`.claude/`, `AGENTS.md`, `CLAUDE.md`…) |
| ▶ / F5 | Pergunta → `npm run dev` → a página abre ao lado em `localhost:5173`, com recarga automática | Pergunta → `npx expo start` → o aluno lê o QR Code com o app **Expo Go** no celular |
| Tempo testado | ~10–20 s | ~1 min |

- O nome do projeto precisa ser em minúsculas, sem espaços (regra do npm). O assistente avisa.
- No terminal, `npm install` e `npx expo install` são liberados. Já `npm run dev`, `npm start`, `npx expo start` e `npx vite` só rodam **depois de acertar a pergunta**.
- `package.json` e `package-lock.json` não são vigiados pelo bloqueio de arquivos colados, porque o próprio npm os altera. A pasta `.expo` também é ignorada.
- **Perguntas de React** (além das de JavaScript): valor inicial e tipo de um `useState`, qual função altera o estado, o que acontece ao chamar o setter, quantas props um componente recebe, quando `onPress`/`onClick`/`onChangeText` executa, para que serve `<View>`, `<Text>`, `<Pressable>`, `<FlatList>`…

## Ambiente do terminal (`extensions/devcode-quiz/src/envFix.js`)
- **Política do PowerShell:** em PCs novos a política padrão é `Restricted`, que bloqueia o `npm.ps1`/`npx.ps1` e a integração de shell. Todo terminal do DEV CODE abre com `PSExecutionPolicyPreference=Bypass`, por meio de `environmentVariableCollection`. Isso vale **só para aquele terminal**, sem alterar o Windows e para qualquer conta de aluno.
- **PATH desatualizado:** a IDE relê o PATH do registro (máquina + usuário) e completa o dos terminais e dos processos da extensão. Assim o Node/Python instalados agora pelo instalador funcionam sem reiniciar o Windows.

## Terminal monitorado (`extensions/devcode-quiz/src/terminalGuard.js`)
O terminal fica disponível para `pip install`, `cd`, `git`, `npm` etc., mas **é fechado na hora** quando o aluno tenta:
| Tentativa | Exemplo |
|---|---|
| Código inline | `python -c "..."`, `node -e`, `ruby -e`, `php -r`, `perl -e` |
| Modo interativo (REPL) | `python`, `py -3`, `node`, `ipython`, `irb`, `php -a`, `jshell` |
| Gravar código pelo terminal | `echo ... > a.py`, `Set-Content`, `Out-File`, `tee`, heredoc `<<EOF` |
| Abrir outro shell | `cmd`, `bash`, `wsl`, `pwsh`, `powershell`, `start` |
| Avaliar, baixar ou colar | `iex`, `Invoke-Expression`, `Start-Process`, `curl`, `wget`, `Get-Clipboard`, `-EncodedCommand` |
| Rodar o programa sem a pergunta | `python main.py`, `node app.js`, `gcc …` antes de acertar o quiz |

Para essas regras funcionarem, a IDE precisa ver cada comando. Por isso:
- O perfil de terminal fica travado: **só PowerShell** no Windows, bash no Linux e zsh no macOS. Não há opção de cmd ou Git Bash.
- A integração de shell fica sempre ligada.
- Qualquer terminal em que a integração não ativar em 8 segundos é fechado.

## Arquivos colados no projeto (`extensions/devcode-quiz/src/fileGuard.js`)
Todo arquivo de código do projeto precisa ter sido **criado ou salvo dentro da IDE**.

| Situação | O que acontece |
|---|---|
| Arquivo de código **novo** que aparece por fora (colado pelo Windows Explorer, baixado direto na pasta, vindo de pendrive) | É **excluído** (vai para a lixeira) e aparece um aviso |
| Arquivo existente **sobrescrito** por fora | **Volta** ao último conteúdo salvo pela IDE |
| `.txt` baixado e renomeado para `.py`/`.html` no Explorer da IDE | Excluído |
| Feito com a IDE **fechada** | Detectado ao abrir o projeto: arquivos novos são excluídos e os alterados, restaurados |
| **Imagens, áudios e vídeos** | Sempre permitidos |
| Arquivos de dados (`.txt`, `.csv`…), `.venv`, `node_modules`, `__pycache__`, `bin/obj/dist/build` | Ignorados. Os programas dos alunos podem gerar arquivos normalmente |

**Como a IDE sabe quem criou o arquivo:** para cada arquivo de código, ela guarda o hash e uma cópia do conteúdo no armazenamento global da extensão (`globalStorage/.../fileguard`), **fora** da pasta do projeto. Um arquivo é aceito quando:
- o conteúdo no disco é exatamente o que o editor acabou de salvar;
- ele foi criado vazio pelo "Novo Arquivo" do Explorer da IDE (ou é uma cópia de um arquivo do próprio aluno); ou
- o conteúdo é **idêntico ao do último commit (HEAD)** do Git. É assim que `git pull`, `clone` e `checkout` feitos pela IDE são aceitos.

### Só projetos do DevCode podem ser abertos
- Uma pasta só é aceita se foi **criada pelo assistente** (Python / HTML) ou **baixada pelo "Projeto do Git"**. Só nesses dois casos a IDE registra o conteúdo inicial como confiável.
- Qualquer outra pasta aberta por Arquivo → Abrir Pasta, por arrastar ou por linha de comando mostra um aviso e **é fechada**. Assim, não dá para montar uma pasta com arquivos do GPT e abri-la.
- O assistente **recusa pastas que já existem e não estão vazias**.
- O botão ▶, o F5 e o Live Server **só executam arquivos de um projeto do DevCode**. Um arquivo solto, aberto sem pasta, não roda.
- **Material do professor:** publique-o num repositório do GitHub; o aluno baixa pelo "Projeto do Git".
- **Se a pasta for movida ou renomeada fora da IDE**, ela deixa de ser reconhecida. O aluno pode baixá-la de novo pelo Git.

## Projeto Colab: notebooks Python como o Google Colab
- **Onde fica:** card **Colab (notebook Python)** na Tela Inicial. O assistente é o mesmo do Python (nome, pasta, interpretador e `.venv`) e cria um `aula.ipynb` com uma célula de instruções e uma célula de código vazia.
- **Editor de notebooks:** é o nativo, com células, **+ Código / + Markdown**, ▶ por célula, **Executar tudo**, `Ctrl+Enter` / `Shift+Enter` e a saída logo abaixo da célula.
- **Kernel próprio, sem Jupyter** (`extensions/devcode-quiz/kernel/devcode_kernel.py` + `src/notebookKernel.js`). Ele usa o Python da `.venv` do projeto, um processo por notebook, e:
  - mantém as **variáveis entre as células**, como no Colab;
  - mostra o `print` **em tempo real** e o **valor da última linha** da célula (ex.: `x * y` mostra `21`);
  - abre o **`input()` dentro da célula**: aparece uma caixa de texto embaixo dela, o aluno digita e aperta Enter (`renderer/inputRenderer.js`);
  - mostra os **erros** com a linha do código do aluno e uma **💡 dica em português** (divisão por zero, nome não definido, sintaxe, indentação, tipos…);
  - exibe **gráficos do matplotlib** como imagem na saída, se a biblioteca estiver instalada (`pip install matplotlib` no terminal do projeto);
  - tem **Parar** (interromper) e **Reiniciar ambiente de execução** na barra do notebook, que apaga as variáveis como o "Reiniciar sessão" do Colab;
  - em **Executar tudo**, para no primeiro erro.
- **Pergunta do DEV CODE:** vale **por célula**. Antes de rodar uma célula nova ou alterada, o aluno responde uma pergunta sobre o código daquela célula.
- **Arquivos colados:** salvar o notebook conta como "salvo pelo editor". Um `.ipynb` colado de fora (baixado do Colab, por exemplo) é excluído como os outros arquivos de código.

## Versão 1.1.0
- **Modo Protótipo** (`src/prototypeEditor.js` + `media/proto/`): editor customizado para `*.devproto` (JSON). O documento é um TextDocument comum, então desfazer/refazer, salvar e o vigia de arquivos funcionam normalmente. A exportação PNG é desenhada em canvas, e as imagens são lidas como blob para não "sujar" o canvas.
- **Emulador Android** (`src/android.js`): instalação sob demanda em `%LOCALAPPDATA%\DevCode\android` (ou no SDK existente), com a imagem `system-images;android-34;default;x86_64` e o AVD `DevCode`. A extração usa o `tar.exe` do Windows (o `tar` do Git falha com `C:`).
- **IDE mais leve:**
  - o Copilot SDK (~190 MB) e o Dev Containers saíram do pacote;
  - **38 extensões** a menos (Mermaid, Markdown Math, sugestões do terminal, contas Microsoft, edição de extensões, npm/grunt/gulp/jake, Docker e linguagens não ensinadas);
  - a depuração JS embutida (`ms-vscode.js-debug*`) também foi removida.
- **Atualização automática corrigida:** o instalador cancelava em silêncio porque a IDE ainda estava aberta.
  - Agora um processo auxiliar espera a IDE fechar e só então instala, com log em `%TEMP%\devcode-update.log` e `devcode-update-setup.log`.
  - Em modo de atualização, o próprio instalador também espera até 60 s a IDE fechar. Isso corrige a atualização a partir das versões 1.0.x.

## Tela Inicial (`extensions/devcode-quiz/src/startPage.js`)
- **Quando aparece:** ao abrir a IDE sem projeto, abre a aba **Início**. Ela também está em **Arquivo → Tela Inicial** e no botão do Explorador.
- **O que tem:**
  - o logo do DEV CODE;
  - os cards **Python**, **HTML, CSS e JavaScript**, **React** e **React Native (Expo)**;
  - o bloco **Projeto do Git** (botão "Baixar do Git");
  - **Entrar no GitHub** / Sair;
  - a lista de **Projetos recentes**, só projetos do DEV CODE;
  - uma dica sobre o ▶ / F5 e a pergunta antes de executar.
- **Como funciona:** os cards usam as mesmas ações do assistente de projeto (`runProjectAction` em `project.js`).

## Interface enxuta e em português
- **Tema único:** só o **DEV CODE Light**. Os demais temas de cor não são carregados nem empacotados, e `workbench.colorTheme`, o modo escuro e o alto contraste ficam travados.
- **Idioma:** português do Brasil por padrão (`src/mainImpl.ts`), com o pacote `MS-CEINTL.vscode-language-pack-pt-BR` embutido. Na primeira execução a IDE reinicia sozinha uma vez para aplicar o idioma (`devcode.contribution.ts`). No modo de desenvolvimento (`scripts/code.bat`) a interface fica em inglês, porque o VS Code só aplica pacotes de idioma na versão empacotada.
- **Barra lateral:** só **Explorador** e **Pesquisa** (`paneCompositeBar.ts`). Saíram Controle de Código-Fonte, Executar e Depurar, Extensões, Remoto, Testes, Contas e a engrenagem de Gerenciar.
- **Barra de menus:** só **Arquivo e Terminal**. Editar, Exibir e Ajuda também saíram, mas os atalhos de teclado (Ctrl+Z, Ctrl+F, Ctrl+S, Ctrl+Shift+P…) continuam funcionando (`src/vs/platform/devcode/common/menuFilter.ts`, aplicado em `MenuRegistry.getMenuItems`, o que vale para todos os menus e para a paleta de comandos):
  - **Arquivo:** Novo ou Abrir Projeto, Novo Arquivo de Texto, Salvar, Salvamento Automático, Fechar, Enviar/Atualizar do GitHub e Sair;
  - **Terminal:** Executar Código (F5), Abrir com Live Server, Novo/Dividir Terminal;
  - **Retirados:** Seleção, Ir, Executar, Preferências, Abrir Recente, Nova Janela, perfis, workspaces, Abrir Pasta e Abrir Arquivo; copiar, recortar e colar (também dos menus de contexto); depuração, tarefas, ferramentas de desenvolvedor, links externos da Ajuda, "Passo a passo" e IA.
- **Navegador embutido** (Exibir → Navegador) retirado dos menus e da paleta, e o atalho `Ctrl+Alt+;` desativado, porque nele dava para abrir sites como o ChatGPT dentro da IDE.
- **Modo Restrito** (confiança de pasta) desligado: só abrem projetos criados ou baixados pelo DEV CODE.
- **Tela de boas-vindas do VS Code** desligada. No lugar, aparece o menu de projetos e o logo como marca d'água.

## Versão empacotada (Windows)
```
pnpm run gulp vscode-win32-x64-min
```
Gera `..\VSCode-win32-x64\DEV CODE.exe`. A assinatura digital (`signtool`) é opcional e só é feita se o Windows SDK estiver instalado, e o passo do Copilot é pulado. Para o instalador: `pnpm run gulp vscode-win32-x64-user-setup` (precisa do Inno Setup).

## Login no GitHub pela IDE (`extensions/devcode-quiz/src/githubAuth.js`)
- **Onde fica:** o botão **Entrar no GitHub** na barra de status (e no topo da aba Controle de Código-Fonte) usa o login de GitHub embutido no VS Code. Na build OSS, o login é pelo **código de dispositivo**: a IDE mostra um código, abre `github.com/login/device`, o aluno cola o código e autoriza.
- **Depois de entrar:** a barra mostra o usuário. Clicar nele permite **sair**, o que é importante em computadores compartilhados do laboratório.
- **Com o aluno logado:**
  - **Projeto do Git** lista **os repositórios da conta** (privados também), e basta clicar. Colar um link continua possível.
  - **Conectar ao GitHub** pode **criar o repositório na conta do aluno**, perguntando o nome e se é privado ou público, e já faz o primeiro envio.
  - O nome e o e-mail dos commits vêm do perfil do GitHub; a IDE não pergunta.
  - Clone, push e pull usam a conta logada.
- **O token não é gravado em disco** pelo DEV CODE nem aparece na lista de processos. Ele é passado ao git só durante o comando, por variáveis de ambiente (`GIT_CONFIG_*` → `http.https://github.com/.extraheader`).
- **Sem login**, tudo continua funcionando como antes: o Git Credential Manager do Windows pede o login quando precisa.
- **Para a versão final:** a escola pode registrar um *OAuth App* próprio no GitHub, para o nome "DEV CODE" aparecer na tela de autorização em vez de "Visual Studio Code".

## Git com cliques (`extensions/devcode-quiz/src/git.js`)
- **Ao abrir a IDE sem projeto**, aparece o menu: *Novo projeto Python*, *Novo projeto HTML/CSS/JS*, *Projeto do Git* e *Abrir projeto recente* (só projetos do DevCode).
- **Projeto do Git:** o aluno cola o link e escolhe a pasta. A IDE faz o `git clone` (com a janela de login do GitHub, se o repositório for privado), registra o projeto como confiável e abre.
- **Barra de status:**
  - **☁↑ Enviar:** salva tudo e pede só a mensagem. A IDE faz `add` + `commit` + `push` e pede nome e e-mail na primeira vez. Se o GitHub tiver mudanças novas, sugere *Atualizar* antes.
  - **☁↓ Atualizar:** faz o `git pull`. Os arquivos que vieram do GitHub são aceitos automaticamente. Se houver conflito, abre a aba Controle de Código-Fonte.
  - **Conectar ao GitHub** (projeto criado localmente): faz o `git init`, liga ao repositório vazio que o aluno colar e faz o primeiro envio.
- Os mesmos botões aparecem no topo da aba Controle de Código-Fonte. O pull feito por lá também é aceito.
- **Git pelo terminal é bloqueado**, exceto `git status`, `log`, `diff`, `branch` e `remote -v`. Assim, todo o fluxo passa pelos botões.

**Dentro da IDE também ficou bloqueado:**
- colar arquivos no Explorer (Ctrl+V / Colar), mesmo arquivos copiados no Windows;
- arrastar arquivos do Windows para a IDE. Se **todos** os arquivos arrastados forem imagem, áudio ou vídeo, o arraste é permitido.

## Bloqueios de linha de comando e de ferramentas de desenvolvedor
- `src/vs/platform/environment/node/argv.ts`: `--extensionDevelopmentPath`, `--extensionTestsPath`, `--extensions-dir`, `--builtin-extensions-dir`, `--install-extension`, `--disable-extension(s)`, `--enable-proposed-api`, `--inspect*`, `--remote-debugging-port` e outras são **descartadas** ao ler os argumentos. Isso vale para o executável e para o CLI.
- `extensionEnablementService.ts`: a extensão `vscode.devcode-quiz` não pode ser desativada e sempre conta como ativa.
- `src/vs/code/electron-main/app.ts`: na versão compilada, as Ferramentas de Desenvolvedor (console JavaScript, que permitiria inserir texto no editor) se fecham sozinhas ao abrir.

## Como compilar (Windows)
Pré-requisitos: Node (versão do `.nvmrc`), Python, Visual Studio Build Tools com "Desktop development with C++" e Git. Veja o guia oficial [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute).

```bash
npm install
```
```bash
npm run compile
```
```bash
.\scripts\code.bat
```
Para gerar o executável distribuível:
```bash
npm run gulp vscode-win32-x64-min
```
O resultado fica em `..\VSCode-win32-x64`. Depois, `npm run gulp vscode-win32-x64-user-setup` gera o instalador.

## Limitações conhecidas
1. **Redigitar o código do ChatGPT** não tem como ser bloqueado tecnicamente: digitar é exatamente o que a IDE quer que o aluno faça. Quem garante o entendimento é o quiz. Para reforçar, dá para aumentar o número de perguntas por execução ou registrar o histórico de respostas por aluno.
2. **Fora da IDE:** o aluno pode abrir o PowerShell do Windows e rodar o código por lá. Isso precisa ser bloqueado pela política do laboratório (GPO / AppLocker liberando só o DevCode).
3. **Perguntas por regras:** códigos muito avançados recebem perguntas mais genéricas. Novas regras ficam em `extensions/devcode-quiz/src/questions.js`.
4. **Terminal:** os bloqueios são por padrão de comando, então um aluno determinado ainda pode achar uma variação não coberta. Para fechar de vez, dá para desligar o terminal integrado e deixar só o botão ▶.
5. **Código do GPT que entra pelo GitHub:** o `git pull` é aceito por definição. Se o aluno colar código do GPT pelo site do GitHub (editor web) e depois clicar em *Atualizar*, o código entra. Para fechar isso, o professor pode verificar o histórico de commits feitos pela web ou proteger a branch para receber commits só por pull request.
6. A versão web (`serve-web`) usa o clipboard do navegador. Ali só a leitura foi bloqueada; o guard de eventos DOM cobre o restante.
