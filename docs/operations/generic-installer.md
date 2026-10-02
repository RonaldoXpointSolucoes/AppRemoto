# Instalador completo e reutilizavel

Versao: 1.2.2. Este documento descreve o contrato; a
publicacao e a homologacao em Windows precisam de evidencia separada.

## Uso pelo tecnico

1. No painel, baixar o instalador completo uma vez.
2. Copiar o mesmo arquivo para os computadores dos clientes.
3. Executar, aceitar a elevacao normal do Windows e informar empresa e nome
   do computador no formulario nativo.
4. Acompanhar as etapas no instalador. Conclusao exige cadastro e heartbeat
   confirmado pela API; download ou processo iniciado nao significam sucesso.
5. Abrir Dispositivos no painel e usar Conectar. RustDesk tambem deve estar
   instalado no computador do tecnico.

O cliente precisa de internet para cadastro e comunicacao, mas nao precisa
abrir o painel nem entrar na conta do tecnico. O executavel contem o RustDesk
oficial e o configurador XPoint. Uma instalacao RustDesk confiavel existente e
aproveitada; caminhos ou servicos conflitantes nao sao substituidos cegamente.

O arquivo `.log` fica ao lado do executavel e recebe o mesmo nome, inclusive
quando o navegador acrescenta um sufixo ao download. Logs identificam etapa,
operacao, resultado e codigo seguro; nunca senhas, tokens, argumentos de
processo, respostas HTTP completas ou informacoes digitadas pelo tecnico.

## Autorizacao reutilizavel e senha comum

O usuario solicitou explicitamente a mesma senha permanente em todas as
maquinas e cadastro sem login durante a instalacao. A API conserva a senha em
`GENERIC_INSTALLER_SHARED_PASSWORD`, segredo exclusivo de runtime. O painel
e o executavel distribuido nao recebem essa senha como configuracao.

Cada arquivo distribuido contem uma autorizacao de cadastro reutilizavel.
Somente superadministradores emitem, baixam novamente ou revogam essas
autorizacoes. Ela nao e uma API key Appwrite nem uma credencial de tecnico.
O escopo permite preparar cadastros, criar/reutilizar a empresa solicitada e
emitir um enrollment temporario vinculado a tentativa. Nao permite listar
dispositivos, ler credenciais existentes ou editar usuarios.

A autorizacao e um segredo contido no download: trate esse arquivo como
material de uso interno. Revoga-la impede novos cadastros e pacotes pendentes;
nao remove dispositivos ja instalados nem troca suas senhas. Como a senha e
comum, um portador do pacote que cadastre uma maquina pode obter essa senha
durante o protocolo. Limitar endpoints nao elimina esse risco inerente a
senha compartilhada. Nao publique o EXE personalizado em um endereco aberto.

O bundle publico, sem autorizacao, contem somente binarios e configuracao
publica. O navegador acrescenta a autorizacao em memoria depois de conferir
o hash do bundle. Ela nunca entra em URL, storage, cache de consultas ou log.

## Empresas, identidade e recuperacao

Empresa e nome sao digitados no Windows. A API valida e normaliza os nomes e
reutiliza uma empresa existente somente quando a correspondencia e segura.
Nome de empresa nao substitui um ID de tenant nos endpoints do agente.
Colisoes ambiguas e organizacoes desativadas precisam de diagnostico explicito.

O instalador persiste identificador aleatorio e segredo da tentativa com
DPAPI antes da primeira requisicao. Repetir a preparacao com a mesma tentativa
recupera o mesmo pacote, sem criar outra empresa ou enrollment. Nomes nao sao
chaves de identidade da maquina. Reinstalacao preserva o UUID e exige prova
da credencial existente antes de atualizar o cadastro.

O fluxo legado V1 permanece disponivel e mantem sua semantica de senha por
dispositivo. Executar o instalador generico sobre uma instalacao anterior
deve aplicar a senha comum somente naquela maquina, com estado protegido e
confirmacao da API. Nao existe migracao silenciosa de todos os endpoints.

