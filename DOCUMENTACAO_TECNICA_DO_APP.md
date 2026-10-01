# Documentacao Tecnica do App

> Documento canonico de onboarding tecnico do AppRemoto.
>
> Leitura obrigatoria antes de alterar codigo, banco, Appwrite, Coolify, RustDesk, agentes Windows ou contratos da API.

**Ultima consolidacao:** 1 de outubro de 2026  
**Repositorio:** `RonaldoXpointSolucoes/AppRemoto`  
**Produto:** XPoint Remote / AppRemoto  
**Estado deste documento:** descreve o que existe no codigo e na infraestrutura ate a data acima. Funcionalidades apenas planejadas aparecem explicitamente como pendentes.

## 1. Regra principal para trainees e IAs

Antes de implementar qualquer demanda:

1. Leia este documento inteiro.
2. Leia o card da demanda e confirme que ele esta em `development` antes de executar `fila dev`.
3. Localize o modulo responsavel e os runbooks citados aqui.
4. Consulte `infra/appwrite/src/schema.ts` antes de propor uma colecao ou campo.
5. Reutilize campos, indices, contratos, repositorios e servicos existentes.
6. Diferencie claramente codigo existente, infraestrutura implantada, evidencia antiga e funcionalidade planejada.
7. Nao altere Appwrite, Coolify ou dados de producao por inferencia. Descubra o alvo ao vivo, limite o escopo e confirme o resultado uma vez.
8. Nunca copie segredos para codigo, documentacao, card, chat, terminal capturado, screenshot ou log.

### Quando NAO criar uma nova colecao

Nao crie uma colecao apenas porque o nome do novo recurso parece diferente. Primeiro responda:

- O dado ja pertence a uma das 11 colecoes documentadas na secao 8?
- O campo ja existe com outro nome canonico?
- O requisito pode ser atendido por um novo endpoint/projecao sem mudar persistencia?
- O dado e calculado, como `ONLINE`/`OFFLINE`, e portanto nao deve ser persistido?
- O dado e secreto e ja possui armazenamento protegido especifico?
- A mudanca exige migracao dos documentos existentes e atualizacao do provisionador idempotente?

Uma mudanca de schema somente e valida quando atualiza, em conjunto:

- `infra/appwrite/src/schema.ts`, fonte canonica;
- `infra/appwrite/schema.md`, gerado a partir da fonte;
- testes de schema, inspect, plan e apply;
- repositorios e contratos consumidores;
- runbook de provisionamento e estrategia de migracao;
- verificacao read-only posterior no projeto Appwrite correto.

Nunca crie manualmente no console uma tabela ou campo para contornar o provisionador. Isso produz divergencia entre codigo e producao.

## 2. Visao geral do produto

O AppRemoto e uma plataforma de acesso remoto para tecnicos da XPoint. Ele combina:

- autenticacao e persistencia no Appwrite;
- uma API propria que aplica autorizacao e protege dados sensiveis;
- um painel web operacional para listar dispositivos;
- um agente Windows em Go para cadastro e presenca;
- RustDesk Server OSS para transporte das sessoes remotas;
- Coolify para executar API, painel e RustDesk em producao.

O painel nao conversa diretamente com as colecoes privadas. O navegador usa o Appwrite somente para criar a sessao do tecnico e emitir um JWT curto. Toda leitura operacional passa pela `remote-api`.

O JWT da sessao e reutilizado somente em memoria por ate 12 minutos (validade padrao Appwrite: 15 minutos), compartilhando uma emissao entre requisicoes concorrentes. Inicio, encerramento ou expiracao da sessao limpam essa memoria e rejeitam emissoes tardias da sessao anterior. O polling nao deve criar um JWT por requisicao: esse comportamento atingiu o limite de emissao observado em producao. Senhas RustDesk continuam fora desse cache.

```text
Tecnico no navegador
    |
    | sessao + JWT
    v
Appwrite Auth <------> remote-panel (Next.js)
                           |
                           | Bearer JWT
                           v
                      remote-api (Fastify)
                           |
                           | Server SDK + API key privada
                           v
               Appwrite database remote_management

Computador do cliente
    |
    +--> remote-agent.exe --> enrollment/heartbeat --> remote-api
    |
    +--> RustDesk Client --> hbbs/hbbr --> RustDesk do tecnico
```

## 3. Links e identificadores

| Recurso | Endereco ou identificador | Uso |
| --- | --- | --- |
| Repositorio | `https://github.com/RonaldoXpointSolucoes/AppRemoto` | Codigo e documentacao versionados |
| Painel de producao | `https://hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io` | Login e diretorio de dispositivos |
| Dispositivos | `https://hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io/devices` | Tela operacional atual |
| Health do painel | `https://hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io/health` | Deve responder HTTP 200 com `{"status":"ok"}` |
| API de producao | `https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io` | Backend operacional |
| Health da API | `https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io/health` | Deve responder HTTP 200 com `{"status":"ok"}` |
| Appwrite customizado | `https://appwrite.xpointsolucoes.com.br` | Servico de identidade e dados |
| Appwrite API | `https://appwrite.xpointsolucoes.com.br/v1` | Endpoint usado pela aplicacao |
| Appwrite Console | `https://appwrite.xpointsolucoes.com.br/console/project-default-6abc5640003cb361b809` | Administracao tecnica |
| Appwrite Project ID | `6abc5640003cb361b809` | Projeto exclusivo do AppRemoto |
| Appwrite Database ID | `remote_management` | Banco operacional |
| Coolify | `https://coolify.xpointsolucoes.com.br` | Deploy, containers, variaveis e logs |
| Coolify API app UUID | `qyrjepou8xchzlfirsbrhwr9` | Aplicacao `remote-api` |
| Coolify panel app UUID | `hr1uqo4mlsw3sm7s2mehiaa2` | Aplicacao `remote-panel` |
| Quadro de desenvolvimento | `https://chat-boot-theta.vercel.app/crm/kanban/64ea89ca-c413-49eb-be7f-80349620b92c` | Cards App Acesso Remoto |
| Board ID | `64ea89ca-c413-49eb-be7f-80349620b92c` | Escopo fixo da skill `fila dev` |

