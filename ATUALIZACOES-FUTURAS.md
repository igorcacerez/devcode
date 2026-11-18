# Atualizações futuras do DEV CODE

Ideias aprovadas que ainda não foram implementadas, com as regras de negócio já definidas.

## Modo Codar em Equipe (colaboração em tempo real na rede local)

### Objetivo
Permitir que vários alunos, no mesmo laboratório (mesma rede), editem o mesmo projeto ao mesmo tempo, vendo em tempo real quem está em cada linha. Funciona sem internet e sem conta Microsoft (por isso não usamos o Live Share).

### Papéis
- **Anfitrião:** o aluno que tem o projeto na própria máquina. O computador dele vira o servidor da sessão e é o único lugar onde os arquivos ficam gravados.
- **Convidado:** o aluno que entra na sessão. Edita os arquivos do anfitrião pela rede; nada é copiado para o computador dele, exceto o que estiver aberto no editor.

### Fluxo
1. O anfitrião abre o projeto e clica em **Codar em equipe → Iniciar sessão**.
2. O DEV CODE sobe um servidor (WebSocket) numa porta fixa, por exemplo 4570, e mostra:
   - o IP e um código curto de 6 caracteres (ex.: `K7P-2QX`);
   - a lista de quem está conectado.
3. A sessão é anunciada na rede local (broadcast UDP/mDNS), para aparecer na lista dos colegas.
4. O convidado clica em **Codar em equipe → Entrar**. Ele escolhe a sessão na lista ou digita o IP, informa o código e o nome dele.
5. O convidado abre o projeto do anfitrião numa janela do DEV CODE, com o sistema de arquivos remoto (FileSystemProvider próprio, esquema `devcode-team://`).
6. O anfitrião pode remover um participante ou encerrar a sessão. Ao encerrar, todos os convidados são desconectados e a janela deles fecha o projeto.

### Edição em tempo real
- **Sincronização:** CRDT (Yjs) por arquivo aberto. Edições simultâneas na mesma linha se juntam sem conflito e sem "último que salvou ganha".
- **Gravação no disco:** é feita só pelo anfitrião, a cada salvamento de qualquer participante (debounce de 1 s).
- **Cursores dos colegas:**
  - cada participante tem uma cor fixa na sessão;
  - o cursor e a seleção dele aparecem nos outros editores (decorations), com uma etiqueta com o nome do aluno ao lado da linha;
  - a barra lateral **Equipe** lista os participantes com arquivo e linha atuais, e clicar no nome leva até onde ele está ("seguir colega");
  - na barra de rolagem, uma marca mostra onde cada colega está no arquivo aberto.
- **Arquivos e pastas:** criar, renomear e apagar vale para todos. Apagar pede confirmação e fica registrado no histórico da sessão.

### Regras que continuam valendo (regras do DEV CODE)
- **Sem colar e sem IA:** os bloqueios valem em todas as máquinas. A edição que chega de um colega não conta como "colar", porque foi digitada por alguém dentro do DEV CODE.
- **Vigia de arquivos:**
  - o anfitrião aceita as gravações da sessão;
  - continua bloqueando arquivos que aparecem na pasta por fora do DEV CODE (copiar e colar no Windows Explorer).
- **Pergunta antes de executar:**
  - quem clica em ▶ responde a pergunta na própria máquina;
  - o código roda no computador do anfitrião e a saída do terminal é transmitida para quem pediu a execução;
  - convidados não têm terminal livre na máquina do anfitrião, só o botão ▶;
  - Live Server e Vite são acessados pelo IP do anfitrião.
- **Projeto confiável:** só projetos criados ou baixados pelo DEV CODE podem ser compartilhados.
- **Registro para o professor:** o histórico da sessão fica no projeto (`.devcode/equipe.log`), com quem entrou, quem saiu, quais arquivos cada um editou e quantas linhas. Assim o professor vê a participação de cada aluno.

### Segurança e rede
- A sessão só aceita conexões da mesma sub-rede, e só com o código correto.
- O código muda a cada nova sessão.
- No máximo 6 participantes por sessão (configurável).
- **Firewall:**
  - o instalador cria a regra de entrada para a porta da sessão (só redes privadas/domínio);
  - se a porta estiver bloqueada, a IDE mostra uma mensagem explicando o que o professor precisa liberar.
- O tráfego é só na rede local; nada passa pela internet.

### Limites da primeira versão
- Notebooks (Colab), Protótipo, Teste e Banco de Dados não entram na edição conjunta; só arquivos de texto.
- Depuração (F5 com breakpoints) só no anfitrião.
- Se o anfitrião desligar ou perder a rede, os convidados recebem um aviso e ficam com uma cópia local, só para leitura, do que estava aberto.

### Estimativa
Cerca de 2 a 3 dias:
- servidor e descoberta na rede;
- FileSystemProvider remoto;
- CRDT por arquivo;
- cursores e painel Equipe;
- execução remota;
- regra de firewall no instalador;
- testes com duas máquinas.
