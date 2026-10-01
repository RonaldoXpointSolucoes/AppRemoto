export function setupGuideMarkdown(apiBaseUrl: string): string {
  // Public config is validated; double apostrophes preserve PowerShell string quoting.
  const api = apiBaseUrl.replaceAll("'", "''");
  return `# Guia de Setup do XPoint Remote e RustDesk

Prepare um computador Windows, cadastre-o na organização correta e acompanhe sua presença no painel. Siga as etapas na ordem indicada.

## 1. Antes de começar

- Use Windows 10 ou superior e uma conta Windows autorizada com privilégios de administrador para instalar o RustDesk e cadastrar o agente.
- Solicite à equipe XPoint o **remote-agent.exe**, sua versão e hash SHA-256, um **enrollment token** válido para a organização correta, os endereços ID/relay e a chave pública do servidor RustDesk.
- Use um cliente RustDesk oficial e suportado, aprovado pela equipe (mínimo previsto: 1.1.9). Garanta acesso HTTPS à API e conectividade com o servidor RustDesk.
- Escolha a conta Windows que executará o agente: cadastro e heartbeats precisam usar **a mesma conta e a mesma pasta de estado**.

[Baixar o cliente RustDesk na fonte oficial](https://github.com/rustdesk/rustdesk/releases)

## 2. Prepare o RustDesk e o agente

1. Instale o RustDesk no computador do cliente. Abra **Configurações → Rede** (ou o menu ao lado do ID) e desbloqueie as configurações quando solicitado.
2. Preencha **ID Server** e **Key** com o servidor e a chave pública fornecidos pela XPoint. Use **Relay Server** conforme a orientação do administrador e aplique a mesma configuração no computador do técnico. No RustDesk Server OSS, deixe **API Server** vazio: a API do AppRemoto usada abaixo não pertence a esse campo.
3. Confirme que o RustDesk exibe um ID e está pronto para conexão. O agente configura a senha unattended, mas **não instala o RustDesk nem configura esses servidores**.
4. Obtenha **remote-agent.exe** pelo canal seguro indicado pela equipe. Confira a versão e o hash antes de executar e salve em uma pasta permanente. A distribuição pública automática do agente ainda não está disponível.
5. Abra o PowerShell com **Executar como administrador**, na conta Windows escolhida. A aplicação da senha unattended exige RustDesk instalado e execução elevada. Se o Windows solicitar credenciais de outra conta, confirme com a equipe qual conta será dona do estado antes de cadastrar: a DPAPI não permite trocar de usuário depois. Ajuste o caminho de **$Agent** abaixo. A URL da API é a configurada neste painel.

[Consultar a configuração oficial do RustDesk](https://rustdesk.com/docs/en/self-host/client-configuration/)

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

A pasta **$State** será criada e protegida pelo próprio agente durante o cadastro; não é necessário criá-la manualmente.

## 3. Cadastre o dispositivo (enrollment)

1. Solicite ao administrador um token não expirado para a **organização de teste ou cliente correta**. O painel ainda não emite tokens; a equipe prepara o token pelo fluxo administrativo autorizado.
2. Execute o bloco abaixo na mesma janela elevada do PowerShell. Digite o token somente no prompt oculto: ele é enviado ao agente pela entrada padrão, sem ficar no comando ou no histórico.
3. Aguarde **device enrolled**. Se aparecer **device already enrolled**, a pasta contém um cadastro concluído; use-a para iniciar o agente.

~~~powershell
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

**Se o cadastro falhar:** preserve a pasta de estado e informe a mensagem à equipe. Uma interrupção pode ocorrer depois do consumo do token. Não apague a pasta nem repita o cadastro com outra identidade por tentativa.

## 4. Confira o acesso unattended

Após um cadastro bem-sucedido, o agente aplica automaticamente a senha permanente de acesso unattended no RustDesk local. O token do dispositivo e a senha ficam protegidos pela **DPAPI**, vinculados à conta Windows usada no cadastro.

Abra **Configurações → Segurança** no RustDesk e confira com a equipe que o uso de senha permanente está habilitado. Não revele, copie nem substitua a senha gerenciada. A prova de conexão deve ser feita por um técnico autorizado; uma configuração na tela, sozinha, não comprova uma sessão remota.

## 5. Inicie o agente e confira no painel

Na mesma janela do PowerShell, inicie o envio de presença (heartbeats):

~~~powershell
& $Agent run -api-url $Api -state-dir $State
~~~

1. Aguarde **agent running** e mantenha a janela aberta. Essa mensagem confirma o início do processo; confira o resultado no painel.
2. Volte para **Dispositivos**, selecione a organização correta e busque pelo nome do computador ou RustDesk ID. Use **Atualizar dispositivos** se necessário.
3. Confira nome, organização e ID do registro. O painel atualiza periodicamente; **ONLINE** depende de heartbeats recentes.
4. Se o alerta de falha de atualização aparecer com status **Indisponível**, isso não confirma falha no cadastro. Preserve o estado e peça à equipe para verificar a atualização do painel. Evite cadastrar novamente o mesmo computador.
5. Para encerrar, use **Ctrl+C**. O agente atual é manual: após reiniciar o computador ou fechar a janela, abra o PowerShell na mesma conta, defina novamente **$Agent**, **$State** e **$Api** como na etapa 2 e execute somente **run**. Não repita o enrollment de um cadastro concluído.

## 6. Próximo passo: conexão remota

A conexão em um clique pelo painel, a geração de tokens na página Setup e a instalação automática ainda estão planejadas. Para uma sessão agora, siga o procedimento autorizado da equipe no cliente RustDesk. Este guia não inicia nem libera uma conexão remota.

Se precisar de suporte, informe a etapa, a mensagem de erro e o nome do dispositivo. **Nunca envie tokens, senhas ou arquivos de credenciais.**`.replace('{{API_URL}}', api);
}