O Appwrite Console e o Coolify sao consoles administrativos, nao telas alternativas do produto. O uso diario do tecnico deve acontecer no AppRemoto.

## 4. Estado funcional atual

### Implementado no codigo

- Monorepo TypeScript/Go com contratos compartilhados.
- Schema Appwrite idempotente e protecoes de alvo exato.
- Bootstrap de administrador tecnico com artefato DPAPI local.
- API Fastify com autenticacao de tecnico, listagem de organizacoes/dispositivos, enrollment e heartbeat.
- Painel Next.js com login, listagem responsiva, filtros, busca, paginacao, polling e logout com revogacao de sessao.
- `/setup` prepara um EXE Windows para cliente/nome selecionados e acompanha o receipt/heartbeat daquela instalacao. O checklist manual de 6 etapas e 20 itens fica recolhido para suporte.
- Endpoint de operador cria enrollment token de 256 bits, uso unico e validade de 30 minutos; apenas hash e auditoria persistidos. Status correlaciona receipt committed e heartbeat confirmado, sem busca pelo nome. Nao exige alteracao de schema.
- Configurador Windows x64 1.0.2 em `services/agent/cmd/remote-setup`: exige RustDesk ja instalado com servico automatico LocalSystem, verifica o executavel confiavel, configura acesso e cadastra o servico XPoint com estado DPAPI. Nao baixa nem instala RustDesk. Janela com seis etapas e log com mesmo nome/pasta do EXE, sem argumentos, tokens ou senhas. Distribuicao base gerada no Docker do painel; personalizacao em memoria no navegador com token de uso unico. Nao e um instalador assinado.
- Agente Windows manual com identidade estavel, DPAPI, discovery do RustDesk, configuracao de senha unattended, enrollment e heartbeat resiliente.
- Protecoes de recuperacao para escritas de enrollment/heartbeat incertas.
- MCP local `appwrite-xpoint` com perfis separados e credenciais DPAPI.
- Skill local `fila-dev-app-acesso-remoto` para consultar/processar o quadro autorizado.

### Implantado em producao

- `remote-api` no Coolify, com dominio HTTPS e health check.
- `remote-panel` no Coolify, com dominio HTTPS e health check.
- Projeto Appwrite exclusivo e database `remote_management`.
- RustDesk Server OSS com componentes `hbbs` e `hbbr` e portas publicas.
- Administrador tecnico bootstrap e perfil `super_admin`.

### Ainda nao implementado ou nao homologado

- Homologacao do instalador automatico em um Windows cliente real, incluindo UAC, SYSTEM/DPAPI, reboot e acesso remoto.
- A tentativa 1.0.1 do cliente parou em ENROLLMENT_STATE antes do cadastro. A 1.0.2 corrige uma falha reproduzida como SYSTEM quando o proprietario padrao do token e Administradores: arquivos novos recebem explicitamente o dono correto, sem afrouxar a validacao dos existentes. Testes nativos cobrem ambos os donos padrao, DPAPI e retomada sem duplicar cadastro. O instalador consulta metadados de recuperacao com leitura administrativa limitada a uma thread, sem abrir credenciais ou alterar ACLs. O log discrimina as operacoes de identidade/estado e conserva codigos Win32/NTSTATUS; a causa exata no cliente depende de novo log, pois a 1.0.1 a descartava. Deploy apenas do painel; aceite no cliente, reboot e sessao RustDesk real ainda pendentes.
- A tentativa real da versao 1.0.0 foi reportada pelo usuario com janela sem progresso e codigo BUSY. A versao 1.0.1 diferencia erro de bloqueio, registra operacoes do servico e permite substituir uma tentativa comprovadamente anterior ao envio do enrollment; credenciais salvas preservam o cadastro original. Enrollment pendente sem credenciais continua exigindo reconciliacao. Testes automatizados nao substituem repetir a instalacao no cliente.
- Prova de abertura de sessao real pelo botao Conectar. A entrega transitoria de senha ao RustDesk foi autorizada explicitamente pelo usuario; o endpoint exige canConnect, organizacao ativa, dispositivo online e heartbeat confirmado antes de consultar a credencial. Descriptografia/validacao e auditoria confirmada precedem a resposta no-store. O painel nao exibe nem armazena a URI e descarta respostas de sessoes encerradas.
- Gestao de organizacoes, tecnicos e RBAC pelo painel.
- Rotacao completa de credenciais e historico de sessoes.
- Prova final com dois computadores/VMs, conexao direta e relay.
- Homologacao real da transicao ONLINE -> OFFLINE -> ONLINE.
- MSI assinado, auto-update e desinstalacao assistida.
- Backups/restauracao e monitoramento operacional completos.

