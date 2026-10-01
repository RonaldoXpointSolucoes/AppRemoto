export const setupGuideTitle = 'Guia de Setup do XPoint Remote e RustDesk';
export const setupGuideIntroduction = 'Prepare um computador Windows, cadastre-o na organização correta e acompanhe sua presença no painel. Marque cada item ao concluir a ação.';

export interface SetupStep {
  id: string;
  title: string;
  tasks: string[];
  details: string;
}

export function setupGuideSteps(apiBaseUrl: string): SetupStep[] {
  // Public config is validated; double apostrophes preserve PowerShell string quoting.
  const api = apiBaseUrl.replaceAll("'", "''");
  return [
    {
      id: "prepare",
      title: "Antes de começar",
      tasks: [
        "Use Windows 10 ou superior e uma conta Windows autorizada com privilégios de administrador para instalar o RustDesk e cadastrar o agente.",
        "Solicite à equipe XPoint o **remote-agent.exe**, sua versão e hash SHA-256 e um **enrollment token** válido para a organização correta. Os endereços do servidor RustDesk e a chave pública já estão disponíveis na etapa 2 deste guia.",
        "Use um cliente RustDesk oficial e suportado, aprovado pela equipe (mínimo previsto: 1.1.9). Garanta acesso HTTPS à API e conectividade com o servidor RustDesk.",
        "Escolha a conta Windows que executará o agente: cadastro e heartbeats precisam usar **a mesma conta e a mesma pasta de estado**.",
      ],
      details: `[Baixar o cliente RustDesk na fonte oficial](https://github.com/rustdesk/rustdesk/releases)`.replace('{{API_URL}}', api),
    },
    {
      id: "install",
      title: "Prepare o RustDesk e o agente",
      tasks: [
        "Instale o RustDesk no computador do cliente. Abra **Configurações → Rede** (ou o menu ao lado do ID) e desbloqueie as configurações quando solicitado.",
        "Copie **ID Server**, **Relay Server** e **Key** do quadro **Dados do servidor XPoint** acima para os campos de mesmo nome no RustDesk. Deixe **API Server** vazio e clique em **Aplicar**. Repita no computador do técnico.",
        "Confirme que o RustDesk exibe um ID e está pronto para conexão. O agente configura a senha unattended, mas **não instala o RustDesk nem configura esses servidores**.",
        "Obtenha **remote-agent.exe** pelo canal seguro indicado pela equipe. Confira a versão e o hash antes de executar e salve em uma pasta permanente. A distribuição pública automática do agente ainda não está disponível.",
        "Abra o PowerShell com **Executar como administrador**, na conta Windows escolhida. A aplicação da senha unattended exige RustDesk instalado e execução elevada. Se o Windows solicitar credenciais de outra conta, confirme com a equipe qual conta será dona do estado antes de cadastrar: a DPAPI não permite trocar de usuário depois. Ajuste o caminho de **$Agent** abaixo. A URL da API é a configurada neste painel.",
      ],
      details: `[Consultar a configuração oficial do RustDesk](https://rustdesk.com/docs/en/self-host/client-configuration/)

[Documentação do agente e obtenção do binário com a equipe](https://github.com/RonaldoXpointSolucoes/AppRemoto/blob/main/docs/operations/windows-agent.md)

~~~powershell
$Agent = 'C:\\XPoint\\remote-agent.exe' # Ajuste para onde salvou o arquivo
$State = Join-Path $env:LOCALAPPDATA 'XPoint\\RemoteAgent'
$Api = '{{API_URL}}'

Test-Path -LiteralPath $Agent
Get-FileHash -LiteralPath $Agent -Algorithm SHA256
& $Agent
~~~

**Test-Path** deve retornar **True**. Compare o SHA-256 com o valor recebido da equipe. Sem argumentos, o agente mostra **usage: remote-agent enroll|run [options]** e encerra com código 2; isso é esperado nessa conferência e não cadastra o dispositivo. Não existe subcomando **help** nesta versão.

A pasta **$State** será criada e protegida pelo próprio agente durante o cadastro; não é necessário criá-la manualmente.`.replace('{{API_URL}}', api),
    },
    {
      id: "enroll",
      title: "Cadastre o dispositivo (enrollment)",
      tasks: [
        "Solicite ao administrador um token não expirado para a **organização de teste ou cliente correta**. O painel ainda não emite tokens; a equipe prepara o token pelo fluxo administrativo autorizado.",
        "Execute o bloco abaixo na mesma janela elevada do PowerShell. Digite o token somente no prompt oculto: ele é enviado ao agente pela entrada padrão, sem ficar no comando ou no histórico.",
        "Aguarde **device enrolled**. Se aparecer **device already enrolled**, a pasta contém um cadastro concluído; use-a para iniciar o agente.",
      ],
      details: `~~~powershell
$EnrollmentToken = Read-Host 'Enrollment token' -AsSecureString
try {
  [System.Net.NetworkCredential]::new('', $EnrollmentToken).Password | & $Agent enroll \`
    -api-url $Api \`
    -state-dir $State \`
    -display-name $env:COMPUTERNAME
  if ($LASTEXITCODE -ne 0) {
    throw 'Cadastro não confirmado. Preserve a pasta de estado e contate o administrador.'
  }
} finally {
  $EnrollmentToken.Dispose()
  Remove-Variable EnrollmentToken
}
~~~

Se o RustDesk estiver fora das pastas reconhecidas, solicite à equipe o caminho absoluto confiável e acrescente **-rustdesk-path 'C:\\caminho\\RustDesk.exe'** ao comando enroll e ao comando run. O agente valida o executável; uma cópia portátil em pasta não confiável pode ser recusada.

**Se o cadastro falhar:** preserve a pasta de estado e informe a mensagem à equipe. Uma interrupção pode ocorrer depois do consumo do token. Não apague a pasta nem repita o cadastro com outra identidade por tentativa.`.replace('{{API_URL}}', api),
    },
    {
      id: "unattended",
      title: "Confira o acesso unattended",
      tasks: [
        "Conferi com a equipe a configuração de senha permanente no RustDesk.",
        "Confirmei que o estado do agente permanece na mesma conta Windows, protegido pela DPAPI.",
      ],
      details: `Após um cadastro bem-sucedido, o agente aplica automaticamente a senha permanente de acesso unattended no RustDesk local. O token do dispositivo e a senha ficam protegidos pela **DPAPI**, vinculados à conta Windows usada no cadastro.

Abra **Configurações → Segurança** no RustDesk e confira com a equipe que o uso de senha permanente está habilitado. Não revele, copie nem substitua a senha gerenciada. A prova de conexão deve ser feita por um técnico autorizado; uma configuração na tela, sozinha, não comprova uma sessão remota.`.replace('{{API_URL}}', api),
    },
    {
      id: "presence",
      title: "Inicie o agente e confira no painel",
      tasks: [
        "Aguarde **agent running** e mantenha a janela aberta. Essa mensagem confirma o início do processo; confira o resultado no painel.",
        "Volte para **Dispositivos**, selecione a organização correta e busque pelo nome do computador ou RustDesk ID. Use **Atualizar dispositivos** se necessário.",
        "Confira nome, organização e ID do registro. O painel atualiza periodicamente; **ONLINE** depende de heartbeats recentes.",
        "Sei que, se aparecer uma falha de atualização com status **Indisponível**, devo preservar o estado e pedir à equipe para verificar o painel, sem cadastrar novamente o computador.",
        "Sei como reiniciar o agente depois e vou mantê-lo em execução durante a conferência e a conexão remota.",
      ],
      details: `Na mesma janela do PowerShell, inicie o envio de presença (heartbeats):

~~~powershell
& $Agent run -api-url $Api -state-dir $State
~~~

O status **Indisponível** em uma falha de atualização não confirma falha no cadastro.

Quando terminar de usar o agente, **Ctrl+C** encerra o envio de presença. O agente atual é manual: após reiniciar o computador ou fechar a janela, abra o PowerShell na mesma conta, defina novamente **$Agent**, **$State** e **$Api** como na etapa 2 e execute somente **run**. Não repita o enrollment de um cadastro concluído.`.replace('{{API_URL}}', api),
    },
    {
      id: "connect",
      title: "Próximo passo: conexão remota",
      tasks: [
        "Combinei com a equipe como realizar a conexão remota autorizada.",
      ],
      details: `A conexão em um clique pelo painel, a geração de tokens na página Setup e a instalação automática ainda estão planejadas. Para uma sessão agora, siga o procedimento autorizado da equipe no cliente RustDesk. Este guia não inicia nem libera uma conexão remota.

Se precisar de suporte, informe a etapa, a mensagem de erro e o nome do dispositivo. **Nunca envie tokens, senhas ou arquivos de credenciais.**`.replace('{{API_URL}}', api),
    },
  ];
}

// Plain Markdown remains available for command verification and documentation.
export function setupGuideMarkdown(apiBaseUrl: string): string {
  return [
    '# ' + setupGuideTitle,
    setupGuideIntroduction,
    ...setupGuideSteps(apiBaseUrl).map((step, index) =>
      ['## ' + (index + 1) + '. ' + step.title, ...step.tasks.map((task) => '- ' + task), step.details].join('\n\n')),
  ].join('\n\n');
}