Enrollment inicial cuja resposta se perde apos commit e antes de gravar
credenciais continua sujeito a reconciliacao. Nunca apague identidade,
receipts ou guards para esconder um resultado incerto. Consulte
`apps/api/ENROLLMENT.md`.

## Binarios e redistribuicao

- Wrapper XPoint: Windows x64, Go, versao 1.2.2.
- RustDesk: binario oficial 1.4.9, `rustdesk-1.4.9-x86_64.exe`.
- Tamanho RustDesk: 24.472.432 bytes.
- SHA256: `eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274`.
- Origem: <https://github.com/rustdesk/rustdesk/releases/tag/1.4.9>.
- Codigo-fonte: <https://github.com/rustdesk/rustdesk/tree/1.4.9>.
- Licenca oficial incluida: `services/agent/internal/setup/assets/rustdesk-LICENCE.txt`.

O build fixa versao, tamanho e SHA256; nao segue `latest`. O instalador verifica
novamente o payload antes da execucao. O servico XPoint recebe somente o
segmento Go, sem payload RustDesk e sem autorizacao de cadastro distribuida.

Formato bundle: `[EXE Go][EXE RustDesk][uint64 LE tamanho Go]`
`[uint64 LE tamanho RustDesk][ASCII XPOINT_BUNDLE_V1]`.
Depois, o painel acrescenta JSON UTF-8 estrito
`{schemaVersion:2,installerId,installerToken}`, comprimento uint32 LE e
`XPOINT_GENERIC_V1`. O overlay legado V1 continua separado.

Build: `node apps/panel/scripts/build-installer.mjs`. `GO_BINARY` pode informar
o executavel Go local. `RUSTDESK_INSTALLER_FILE` permite usar uma copia local,
sempre sujeita ao hash fixado. Docker compila o Go e monta o mesmo formato.
O manifesto `complete-manifest.json` identifica o pacote completo;
`manifest.json` continua identificando o configurador sem RustDesk.

Nao ha certificado Authenticode provisionado. Integridade SHA256 e assinatura
Windows sao mecanismos diferentes; nao apresentar este pacote como assinado.

## Privilegios e limites reais

O instalador usa UAC normal e servicos automaticos LocalSystem. As permissoes
de suporte incluem teclado, clipboard, transferencia de arquivos e reinicio,
com leitura de confirmacao. Nao desativa UAC, antivirus, firewall ou bloqueio
de tela. Recursos indiscriminados de camera, tunel ou privacidade nao sao
necessarios para cumprir suporte administrativo.

Os servidores ID/relay e chave publica sao fixados no XPoint. O RustDesk OSS
oficial permite que um administrador local altere configuracoes; esse fluxo
nao promete um cliente customizado inviolavel. API Server do RustDesk fica
vazio, pois a API XPoint nao pertence a esse campo.

Escala adaptada e uma preferencia do computador do tecnico: RustDesk,
Configuracoes, Tela, estilo de visualizacao padrao, Adaptada. Gravar uma opcao
sem efeito no computador cliente nao atende esse requisito. Fonte primaria:
<https://rustdesk.com/docs/en/self-host/client-configuration/advanced-settings/#view-style>.

## Publicacao e evidencias

Antes de publicar: contratos/testes API, schema gerado e plano restrito sem
conflitos, testes Windows do bundle/DPAPI/recuperacao, testes do painel e build
com payload real. Nunca instalar RustDesk no computador de desenvolvimento
como efeito colateral dos testes.

Aplicar apenas as mudancas canonicas de schema, configurar o segredo novo
somente na API, publicar API pelo procedimento stop/zero/start e depois o
painel. Validar health, manifesto, hash, endpoints autenticados e fixture
isolada; revogar apenas a autorizacao de teste e desativar apenas a fixture.

Testes sinteticos, CLI e portas TCP nao comprovam uma instalacao limpa,
reinicio Windows ou sessao remota real. Esses aceites precisam de uma maquina
ou VM apropriada. Registre o que foi exercitado e o que ainda falta.