O alerta atual de falha de atualizacao dos dispositivos em producao e um defeito conhecido e esta no primeiro card de analise. Enquanto ele existir, dados retidos podem ser exibidos, mas o status e marcado como indisponivel.

## 5. Estrutura do repositorio

| Caminho | Responsabilidade |
| --- | --- |
| `apps/api` | API Fastify, autenticacao/autorizacao, acesso Server SDK, enrollment, heartbeat e auditoria |
| `apps/panel` | Painel Next.js/React, sessao Appwrite Web SDK e UI operacional |
| `services/agent` | Agente Windows em Go |
| `packages/contracts` | Schemas Zod e tipos compartilhados da API |
| `infra/appwrite` | Fonte canonica do schema, inspect/plan/apply e bootstrap admin |
| `tools/appwrite-mcp` | MCP local para operacoes Appwrite autorizadas |
| `.agents/skills/appwrite-xpoint` | Regras de uso do MCP Appwrite neste repositorio |
| `docs/operations` | Runbooks de Appwrite, API, painel e agente |
| `docs/superpowers/specs` | Especificacoes aprovadas; nao significam necessariamente funcionalidade pronta |
| `docs/superpowers/plans` | Planos historicos de implementacao |
| `.local` | Credenciais DPAPI, binarios e evidencias privadas; ignorado pelo Git |

### Ferramentas e versoes-base

- Node.js: `>=24 <25`.
- Gerenciador: `pnpm@11.19.0`.
- API: Fastify 5, TypeScript, `node-appwrite` 17.
- Painel: Next.js 16, React 19, TanStack Query 5, Appwrite Web SDK 21, Zod 4.
- Agente: Go 1.26 e `golang.org/x/sys`.
- Testes: Node Test Runner, Vitest, Testing Library, Playwright e Go test.

## 6. Responsabilidade de cada servico

### Appwrite

Responsavel por:

- contas e sessoes dos tecnicos;
- emissao/validacao de JWT por meio dos SDKs;
- armazenamento das 11 colecoes do database `remote_management`;
- indices, unicidade e persistencia.

Nao e responsabilidade do Appwrite:

- renderizar o painel;
- calcular regras de tenant no navegador;
- guardar plaintext de tokens ou senhas RustDesk;
- transportar a sessao remota.

Todas as colecoes possuem permissoes de colecao vazias (`[]`) e document security desabilitado. Isso e intencional: somente a API com Server SDK acessa os documentos. Nao libere acesso direto ao frontend para "facilitar" uma tela.

### remote-api

Responsavel por:

- validar JWT do tecnico contra Appwrite;
- carregar perfil e memberships;
- aplicar `can_view`, `can_connect` e `can_manage_devices`;
- proteger isolamento entre organizacoes;
- emitir projecoes seguras ao painel;
- validar/consumir enrollment tokens;
- gerar device token e senha unattended;
- cifrar senha com AES-256-GCM;
- registrar dispositivos, heartbeats e auditoria;
- falhar fechado quando uma escrita distribuida fica incerta.

O servico deve continuar com uma unica replica e um unico processo. O protocolo atual de enrollment/heartbeat nao autoriza sobreposicao de duas instancias escritoras.

### remote-panel

Responsavel por:

- criar/remover sessao Appwrite no navegador;
- pedir JWT curto ao Appwrite;
- chamar a API com `Authorization: Bearer <jwt>`;
- exibir somente projecoes seguras;
- manter filtros, paginacao e polling sem mostrar cache como estado atual;
- limpar dados protegidos na troca/expiracao de sessao.

O painel jamais recebe API key Appwrite, master encryption key, enrollment token persistido, device token ou senha RustDesk em configuracao publica.

### remote-agent

Responsavel por:

- gerar/carregar `device_uuid` estavel;
- coletar hostname e versao do Windows;
- localizar um `RustDesk.exe` confiavel;
- ler ID e versao do RustDesk;
- fazer enrollment uma vez;
- proteger device token e senha com DPAPI do usuario atual;
- aplicar senha unattended no RustDesk;
- enviar heartbeat com jitter e backoff.

O comando manual continua disponivel e nao inicia sozinho apos boot. O novo `cmd/remote-setup` registra o servico automatico `XPointRemoteAgent` como LocalSystem, com estado proprio em ProgramData; esse fluxo ainda requer homologacao em endpoint real. Consulte `services/agent/SETUP.md` para overlay, build, ACL, recuperacao e limites de compatibilidade.

### RustDesk Server OSS

- `hbbs`: rendezvous/ID e coordenacao inicial.
- `hbbr`: relay quando conexao direta nao e possivel.
- Portas esperadas: `21115/TCP`, `21116/TCP`, `21116/UDP`, `21117/TCP`.
- Dados/chaves devem permanecer em volumes persistentes.

Existe um `infra/rustdesk/compose.yaml` local nao versionado no checkout primario, com imagem proposta `rustdesk/rustdesk-server:1.1.16`. Ele nao esta presente no commit atual deste worktree e nao deve ser tratado como fonte canonica. Antes de alterar RustDesk, inspecione o servico real no Coolify, confirme imagem, comandos, volumes, host/relay e depois versione uma definicao revisada. Nunca regenere ou substitua a chave do servidor sem plano de migracao dos clientes.

Em 2026-10-01, consulta ao servico existente confirmou ID Server `179.199.142.157:21116`, Relay Server `179.199.142.157:21117`, chave publica Ed25519 de 32 bytes correspondente ao hbbs em execucao e alcance das portas TCP 21115/21116/21117. O tutorial mostra os valores publicos em `apps/panel/src/features/setup/rustdesk-server-config.tsx`, com botoes de copia e API Server vazio. Nao houve alteracao ou reinicio do RustDesk. Esta verificacao nao substitui a prova de uma sessao remota entre dois clientes nem comprova UDP.

### Coolify

Responsavel por:

- build e execucao de API/painel;
- segredos e variaveis de runtime;
- health checks, dominios HTTPS e logs;
- servico Docker Compose do RustDesk.

Projeto/ambiente aprovados: `Remote Platform/production`. Nao altere outros projetos ou o Appwrite hospedado ao trabalhar no AppRemoto.

## 7. Fluxos principais

### Login do tecnico

1. `/login` recebe e-mail e senha no navegador.
2. Appwrite Web SDK cria a sessao.
3. O painel pede um JWT ao Appwrite.
4. `GET /v1/me` valida o JWT na API.
5. A API carrega `technician_profiles`, organizacoes ativas e memberships.
6. Perfil ausente/inativo resulta em acesso negado e remocao da sessao.
7. Perfil valido segue para `/devices`.

### Listagem de dispositivos

1. Painel chama `GET /v1/organizations`.
2. Painel chama `GET /v1/devices` com filtros e cursor.
3. API restringe resultados as organizacoes autorizadas.
4. `ONLINE` e calculado quando `enabled=true` e `last_seen_at` esta dentro de 90 segundos; caso contrario, `OFFLINE`.
5. O painel atualiza a cada 30 segundos, sem sobrepor uma requisicao ativa.

Nao adicione uma coluna `status` em `devices`: status e derivado de `enabled` + `last_seen_at` + relogio da API.

### Enrollment do agente

1. Operador fornece enrollment token ao agente por entrada padrao.
2. Agente prepara diretorio protegido e identidade estavel.
3. Agente descobre ID/versao do RustDesk.
4. `POST /v1/agent/enroll` valida payload, IP, rate limit e token.
5. API cria/atualiza `devices`, `device_tokens`, `device_credentials`, `enrollment_receipts` e `audit_logs` com compensacao/recovery.
6. Plaintexts do device token e senha retornam somente uma vez.
7. Agente protege ambos com DPAPI e configura a senha RustDesk.

Se houver falha depois de consumir token, preserve artefatos e receipts. Nao apague estado e nao tente "comecar de novo" sem ler `apps/api/ENROLLMENT.md`.

### Heartbeat

1. Agente chama `POST /v1/agent/heartbeat` usando device token.
2. API autentica pelo hash, valida revogacao e device habilitado.
3. Uma guarda evita concorrencia/resultado incerto por device.
4. API atualiza `last_seen_at`, `last_ip` e versoes.
5. Auditoria registra somente metadados nao secretos.
6. Sucesso agenda proximo envio perto de 30 s com jitter; falha aplica backoff exponencial ate 2 minutos.

## 8. Banco de dados Appwrite

### Visao geral

- Database: `remote_management`.
- Fonte canonica: `infra/appwrite/src/schema.ts`.
- Documento gerado: `infra/appwrite/schema.md`.
- Estado desejado atual, calculado diretamente de `schema.ts`: 11 colecoes, 69 atributos e 27 indices, totalizando 108 recursos incluindo o database.
- O runbook de provisionamento ainda contem referencias historicas a 104 recursos, anteriores a `heartbeat_guards`. Nao remova recursos para fazer a producao coincidir com essa contagem antiga; atualize o runbook quando o proximo card de schema for executado.
- IDs relacionais sao strings de ate 36 caracteres; Appwrite nao cria foreign keys. A API garante integridade e tenant isolation.
- Nao use documentos completos em respostas. Cada repositorio usa `Query.select` para projeções minimas.

### 8.1 `organizations`

Representa cada cliente/empresa isolada.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `name` | string(128), obrigatorio | Nome exibido |
| `slug` | string(64), obrigatorio, unico | Identificador humano estavel |
| `active` | boolean, obrigatorio | Desativacao logica da organizacao |

Indice: `u_slug`.  
Nao crie outra tabela de clientes/empresas. Novos dispositivos e memberships referenciam `$id` desta colecao.

### 8.2 `technician_profiles`

Complementa o usuario do Appwrite Auth com informacoes da aplicacao.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `user_id` | string(36), obrigatorio, unico | `$id` do usuario no Appwrite Auth |
| `display_name` | string(128), obrigatorio | Nome mostrado no painel/auditoria |
| `global_role` | enum opcional | Atualmente somente `super_admin` |
| `active` | boolean, obrigatorio | Habilita ou bloqueia acesso ao AppRemoto |

Nao duplique e-mail/senha aqui. Credenciais pertencem ao Appwrite Auth. `global_role=null` significa que permissoes devem vir de memberships.

### 8.3 `organization_members`

Liga tecnico a organizacao e define RBAC local.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `organization_id` | string(36), obrigatorio | Referencia `organizations.$id` |
| `user_id` | string(36), obrigatorio | Referencia Appwrite Auth/`technician_profiles.user_id` |
| `role` | string(64), obrigatorio | Rotulo funcional local |
| `can_view` | boolean, obrigatorio | Pode visualizar organizacao/dispositivos |
| `can_connect` | boolean, obrigatorio | Pode iniciar acesso remoto |
| `can_manage_devices` | boolean, obrigatorio | Pode cadastrar/administrar dispositivos |

Indices: unico composto `organization_id + user_id`, busca por organizacao e por usuario.  
Nao crie uma tabela separada para cada permissao. Adicione nova flag somente com regra de negocio e migracao claras.

### 8.4 `devices`

Registro canonico de cada computador gerenciado.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `organization_id` | string(36), obrigatorio | Tenant proprietario |
| `device_uuid` | string(36), obrigatorio | Identidade estavel gerada pelo agente |
| `display_name` | string(128), obrigatorio | Nome amigavel definido no cadastro |
| `hostname` | string(255), obrigatorio | Nome do Windows |
| `rustdesk_id` | string(64), obrigatorio | ID usado na conexao RustDesk |
| `operating_system` | string(64), obrigatorio | Sistema operacional |
| `os_version` | string(128), obrigatorio | Versao do sistema |
| `agent_version` | string(64), opcional | Versao instalada do agente |
| `rustdesk_version` | string(64), opcional | Versao instalada do RustDesk |
| `last_seen_at` | datetime opcional | Ultimo heartbeat confirmado |
| `last_ip` | string(45), opcional | IP canonico do ultimo heartbeat |
| `enabled` | boolean, obrigatorio | Desativacao logica do dispositivo |

Indices: identidade unica por `organization_id + device_uuid`; buscas por organizacao, `last_seen_at`, nome, hostname e RustDesk ID.  
Nao crie campos `online`, `offline`, `status` ou `last_activity`: use `last_seen_at` e a regra de 90 segundos. Nao use `rustdesk_id` como identidade primaria; ele pode mudar, enquanto `device_uuid` preserva a identidade do agente.

### 8.5 `device_tokens`

Autentica heartbeats do agente.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `device_id` | string(36), obrigatorio | Referencia `devices.$id` |
| `token_hash` | string(64), obrigatorio, unico | SHA-256 do device token |
| `last_used_at` | datetime opcional | Ultimo uso autenticado |
| `revoked_at` | datetime opcional | Revogacao administrativa imutavel |

O plaintext nunca e armazenado. Nao reutilize esta colecao para tokens de tecnico, enrollment ou conexao.

### 8.6 `heartbeat_guards`

Guarda duravel de uma atualizacao de heartbeat em andamento/incerta.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `device_id` | string(36), obrigatorio | Device protegido pela guarda |
| `device_token_id` | string(36), obrigatorio | Token participante |
| `started_at` | datetime, obrigatorio | Inicio da operacao |

O `$id` e derivado para garantir uma guarda por device. Nao use como historico de heartbeat e nao apague guardas manualmente sem seguir o procedimento de recovery.

### 8.7 `device_credentials`

Armazena a senha unattended do RustDesk cifrada.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `device_id` | string(36), obrigatorio, unico | Referencia `devices.$id` |
| `password_ciphertext` | string(4096), obrigatorio | Ciphertext AES-256-GCM |
| `password_nonce` | string(128), obrigatorio | Nonce do envelope |
| `password_tag` | string(128), obrigatorio | Tag de autenticacao |
| `key_version` | integer, obrigatorio | Versao da master key usada |

Nunca adicione `password`, `plain_password` ou equivalente. Trocar `MASTER_ENCRYPTION_KEY` sem migracao multi-key torna credenciais existentes indecifraveis.

### 8.8 `enrollment_tokens`

Autoriza o primeiro cadastro de um agente em uma organizacao.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `organization_id` | string(36), obrigatorio | Organizacao autorizada |
| `token_hash` | string(64), obrigatorio, unico | SHA-256 do token |
| `expires_at` | datetime, obrigatorio | Expiracao absoluta |
| `max_uses` | integer, obrigatorio | Limite de consumos |
| `use_count` | integer, obrigatorio | Consumos confirmados |
| `active` | boolean, obrigatorio | Estado operacional |
| `created_by_user_id` | string(36), obrigatorio | Tecnico criador |
| `revoked_at` | datetime opcional | Revogacao administrativa imutavel |

Plaintext aparece somente na criacao. Revogacao administrativa escreve `active=false` e `revoked_at` no mesmo fluxo; nao limpe `revoked_at` nem reative um token revogado.

### 8.9 `enrollment_receipts`

Registra a operacao de consumo para idempotencia, compensacao e recovery.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `organization_id` | string(36), obrigatorio | Tenant da operacao |
| `enrollment_token_id` | string(36), obrigatorio | Token consumido |
| `device_id` | string(36), obrigatorio | Device resultante |
| `device_uuid` | string(36), obrigatorio | Identidade apresentada |
| `status` | enum obrigatorio | `pending` ou `committed` |
| `token_use_consumed` | boolean, obrigatorio | Consumo comprovado |
| `expected_use_count` | integer, obrigatorio | Contagem esperada apos commit |
| `recovery_frozen` | boolean, obrigatorio | Bloqueio duravel de recovery incerto |

Indices: unico por `enrollment_token_id + device_uuid`; buscas por organizacao, device e status.  
Esta colecao nao e fila generica. Nunca force `pending -> committed`, altere contadores ou limpe `recovery_frozen` sem prova exata dos artefatos descrita em `apps/api/ENROLLMENT.md`.

### 8.10 `connection_sessions`

Schema reservado para sessoes curtas de conexao remota.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `organization_id` | string(36), obrigatorio | Tenant |
| `device_id` | string(36), obrigatorio | Dispositivo alvo |
| `technician_user_id` | string(36), obrigatorio | Tecnico solicitante |
| `connect_token_hash` | string(64), obrigatorio, unico | Hash do token efemero |
| `expires_at` | datetime, obrigatorio | Expiracao |
| `redeemed_at` | datetime opcional | Momento de consumo |
| `status` | enum obrigatorio | `pending`, `redeemed`, `expired`, `failed` |
| `source_ip` | string(45), obrigatorio | Origem canonica |

Indices por organizacao, device e tecnico.  
A colecao ja existe; nao crie outra tabela para "historico de conexao" antes de implementar e avaliar este modelo. O fluxo de conexao ainda esta planejado, nao ativo.

### 8.11 `audit_logs`

Registro de seguranca para enrollment e heartbeat, extensivel a futuras acoes.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `organization_id` | string(36), obrigatorio | Tenant relacionado |
| `actor_type` | enum obrigatorio | `technician`, `device` ou `system` |
| `actor_id` | string(36), obrigatorio | Autor seguro da acao |
| `device_id` | string(36), opcional | Device relacionado |
| `action` | string(64), obrigatorio | Ex.: `device.enroll`, `device.heartbeat` |
| `result` | enum obrigatorio | `success` ou `failure` |
| `source_ip` | string(45), obrigatorio | Origem canonica |
| `metadata_json` | string(16384), obrigatorio | JSON redigido, nunca segredo |

Indices por organizacao, device e action.  
Nao grave payloads integrais, Authorization, cookies, tokens, senhas, chaves, ciphertext ou respostas SDK nesta colecao.

### Relacionamentos logicos

```text
Appwrite Auth user
   | 1
   | 1
technician_profiles
   |
   | N
organization_members N ---- 1 organizations
                                  |
                                  | N
                               devices
                         /          |          \
                        1           1           N
              device_tokens  device_credentials audit_logs
                        |
                        | heartbeat safety
                 heartbeat_guards

organizations 1 ---- N enrollment_tokens
enrollment_tokens 1 ---- N enrollment_receipts N ---- 1 devices

technician + organization + device ---- connection_sessions (planejado)
```

## 9. API atual

| Metodo e rota | Autenticacao | Estado | Responsabilidade |
| --- | --- | --- | --- |
| `GET /health` | Nenhuma | Implementado | Health exato `{"status":"ok"}` |
| `GET /v1/me` | JWT tecnico | Implementado | Perfil e autorizacao efetiva |
| `GET /v1/organizations` | JWT tecnico | Implementado | Organizacoes visiveis |
| `GET /v1/devices` | JWT tecnico | Implementado | Busca, filtro e paginacao segura |
| `POST /v1/agent/enroll` | Enrollment token no body | Implementado | Primeiro cadastro e credenciais |
| `POST /v1/agent/heartbeat` | Device Bearer token | Implementado | Presenca e versoes |
| `POST /v1/enrollment-tokens` | JWT + manage devices | Implementado | Token de uso unico e 30 minutos |
| `GET /v1/enrollment-tokens/:enrollmentId/status` | JWT + manage devices | Implementado | Receipt committed e heartbeat da instalacao |
| `POST /v1/devices/:deviceId/connect` | JWT + connect | Implementado | Entrega transitoria ao RustDesk apos autorizacao e auditoria |

Todos os payloads usam schemas estritos e rejeitam campos desconhecidos. Erros externos sao genericos; detalhes sensiveis nao devem aparecer em logs.

## 10. Configuracao e segredos

### Variaveis da API no Coolify

| Nome | Classe |
| --- | --- |
| `APPWRITE_ENDPOINT` | Configuracao, alvo exato |
| `APPWRITE_PROJECT_ID` | Configuracao, alvo exato |
| `APPWRITE_API_KEY` | Segredo |
| `MASTER_ENCRYPTION_KEY` | Segredo AES-256 |
| `MASTER_ENCRYPTION_KEY_VERSION` | Configuracao versionada |
| `ALLOWED_ORIGINS` | Origem HTTPS exata do painel |
| `PORT` | Porta do container |
| `API_REPLICAS` | Deve permanecer `1` |
| `WEB_CONCURRENCY` | Deve permanecer `1` |
| `TRUST_PROXY` | `false` ou IPs/CIDRs explicitos |
| `NODE_ENV` | Runtime |

O runbook menciona inventario de 12 nomes; antes de alterar, confira `docs/operations/remote-api.md` e o estado vivo do Coolify, pois a documentacao historica pode divergir de uma contagem textual.

### Variaveis publicas do painel

| Nome | Valor de producao |
| --- | --- |
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | `https://appwrite.xpointsolucoes.com.br/v1` |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | `6abc5640003cb361b809` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io` |

Tudo que comeca com `NEXT_PUBLIC_` fica visivel no navegador. Nunca coloque segredo nesse prefixo.

### Arquivos privados locais

Diretorio principal: `.local/remote-platform/`.

Exemplos existentes:

- `appwrite-api-key.dpapi`: chave Appwrite protegida.
- `bootstrap-<uuid>.dpapi`: senha bootstrap protegida.
- `bin/remote-agent.exe`: build Windows local, nao versionado.
- `apply-*.json`, `inspect-*.json`, `plan-*.json`: evidencias locais redigidas.
- `production-panel-auth.json`: resultado redigido do verificador privado.

Tambem existem credenciais locais especificas para `fila dev` e MCP Appwrite sob `.local/`. DPAPI CurrentUser depende do mesmo usuario/perfil Windows; erro ao descriptografar em outro contexto nao justifica converter o segredo para texto puro.

## 11. Deploy e operacao

### API

- Dockerfile: `apps/api/Dockerfile`.
- Coolify app: `remote-api`, UUID `qyrjepou8xchzlfirsbrhwr9`.
- Auto-deploy desabilitado.
- Uma replica e um processo.
- Mudanca exige: parar, provar zero instancia antiga, iniciar/deployar exatamente uma instancia, validar health/logs.
- Rolling restart nao e procedimento aprovado porque pode sobrepor escritores.

Leia `docs/operations/remote-api.md` antes de qualquer operacao.

### Painel

- Dockerfile: `apps/panel/Dockerfile`.
- Coolify app: `remote-panel`, UUID `hr1uqo4mlsw3sm7s2mehiaa2`.
- Next.js standalone, porta 3000, usuario final `node` sem privilegio.
- Auto-deploy desabilitado.
- Appwrite Web platform deve conter somente o hostname HTTPS aprovado.
- CORS da API deve conter a origem HTTPS exata, nunca `*`.

Leia `docs/operations/remote-panel.md` antes de deploy/rollback.

### Appwrite

Com credencial carregada apenas em memoria:

```powershell
pnpm --filter @appremoto/appwrite provision inspect
pnpm --filter @appremoto/appwrite provision plan
# apply somente com autorizacao e plano sem conflito
pnpm --filter @appremoto/appwrite provision apply
```

O apply cria faltantes, aguarda readiness e faz bootstrap; ele nao apaga/recria recursos incompatíveis. Conflito exige diagnostico e migracao revisada.

Leia `docs/operations/appwrite-provisioning.md` antes de qualquer apply.

### Agente Windows manual

```powershell
$Agent = 'C:\path\to\remote-agent.exe'
$State = Join-Path $env:LOCALAPPDATA 'XPoint\RemoteAgent'
$Api = 'https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io'

Read-Host 'Enrollment token' | & $Agent enroll `
  -api-url $Api `
  -state-dir $State `
  -display-name $env:COMPUTERNAME

& $Agent run -api-url $Api -state-dir $State
```

Este comando e operacionalmente sensivel. Nao invente enrollment token, nao passe token por argumento e nao apague state directory apos falha incerta.

## 12. Desenvolvimento local

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build

pnpm --filter @appremoto/panel dev
pnpm --filter @appremoto/panel test:e2e

Set-Location services/agent
go test ./...
go build ./cmd/remote-agent
```

Use testes focados proporcionais a mudanca. O pedido atual prioriza concluir funcionalidades e evita baterias repetidas sem falha concreta. Isso nao autoriza afirmar sucesso sem a validacao minima do fluxo alterado.

## 13. Skills e integracoes internas

### `fila dev`

- Skill exclusiva do projeto AppRemoto e board `64ea89ca-c413-49eb-be7f-80349620b92c`.
- Somente cards em `development` podem ser implementados.
- Cards em `analysis`, backlog, testing e production sao somente consultados.
- Entrega concluida e verificada vai para `testing` com relatorio tecnico.
- Credencial do quadro fica em `.local/fila-dev/` protegida por DPAPI.

### MCP Appwrite

- Servidor: `tools/appwrite-mcp/server.mjs`.
- Perfil correto deste produto: `appremoto-production`.
- O perfil `chatboot-production` e outro sistema. Nunca misture IDs, bancos, buckets ou chaves.
- Mutacao exige pedido explicito, `confirmed=true` e uma leitura focada posterior.

### Coolify

O plugin privado `mcp-coolify` consulta/gerencia a instancia XPoint. Sempre descubra IDs e schemas ao vivo. Nao use inventario antigo como confirmacao atual e nao envie token no chat.

## 14. Pendencias organizadas no quadro

Em 1 de outubro de 2026 foram criados 10 cards em `Em Analise`, nesta sequencia:

1. Estabilizar atualizacao/status de dispositivos em producao.
2. Criar wizard Setup e endpoint seguro de enrollment token.
3. Automatizar instalacao RustDesk/agente e inicializacao no boot.
4. Adicionar conexao RustDesk em um clique.
5. Homologar Windows, presenca e sessao RustDesk ponta a ponta.
6. Empacotar MSI assinado, servico, atualizacao e desinstalacao.
7. Criar gestao de organizacoes, tecnicos e RBAC.
8. Completar sessoes, auditoria, rotacao e revogacao.
9. Implantar backup, restauracao, observabilidade e runbooks.
10. Executar validacoes adiadas de seguranca, acessibilidade e escala.

Eles permanecem fora de desenvolvimento ate liberacao manual. Outra IA deve reler o card ao iniciar, pois o card contem dependencias e criterios mais detalhados.

Posteriormente, neste chat, o usuario solicitou diretamente automatizar os seis passos com instalador e acesso em um clique. A implementacao local descrita acima segue esse pedido direto; nao houve movimentacao desses cards de Analise.

## 15. Regras de seguranca que nao podem ser flexibilizadas

- Nunca registrar ou exibir API keys, master key, senhas, JWTs, cookies, enrollment/device/connect tokens ou chave privada RustDesk.
- Nunca colocar segredo em `NEXT_PUBLIC_*`.
- Nunca reutilizar credencial de outro projeto Appwrite.
- Nunca liberar colecoes Appwrite diretamente ao browser.
- Nunca confiar em `organizationId` recebido sem recalcular autorizacao.
- Nunca transformar falha de persistencia em sucesso presumido.
- Nunca reusar token revogado ou limpar `revoked_at`.
- Nunca apagar receipts/guards/estado do agente para esconder operacao incerta.
- Nunca trocar master key sem suporte multi-key e migracao testada.
- Nunca ampliar CORS para `*` como correcao rapida.
- Nunca subir segunda replica da API atual.
- Nunca alterar recursos Coolify fora de `Remote Platform/production`.
- Nunca alegar teste RustDesk ponta a ponta apenas com portas TCP, mock ou screenshot.

## 16. Como diagnosticar sem baguncar

### Painel mostra status indisponivel

1. Nao altere `ONLINE/OFFLINE` no frontend.
2. Verifique uma unica requisicao de `/v1/organizations` e `/v1/devices`.
3. Diferencie 401, CORS, rede, 503 e resposta invalida.
4. Confira alinhamento entre Appwrite Web hostname e `ALLOWED_ORIGINS`.
5. Preserve a protecao que mascara status em cache durante falha.

### Enrollment falhou

1. Preserve state directory e artefatos locais.
2. Nao gere retry cego com outro device UUID.
3. Leia `apps/api/ENROLLMENT.md`.
4. Consulte receipt/token/device por IDs seguros, sem exportar documentos completos.
5. Se nao houver prova do resultado, mantenha frozen e faca reconciliacao manual.

### DPAPI nao abre

1. Confirme o mesmo usuario/perfil Windows que criou o arquivo.
2. Tente fora do sandbox somente quando autorizado.
3. Nao converta para plaintext e nao cole segredo em chat.
4. Se a credencial foi perdida, siga rotacao/revogacao do servico correspondente.

### Deploy parece saudavel, mas app falha

1. Confirme commit realmente implantado.
2. Confirme health publico e health do container.
3. Inspecione apenas logs necessarios e redija segredos.
4. Para API, confirme que nao ha duas instancias.
5. Para painel, valide as tres variaveis publicas e o CORS exato.

## 17. Fontes canonicas por assunto

| Assunto | Fonte primaria |
| --- | --- |
| Schema desejado | `infra/appwrite/src/schema.ts` |
| Schema legivel | `infra/appwrite/schema.md` |
| Provisionamento | `docs/operations/appwrite-provisioning.md` |
| Recuperacao enrollment | `apps/api/ENROLLMENT.md` |
| Operacao API | `docs/operations/remote-api.md` |
| Operacao painel | `docs/operations/remote-panel.md` |
| Operacao agente | `docs/operations/windows-agent.md` |
| Contratos HTTP | `packages/contracts/src` |
| Rotas ativas | `apps/api/src/app.ts` |
| Desenho do MVP | `docs/superpowers/specs/2026-09-29-remote-platform-mvp-design.md` |
| Desenho futuro do Setup | `docs/superpowers/specs/2026-10-01-technician-setup-design.md` |
| Instalacao automatica Windows | `services/agent/SETUP.md` e `docs/superpowers/specs/2026-10-01-automatic-installer-design.md` |
| Fila futura | Quadro App Acesso Remoto |

## 18. Checklist antes de entregar uma alteracao

- [ ] Li este documento e o card atualizado.
- [ ] Confirmei modulo e fonte canonica.
- [ ] Verifiquei se campo/colecao/endpoint ja existe.
- [ ] Mantive tenant isolation e projecoes minimas.
- [ ] Nao expus segredo em codigo, log, UI, Git ou relatorio.
- [ ] Atualizei contratos/schema/runbook quando aplicavel.
- [ ] Rodei somente testes focados necessarios e registrei resultados reais.
- [ ] Diferenciei teste local, mock, smoke e evidencia real.
- [ ] Confirmei uma unica vez qualquer mutacao externa.
- [ ] Documentei limitacoes sem declarar trabalho nao executado.

## 19. Principio de manutencao

O objetivo nao e aumentar o numero de arquivos, tabelas ou servicos. O objetivo e preservar um sistema pequeno, explicavel e confiavel. Primeiro estenda o modelo existente; somente adicione uma nova estrutura quando houver uma responsabilidade realmente nova, uma consulta impossivel de atender com o schema atual e um plano claro de migracao, seguranca, operacao e rollback.
