'use client';

import { useState } from 'react';
import {
  Sparkles,
  X,
  Smartphone,
  Monitor,
  Folder,
  HardDrive,
  CheckCircle2,
  Zap,
  Star,
  Layers,
  ShieldCheck,
} from 'lucide-react';

export interface ReleaseNoteItem {
  title: string;
  description: string;
  tag: 'Mobilidade' | 'UI/UX' | 'TeamViewer' | 'Infra & Cockpit' | 'Novo';
}

export interface ReleaseVersion {
  version: string;
  date: string;
  title: string;
  highlight: string;
  isCurrent?: boolean;
  items: ReleaseNoteItem[];
}

export const PLATFORM_RELEASES: ReleaseVersion[] = [
  {
    version: 'v1.7.0',
    date: 'Outubro 2026',
    title: 'Conexão Remota Instantânea via Relay Direto (hbbs/hbbr) & Eliminação de Race Condition de Pareamento',
    highlight:
      'Eliminação do atraso de 6 a 10 segundos de NAT hole-punching malsucedido em CGNAT (ALWAYS_USE_RELAY=Y), correção da condição de corrida de pareamento simultâneo no hbbr (TOKIO_WORKER_THREADS=1 + RUST_LOG=warn) e redução de 50% nas leituras do endpoint /connect.',
    isCurrent: true,
    items: [
      {
        title: 'Pareamento Imediato via Relay (Zero Espera de Hole-Punching UDP/CGNAT)',
        description:
          'Ativação de ALWAYS_USE_RELAY=Y no servidor hbbs e eliminação da condição de corrida em hbbr que causava timeout de 30s seguido de reconexão automática quando ambos os pares conectavam no mesmo microssegundo.',
        tag: 'TeamViewer',
      },
      {
        title: 'Endpoint /connect sem Leituras Duplicadas & Cache de Preflight CORS (24h)',
        description:
          'Reutilização de contexto pré-verificado e paralelização via Promise.all no backend, eliminando 4 leituras redundantes no Appwrite a cada clique em Conectar.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.6.9',
    date: 'Outubro 2026',
    title: 'Busca Multi-Dados Instantânea (0ms), Seletores por Escopo & Otimização O(N) de Carregamento',
    highlight:
      'Filtragem ultra-rápida sem latência por Nome, IP Local/Público, Razão Social, Fantasia e ID (com suporte a múltiplos termos e vírgulas), eliminação do waterfall de carregamento da página e redução de O(N²) para O(N) na análise de topologia.',
    items: [
      {
        title: 'Filtro Multi-Dados Instantâneo (Nome, IP, Razão Social, Fantasia, CNPJ e ID)',
        description:
          'Índice em memória normalizado (sem acentos) que filtra em 0ms combinando múltiplos termos por espaço (AND) ou vírgula (OR), além de seletores rápidos por escopo (Tudo, Nome, IP, Razão Social, ID/CNPJ).',
        tag: 'UI/UX',
      },
      {
        title: 'Carregamento Paralelo & Eliminação de Re-render O(N²)',
        description:
          'Pré-busca paralela de perfil, organizações e dispositivos na abertura da página, cache em memória para localStorage e algoritmo O(N) de topologia de rede.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.6.8',
    date: 'Outubro 2026',
    title: 'Design System Mobile-First SaaS Premium & Cartões de Telemetria 100% Responsivos',
    highlight:
      'Refatoração completa da experiência mobile com zero overflow horizontal no cabeçalho, barra de mobilidade em linha única, botões de ação ancorados no topo direito e faixa de telemetria full-width.',
    items: [
      {
        title: 'Cartões Mobile Enxutos com Telemetria Full-Width',
        description:
          'Botões de conexão e menu posicionados no topo direito do card e faixa de IP Local, IP Público, Topologia de Rede e Hardware (CPU/RAM/HD) distribuída em 100% da largura.',
        tag: 'Mobilidade',
      },
      {
        title: 'Header Mobile Anti-Overflow & Chips em Linha Única',
        description:
          'Cabeçalho superior compacto sem corte do botão Sair, filtros Prontos/Fixados sem quebra de texto vertical e remoção de sobreposição do FAB sobre a lista.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.6.7',
    date: 'Outubro 2026',
    title: 'Estabilização Completa Windows 7 (UAC, Job Objects & Certificados TLS) (EXE v1.3.7)',
    highlight:
      'Correção definitiva do loop de elevação UAC no Windows 7 (quando EnableLUA=0), compatibilidade com limite de Job Object único do Windows 7 e certificados raiz ISRG Root X1 embutidos.',
    items: [
      {
        title: 'Detecção Nativa de Administrador no Windows 7 (Sem Loop UAC)',
        description:
          'Validação combinada de TokenElevation, grupo local Administradores (CheckTokenMembership) e Service Control Manager com trava anti-reexecução (--elevated).',
        tag: 'TeamViewer',
      },
      {
        title: 'Suporte a Job Objects e Certificados Raiz TLS no Windows 7 SP1',
        description:
          'Execução resiliente sob o Program Compatibility Assistant do Windows 7 (CREATE_BREAKAWAY_FROM_JOB) e cadeia ISRG Root X1 embutida para máquinas sem atualizações recentes.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.6.6',
    date: 'Outubro 2026',
    title: 'Instalador Exclusivo Windows 7 (SP1 · 32 e 64 bits) & Tripla Opção de Download (EXE v1.3.6)',
    highlight:
      'Suporte dedicado ao Windows 7 SP1 (32 e 64 bits) com camada de compatibilidade nativa de runtime Win32 (RtlGenRandom e fallback LoadLibraryExW), RustDesk 1.4.9 Sciter integrado e botões dedicados de download e link direto.',
    items: [
      {
        title: 'Novo Instalador Exclusivo para Windows 7 (32 e 64 bits)',
        description:
          'Compilado com overlay de compatibilidade de runtime Win32 (fallback automático de ProcessPrng para RtlGenRandom/SystemFunction036 e LoadLibraryExW) e binário RustDesk 1.4.9 Sciter compatível com Windows 7.',
        tag: 'TeamViewer',
      },
      {
        title: 'Tripla Opção de Download no Painel (64 bits, 32 bits & Windows 7)',
        description:
          'Tela de instalação agora oferece botões e cópia de link direto para Windows 10/11 (64 bits), Windows 32 bits (x86) e Windows 7.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.6.5',
    date: 'Outubro 2026',
    title: 'Instalador Exclusivo Windows 32 bits (x86) & Dupla Opção de Download no Painel (EXE v1.3.5)',
    highlight:
      'Suporte completo a computadores e PDVs com Windows 32 bits (x86): novo instalador dedicado com RustDesk 1.4.9 x86 integrado, link direto de download 32 bits e seleção clara entre 64 bits e 32 bits no painel.',
    items: [
      {
        title: 'Novo Instalador Exclusivo Windows 32 bits (x86)',
        description:
          'Compilação nativa GOARCH=386 (xpoint-complete-1.3.5-x86.exe) empacotada com o binário oficial RustDesk 1.4.9 x86 Sciter e verificação SHA-256.',
        tag: 'TeamViewer',
      },
      {
        title: 'Dupla Opção de Download e Link Direto (64 bits & 32 bits)',
        description:
          'Tela de instalação agora exibe os cards de Windows 64 bits (Recomendado) e Windows 32 bits (PCs 32 bits) com botões dedicados para baixar o executável ou copiar o link direto.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.6.4',
    date: 'Outubro 2026',
    title: 'Telemetria Leve de Baixo Consumo (Zero Sobrecarga) & Comandos Remotos de Manutenção Segura',
    highlight:
      'Otimização inteligente de escrita no servidor (throttling por delta de uso ≥10% ou janela de 3 minutos), cache local no agente Windows e central de comandos remotos seguros (Reiniciar PC, Desligar Tela/Bloquear, Limpar DNS e Sincronizar Leitura Agora).',
    items: [
      {
        title: 'Escrita Inteligente no Servidor (85% Menos Gravações em Banco)',
        description:
          'O pulso de 30s mantém o status Online em tempo real, mas só regrava o bloco de telemetria estendida quando há mudança de rede/identidade, variação ≥10% de CPU/RAM ou a cada 3 minutos.',
        tag: 'Infra & Cockpit',
      },
      {
        title: 'Comandos Remotos de Manutenção Segura (Fila Leve Piggyback)',
        description:
          'Envio de comandos administrativos homologados (Reiniciar PC com dupla confirmação, Desligar Tela/Bloquear, Limpar DNS e Sincronizar Leitura Agora) acoplados à resposta do heartbeat, sem polling extra.',
        tag: 'TeamViewer',
      },
      {
        title: 'Cache de Hardware & Rede no Agente Windows',
        description:
          'Modelo de CPU lido uma única vez (sync.Once) e leitura de disco/topologia em cache de 3 minutos com invalidação automática em troca de IP local.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.6.3',
    date: 'Outubro 2026',
    title: 'Gaveta de Telemetria Panorâmica Full-Width (100% da Linha) & Refinamento Visual de Hardware/Rede',
    highlight:
      'Reestruturação completa do layout da linha de dispositivos e da gaveta expansível: os cards de Processador, Memória RAM, HD/SSD e Diagnóstico de Roteador agora ocupam toda a largura da tabela (4 colunas) em grid panorâmico lado a lado, sem esmagamento de texto.',
    items: [
      {
        title: 'Gaveta Expansível Full-Width (Spanning nas 4 Colunas)',
        description:
          'A gaveta de detalhes agora se expande por toda a largura da linha (abaixo de Dispositivo, ID RustDesk, Status e Acesso Rápido), eliminando o espaço vazio à direita e organizando o cabeçalho de sistema junto aos botões de ação.',
        tag: 'UI/UX',
      },
      {
        title: 'Cards de Recursos (CPU, RAM & HD) com Badges Sem Quebra',
        description:
          'Os 3 indicadores de hardware contam com largura generosa, badges monoespaçados sem quebra de linha (white-space: nowrap) e barras de progresso com gradiente dinâmico.',
        tag: 'TeamViewer',
      },
      {
        title: 'Alinhamento Superior do Avatar & Barra de Telemetria Inline',
        description:
          'O ícone do monitor permanece ancorado no topo da linha e as pílulas rápidas (IP Local, IP Público, Roteador e CPU/RAM/HD) ficam organizadas em uma faixa dedicada abaixo do subtítulo.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.6.2',
    date: 'Outubro 2026',
    title: 'Blindagem de Produção: Sincronização Resiliente, Abertura/Encerramento de Sessão & Auto-Update PWA',
    highlight:
      'Eliminação definitiva do alerta recorrente de falha ao atualizar dispositivos, correção dos fluxos de início e encerramento de sessão remota sem recarregar a página e atualização automática de cache PWA.',
    items: [
      {
        title: 'Sincronização em Segundo Plano Silenciosa & Tolerante a Falhas',
        description:
          'Mantém os computadores e botões Conectar sempre ativos na visão Pastas durante atualizações em segundo plano, com controle inteligente de foco e compatibilidade retroativa de schema para janelas PWA abertas.',
        tag: 'Infra & Cockpit',
      },
      {
        title: 'Estabilidade Total no Início e Encerramento de Acesso Remoto',
        description:
          'Correção do ciclo de hooks do rastreador de sessão ativa (ActiveSessionTracker) e lançamento isolado via frame oculto para que iniciar ou encerrar um acesso nunca derrube a página.',
        tag: 'TeamViewer',
      },
      {
        title: 'Auto-Healing do Service Worker PWA (Cache v4)',
        description:
          'Invalidação automática de caches antigos de versões anteriores e sincronização unificada de versão v1.6.2 em todo o painel.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.6.1',
    date: 'Outubro 2026',
    title: 'Telemetria de Hardware (CPU, Memória RAM, HD) & Diagnóstico de Roteadores / Mesma Rede',
    highlight:
      'Monitoramento em tempo real de Processador, Memória RAM e Disco (HD/SSD) enviado pelo agente Windows e motor inteligente de detecção de topologia de rede para identificar se as máquinas estão no mesmo roteador ou em roteadores separados.',
    isCurrent: false,
    items: [
      {
        title: 'Monitoramento de Processador (CPU), Memória RAM e HD/Disco',
        description:
          'Exibição direta na linha de cada computador e em barras visuais na gaveta de detalhes mostrando quanto tem no total e quanto está em uso de Memória RAM, Processador e HD.',
        tag: 'Infra & Cockpit',
      },
      {
        title: 'Detector de Isolamento de Roteadores (Mesma Rede vs Outro Roteador)',
        description:
          'Compara automaticamente a faixa LAN, Gateway e IP do Servidor DataDivas entre máquinas do mesmo cliente/local, alertando quando um PC está em um roteador (ex: 192.168.1.x) e outro em outro roteador (ex: 192.168.0.x).',
        tag: 'TeamViewer',
      },
      {
        title: 'Coleta Nativa Win32 no Agente Windows',
        description:
          'O serviço XPointRemoteAgent coleta uso de CPU, RAM total/em uso, espaço de disco C: e Gateway da interface de rede a cada ciclo de heartbeat.',
        tag: 'Novo',
      },
    ],
  },
  {
    version: 'v1.6.0',
    date: 'Outubro 2026',
    title: 'Exibição Permanente de IP Local (LAN) e IP Público (WAN) em Todos os Dispositivos',
    highlight:
      'Agora todo computador exibe simultaneamente seu IP Local (rede interna RFC 1918) e seu IP Público (WAN de internet) na listagem principal, gaveta expansível, modal de edição, diagnóstico e ficha compartilhável.',
    items: [
      {
        title: 'Duplo Badge Permanente: IP Local + IP Público na Listagem',
        description:
          'Cada linha da árvore de computadores exibe sempre "IP Local: ..." (azul ciano) e "IP Público: ..." (verde esmeralda) lado a lado com cópia em 1 clique.',
        tag: 'UI/UX',
      },
      {
        title: 'Classificação Inteligente LAN vs WAN & Telemetria da API',
        description:
          'Separação automática entre IPs privados locais (192.168.*, 10.*, 172.16-31.*) e IPs públicos de saída (WAN / AWS / Fibra), expondo o IP público registrado no heartbeat da API.',
        tag: 'Infra & Cockpit',
      },
      {
        title: 'Visibilidade Completa no Modal de Edição e Diagnóstico',
        description:
          'Inclusão dos campos IP Local (LAN) e IP Público (WAN) também nos chips do modal Editar Computador, no cartão de especificações de Diagnóstico e no compartilhamento de ficha.',
        tag: 'TeamViewer',
      },
    ],
  },
  {
    version: 'v1.5.9',
    date: 'Outubro 2026',
    title: 'Modal de Edição Compacto com Scroll Isolado & Bloqueio de Fechamento Externo',
    highlight:
      'Reestruturação completa do modal Editar Computador com cabeçalho e rodapé fixos, rolagem interna isolada sem mover o fundo, contraste perfeito no modo claro/escuro e fechamento exclusivo pelo botão Fechar.',
    items: [
      {
        title: 'Cabeçalho e Rodapé Fixos com Rolagem Interna Isolada',
        description:
          'O título, botão Fechar e botões Salvar/Cancelar permanecem sempre visíveis em qualquer resolução de notebook ou monitor, enquanto a rolagem ocorre apenas no corpo interno sem mexer a lista de trás.',
        tag: 'UI/UX',
      },
      {
        title: 'Proteção contra Fechamento por Clique Fora',
        description:
          'Clicar fora do modal de edição não fecha mais a janela acidentalmente; o fechamento ocorre exclusivamente pelos botões Fechar ou Cancelar.',
        tag: 'TeamViewer',
      },
      {
        title: 'Layout Compacto em Grid & Contraste Modo Claro/Escuro',
        description:
          'Metadados em chips horizontais, campos Nome de Exibição e Pasta lado a lado e cartão de Controle de Acesso com contraste nítido nos temas Claro e Escuro.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.5.8',
    date: 'Outubro 2026',
    title: 'Estabilização do Passo 6 do Instalador & Recuperação Automática de Heartbeat Guards',
    highlight:
      'Eliminação do travamento no Passo 6 (HEARTBEAT_RETRY / HEARTBEAT_UNAVAILABLE), expiração automática de heartbeat_guards órfãos no Appwrite e contador contínuo na janela de progresso.',
    items: [
      {
        title: 'Expiração Automática de Heartbeat Guards Órfãos na API',
        description:
          'Bloqueios de heartbeat órfãos deixados por reinicializações ou timeouts anteriores agora são limpos automaticamente no Appwrite e durante o re-enrollment.',
        tag: 'Infra & Cockpit',
      },
      {
        title: 'Conclusão Resiliente do Passo 6 no Instalador Windows',
        description:
          'Após confirmação do Passo 5 (cadastro e senha no painel), o Passo 6 realiza tentativas rápidas de heartbeat e confirma online.json sem travar a instalação.',
        tag: 'TeamViewer',
      },
      {
        title: 'Contador Contínuo na Janela de Progresso',
        description:
          'O cronômetro de segundos na etapa de confirmação de comunicação mantém contagem contínua sem reiniciar a cada tentativa.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.5.7',
    date: 'Outubro 2026',
    title: 'Instalador Apple Design, Correção Definitiva do Serviço RustDesk & Lista Completa de Acessos',
    highlight: 'Redesign do instalador com estética inspirada no macOS (cantos arredondados e campos CNPJ, Razão Social e Nome Padrão agrupados lado a lado), correção definitiva do erro RUSTDESK_INSTALL_FAILED e carregamento completo da frota de dispositivos na lista principal.',
        items: [
      {
        title: 'Correção Definitiva do Serviço RustDesk (RUSTDESK_INSTALL_FAILED)',
        description:
          'Normaliza automaticamente o BinaryPathName do serviço Windows do RustDesk (--import-config -> --service), aguarda processos filhos de lote (cmd/xcopy/sc) antes de encerrar o job e faz staging seguro a partir do cache portátil.',
        tag: 'Infra & Cockpit',
      },
      {
        title: 'Interface do Instalador Inspirada na Apple com Campos Próximos',
        description:
          'Agrupa CNPJ, Razão Social e Nome Padrão no topo do card principal, aplica paleta clean estilo macOS (#F5F5F7 / #FFFFFF / Apple Blue #0071E3) com cantos arredondados de 20px e corrige artefatos visuais de rótulos.',
        tag: 'UI/UX',
      },
      {
        title: 'Carregamento Integral da Lista de Computadores (Online + Offline)',
        description:
          'Exibe todos os computadores cadastrados na lista principal sem ocultar máquinas offline por padrão, mantendo os mais recentes e online no topo e paginando frotas acima de 100 máquinas automaticamente.',
        tag: 'TeamViewer',
      },
    ],
  },
  {
    version: 'v1.5.6',
    date: 'Outubro 2026',
    title: 'Preservação de Nome Editado, IP Local na Lista, Link de Download & Histórico Lateral',
    highlight: 'Preservação integral de nomes de exibição editados (ex.: Marcos X-Point), IP local visível diretamente na lista principal, cópia do link direto do instalador e histórico de últimos acessos na barra lateral.',
    isCurrent: false,
    items: [
      {
        title: 'Preservação Integral do Nome de Exibição Editado',
        description:
          'Nomes personalizados editados manualmente (como Marcos X-Point) são exibidos exatamente como foram salvos, sem concatenar razão social acima, mantendo a concatenação inteligente para nomes genéricos (ex.: PANAMBY - SERVIDOR).',
        tag: 'UI/UX',
      },
      {
        title: 'IP Local do Computador na Lista Simplificada',
        description:
          'Exibição direta do endereço IP da rede local (ex.: IP: 192.168.0.125) ao lado do RustDesk ID na linha principal, com cópia rápida em 1 clique.',
        tag: 'TeamViewer',
      },
      {
        title: 'Botão Copiar Link de Download da Instalação',
        description:
          'Na página /setup, além de baixar o executável, agora é possível copiar um link direto de download do instalador configurado para enviar ao cliente.',
        tag: 'Novo',
      },
      {
        title: 'Últimos Acessos na Barra Lateral Esquerda',
        description:
          'A área inferior do menu lateral exibe os últimos computadores acessados com nome da máquina, data/horário e nome do técnico que realizou o acesso.',
        tag: 'TeamViewer',
      },
    ],
  },
  {
    version: 'v1.5.5',
    date: 'Outubro 2026',
    title: 'Senha de Acesso por Máquina & Restrição Exclusiva para Administradores',
    highlight: 'Controle de acesso em 2 níveis adicionais por computador (Senha de Acesso ao Conectar e bloqueio Somente Administrador), preservando a senha interna automática do RustDesk.',
    items: [
      {
        title: 'Senha de Acesso Individual por Computador',
        description:
          'Permite configurar uma Senha de Acesso em máquinas específicas. Ao clicar em Conectar, o painel solicita a senha antes de liberar a sessão remota no RustDesk, mantendo a senha interna automática do sistema intacta.',
        tag: 'Novo',
      },
      {
        title: 'Nível de Proteção "Somente Administrador"',
        description:
          'Permite restringir o acesso de máquinas críticas (ex: Servidores Financeiros ou Diretoria) exclusivamente a usuários com perfil de Administrador, bloqueando conexões de técnicos comuns na interface e na API.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.5.4',
    date: 'Outubro 2026',
    title: 'Prioridade Padrão Recentes & Online, Busca Completa (Online/Offline) e Exclusão Definitiva de Técnicos',
    highlight: 'Exibe por padrão os computadores mais recentes cadastrados e online (carregando todos os dispositivos da base), mostra tanto os online quanto os offline ao pesquisar na caixa de busca e garante a exclusão definitiva de técnicos sem recriá-los ao retornar à tela.',
    isCurrent: false,
    items: [
      {
        title: 'Lista Padrão Ordenada pelos Mais Recentes Cadastrados & Online',
        description:
          'Ao abrir a tela de dispositivos sem busca ativa, prioriza automaticamente as máquinas online ordenadas pela data de cadastro mais recente ($createdAt).',
        tag: 'TeamViewer',
      },
      {
        title: 'Caixa de Pesquisa Unificada (Online + Offline) & Exclusão Definitiva de Técnicos',
        description:
          'Ao digitar na caixa de pesquisa, exibe tanto computadores online quanto offline. Na gestão de técnicos, a exclusão remove definitivamente o registro no Appwrite e no cache local.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.5.3',
    date: 'Outubro 2026',
    title: 'Apelido Coerente nas Abas do RustDesk (Nome Fantasia + Nome da Máquina)',
    highlight: 'Envia automaticamente o apelido concatenado (ex: PANAMBY - SERVIDOR, Arthur X-Point) na URI de conexão rustdesk://connect/... e grava o alias no perfil do peer para que cada aba aberta no RustDesk exiba o nome real do cliente em vez do ID numérico + IP.',
    items: [
      {
        title: 'Handoff Automático de Apelido (&alias=...) na URI do RustDesk',
        description:
          'Toda conexão em 1 clique ou manual inclui o título coerente (Nome Fantasia + Nome da Máquina) para identificação imediata nas abas do RustDesk Desktop.',
        tag: 'TeamViewer',
      },
      {
        title: 'Sincronização de Peers RustDesk sem Sufixo @IP nas Abas',
        description:
          'Configura os arquivos base64 do peer (incluindo a chave ?key=... da aba de conexão por link) em UTF-8 sem BOM para exibir somente o apelido amigável na aba do RustDesk.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.5.2',
    date: 'Outubro 2026',
    title: 'Login Automático com Google & Sincronização Real de Técnicos e Convites no Appwrite',
    highlight: 'Persiste todos os membros da aba "Técnicos & Convites" diretamente no banco Appwrite (incluindo David Clemente e equipe técnica), habilita login imediato em 1 clique pelo botão "Continuar com o Google" para todos os e-mails liberados e permite cadastro/ativação direta de senha pelo link de convite.',
    items: [
      {
        title: 'Login Automático com o Google para E-mails Liberados na Lista de Técnicos',
        description:
          'Qualquer técnico com status Ativo na lista "Técnicos & Convites" pode autenticar instantaneamente clicando em "Continuar com o Google" sem erro 412 de provedor.',
        tag: 'Novo',
      },
      {
        title: 'Ativação de Convite & Cadastro de Senha no Servidor Appwrite (/v1/technicians)',
        description:
          'O link enviado por WhatsApp/Copiar Convite preenche automaticamente o e-mail do técnico, permitindo entrar com 1 clique pelo Google ou cadastrar sua própria senha diretamente no Appwrite.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.5.1',
    date: 'Outubro 2026',
    title: 'Blindagem de Retorno do App RustDesk no Android (Anti "This page couldn’t load")',
    highlight: 'Elimina o erro "This page couldn’t load" ao encerrar uma conexão remota no app do RustDesk no Android/Samsung Internet e retornar para o painel XPoint Remote.',
    items: [
      {
        title: 'Intent Android Direto sem Recarregamento em Background (Samsung Internet & Chrome)',
        description:
          'Remove o redirecionamento S.browser_fallback_url do intent de conexão e aplica bloqueio automático de navegação pendente (window.stop) ao alternar para o RustDesk, impedindo que o navegador tente recarregar a aba com a rede suspensa em segundo plano.',
        tag: 'Mobilidade',
      },
      {
        title: 'Service Worker v3 com Resiliência de Navegação e Retomada Instantânea',
        description:
          'Protege a rota /devices com estratégia Network-First + fallback instantâneo de App Shell em caso de suspensão de socket pelo Android durante o uso do RustDesk.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.5.0',
    date: 'Outubro 2026',
    title: 'Lista Simplificada de 2 Linhas, Nomenclatura Coerente (Marca + Máquina) & Opção "Ver detalhes"',
    highlight: 'Concatenação inteligente do nome principal da marca no Nome Fantasia/Razão Social com o nome da máquina (ex: PANAMBY - SERVIDOR), hierarquia limpa de 2 linhas (título maior + subtítulo menor) e gaveta expansível sob demanda ao clicar em "Ver detalhes".',
    items: [
      {
        title: 'Concatenação Coerente de Marca Principal + Nome da Máquina (ex: PANAMBY - SERVIDOR)',
        description:
          'Cruza automaticamente Nome Fantasia e Razão Social (ignorando sufixos jurídicos e categorias genéricas) para identificar a marca âncora mais coerente e concatenar com a máquina/função.',
        tag: 'UI/UX',
      },
      {
        title: 'Hierarquia Visual em 2 Linhas (Linha Maior + Subtítulo Menor) & Botão "Ver detalhes ▾"',
        description:
          'Exibe o título principal em destaque na primeira linha e um subtítulo enxuto abaixo com o Nome Fantasia completo, Host/Pasta e o botão "Ver detalhes" para revelar especificações e ficha DataDivas apenas quando solicitado.',
        tag: 'Mobilidade',
      },
    ],
  },
  {
    version: 'v1.4.9',
    date: 'Outubro 2026',
    title: 'Lista Simplificada Ultra-Limpa & Expansão sob Demanda ("Detalhes")',
    highlight: 'Padronização visual de cada computador em 2 linhas enxutas na lista principal, ocultando metadados técnicos e ficha DataDivas até que o técnico clique em "Detalhes".',
    items: [
      {
        title: 'Lista Simplificada Uniforme em 2 Linhas (Mobile & Desktop)',
        description:
          'Exibe na listagem apenas o essencial para conexão rápida (Nome, Função, ID RustDesk, Status e Pasta), eliminando o empilhamento de 10+ linhas por computador no celular.',
        tag: 'UI/UX',
      },
      {
        title: 'Gaveta Expansível "Detalhes ▾" sob Demanda em Cada Máquina',
        description:
          'Ao tocar em "Detalhes" (ou no nome da máquina), expande suavemente o painel completo com Sistema, IP, Ficha Cadastral DataDivas (CNPJ, Serial, Endereço, IP DataDivas) e atalhos para Diagnóstico e Edição.',
        tag: 'Mobilidade',
      },
    ],
  },
  {
    version: 'v1.4.8',
    date: 'Outubro 2026',
    title: 'Integração Nativa com XPoint Chatbot (Iframe / Rota /embed & Eventos postMessage por CNPJ)',
    highlight: 'Rota dedicada /embed com cabeçalhos frame-ancestors liberados, Bridge bidirecional via window.postMessage e filtragem automática de conexões pelo CNPJ do contato em conversa no Chatbot.',
    items: [
      {
        title: 'Rota Dedicada /embed, Bridge Bidirecional postMessage e Filtro Automático por CNPJ',
        description:
          'Permite embutir o XPoint Remote dentro do XPoint Chatbot via Iframe ou Drawer lateral, recebendo o CNPJ do contato por URL (?embed=1&cnpj=...) ou em tempo real via window.postMessage (XPOINT_REMOTE_SET_CNPJ) para filtrar os computadores do cliente instantaneamente.',
        tag: 'Novo',
      },
      {
        title: 'Central Interativa "Chatbot / Iframe" com Simulador Ao Vivo e Kit React Pronto',
        description:
          'Novo modal interativo na barra de ferramentas com simulador de eventos de CNPJ em tempo real, inspetor de eventos de retorno (sessão iniciada/encerrada com laudo) e código React completo (<XPointRemoteChatDrawer />) pronto para copiar no projeto do Chatbot.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.4.7',
    date: 'Outubro 2026',
    title: 'Setup do Instalador Windows v1.3.1 — Interface Enterprise Moderna, Alta Confiança & UX sem Cortes',
    highlight: 'Redesign completo da janela de setup e progresso no Windows com banner de segurança verificado, cards estruturados sem caixas cinzas legadas, área útil exata e dropdowns expandidos.',
    items: [
      {
        title: 'Interface Enterprise de Última Geração no Setup Windows (EXE v1.3.1)',
        description:
          'Cabeçalho escuro moderno com selo "Instalação Verificada & Criptografada (TLS 1.3)", cards arredondados para Dados do C:\\DataDivas\\config.ini, Grupo do CNPJ e Classificação da Máquina, eliminando fundos cinzas legados do Win32 e textos truncados.',
        tag: 'UI/UX',
      },
      {
        title: 'Botões Owner-Draw, Callout de Sugestão Inteligente & Compatibilidade PDV 1366x768',
        description:
          'Cálculo exato de área útil (AdjustWindowRectEx + SPI_GETWORKAREA), largura expandida em dropdowns (CB_SETDROPPEDWIDTH), destaque em esmeralda para a sugestão automática de nome e garantia explícita de não reinicialização forçada.',
        tag: 'Novo',
      },
    ],
  },
  {
    version: 'v1.4.6',
    date: 'Outubro 2026',
    title: 'Gestão Inteligente de Computadores por CNPJ, Nomenclatura Sequencial & Renomeação Real do Windows (EXE v1.3.0)',
    highlight: 'Agrupamento automático por CNPJ (14 dígitos), catálogo padronizado de funções (SERVIDOR, CAIXA-01, BALANCA-01...), reserva atômica contra colisão e renomeação real do Windows.',
    items: [
      {
        title: 'Instalador Windows v1.3.0 com Tela "Identificação do Computador" e Renomeação Real do Windows',
        description:
          'Durante a instalação, o EXE consulta os computadores existentes do mesmo CNPJ no Appwrite, diferencia Nova Instalação, Reinstalação na Mesma Máquina e Substituição Autorizada, sugere o primeiro número livre e aplica SetComputerNameExW no Windows com proteção para Domínio AD.',
        tag: 'Novo',
      },
      {
        title: 'Painel de Gestão por CNPJ, Reserva Atômica e Migração da Base Legada',
        description:
          'Nova central "Gestão por CNPJ" no painel para auditar ocupação de nomes, liberar ou transferir funções, consultar conflitos legados e executar a migração assistida (Dry-Run ou Aplicar).',
        tag: 'Infra & Cockpit',
      },
    ],
  },
  {
    version: 'v1.4.5',
    date: 'Outubro 2026',
    title: 'Integração Nativa C:\\DataDivas\\config.ini no Instalador EXE v1.2.8 & Ficha Cadastral no Painel',
    highlight: 'Leitura automática de Nome Fantasia, Razão Social, CNPJ, Serial, IE, Endereço, IP Máquina e IP DataDivas direto do PC do cliente e sincronização no banco.',
    items: [
      {
        title: 'Extração Automática de C:\\DataDivas\\config.ini pelo Instalador e Serviço Windows (v1.2.8)',
        description:
          'O instalador .exe e o serviço em segundo plano leem automaticamente C:\\DataDivas\\config.ini e DATA.INI (com suporte a acentuação Windows-1252 e UTF-8), sugerindo o Nome Fantasia + Máquina na instalação e enviando todos os dados ao banco a cada batimento.',
        tag: 'Novo',
      },
      {
        title: 'Ficha Cadastral Completa do Cliente no Painel, Busca Inteligente e Laudos',
        description:
          'Exibição direta na listagem, no modal de detalhes e nos laudos automáticos de Nome Fantasia, Razão Social, CNPJ, Serial DataDivas, IE, Endereço Completo, IP Máquina (ipmaq) e IP Servidor DataDivas, com cópia em 1 clique e pesquisa instantânea.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.4.4',
    date: 'Outubro 2026',
    title: 'Handoff Nativo Android Intent & Retorno Pós-Conexão sem Queda de Página',
    highlight: 'Eliminação do erro "This page couldn\'t load" ao encerrar conexões no celular/PWA e preservação contínua da barra de atendimento.',
    items: [
      {
        title: 'Protocolo Android Intent com Fallback Seguro no Retorno do RustDesk',
        description:
          'Substituição do redirecionamento destrutivo da janela principal por handoff via Android Intent nativo e âncora efêmera, impedindo que o navegador/PWA caia em tela de erro ao fechar o RustDesk.',
        tag: 'Mobilidade',
      },
      {
        title: 'Persistência da Sessão Ativa e Timer Auto 1-Click no Mobile',
        description:
          'Mesmo que o sistema operacional móvel recarregue a aba em segundo plano durante o suporte remoto, o protocolo ativo e a contagem regressiva de 20s retornam intactos.',
        tag: 'Novo',
      },
    ],
  },
  {
    version: 'v1.4.3',
    date: 'Outubro 2026',
    title: 'Documentação Automática em 20s & Supressão de Caixa Duplicada',
    highlight: 'Conclusão automática do laudo após 20s de inatividade e exibição do aviso de conexão restrita apenas a erros críticos.',
    items: [
      {
        title: 'Documentação Automática 1-Click após 20 Segundos de Inatividade',
        description:
          'Ao encerrar a sessão e retornar ao painel (ou caso ninguém digite nem clique em nada por 20 segundos), o Auto 1-Click é acionado automaticamente, salvando o protocolo e o laudo completo.',
        tag: 'Novo',
      },
      {
        title: 'Eliminação da Caixa Duplicada de Status da Conexão',
        description:
          'A caixa flutuante de "Status da Conexão" não aparece mais sobre a lista durante conexões normais, sendo exibida apenas se ocorrer uma falha crítica na abertura.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.4.2',
    date: 'Outubro 2026',
    title: 'Memória Persistente de Filtros e Preferências por Usuário',
    highlight: 'Seus filtros de Organização, Status, Busca, Online/Fixados, Ordenação, Densidade e Favoritos ficam salvos individualmente para cada operador.',
    items: [
      {
        title: 'Persistência Automática de Filtros por Usuário Autenticado',
        description:
          'Cada técnico mantém seu próprio estado salvo para Organização/Pasta selecionada, Status (Todos/Online/Offline), termo de busca e modo de visualização (Pastas/Tabela).',
        tag: 'Novo',
      },
      {
        title: 'Restauração Instantânea de Filtros Rápidos, Ordenação e Favoritos',
        description:
          'Ao voltar para a aplicação no PC ou celular, os filtros rápidos (Online/Prontos, Fixados), a ordenação escolhida, o modo compacto e os favoritos individuais já estarão exatamente como você deixou.',
        tag: 'Mobilidade',
      },
      {
        title: 'Exibição Integral do Nome Principal & Realocação do Selo OS no Mobile',
        description:
          'O nome principal do cliente/computador nunca mais é cortado com reticências (...), ganhando largura total na primeira linha enquanto o selo WIN 10 / WIN 11 é exibido ao lado do status Online no celular.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.4.1',
    date: 'Outubro 2026',
    title: 'Motor de Documentação Automatizada & Telemetria Máxima de Atendimento',
    highlight: 'Geração automática de laudos técnicos com protocolo único, 12 indicadores da máquina/rede, ações em 1 toque e HUD compacto para celular.',
    items: [
      {
        title: 'Coleta Automática de 12+ Indicadores da Sessão e Máquina',
        description:
          'Protocolo automático (XP-YYYYMMDD-XXXX), Sistema Operacional, Build, IP Local, Hostname, Pasta, Técnico, E-mail, Dispositivo de Origem, Rede (4G/Wi-Fi) e Duração Cronometrada.',
        tag: 'Novo',
      },
      {
        title: 'Botão "Auto 1-Click" e Checklist Inteligente sem Digitação',
        description:
          'Documente o que foi feito com 1 toque (Reinício de Totem/PDV, Impressora Térmica, Pinpad/TEF, Rede/DNS, Limpeza) gerando laudo estruturado pronto para copiar ou compartilhar no WhatsApp.',
        tag: 'Mobilidade',
      },
      {
        title: 'HUD Flutuante de Sessão em 2 Linhas e Alinhamento Mobile',
        description:
          'Barra flutuante de sessão redesenhada para smartphones sem quebrar palavras na vertical, além de correção do alinhamento da estrela de favoritos ao lado do nome do cliente.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.4.0',
    date: 'Outubro 2026',
    title: 'Central Interativa de Novidades & Changelog',
    highlight: 'Consulte todas as evoluções da plataforma clicando diretamente no selo da versão no topo ou na barra lateral.',
    items: [
      {
        title: 'Botão de Versão Interativo em Todo o Painel',
        description:
          'O indicador de versão na barra superior desktop, no cabeçalho mobile, na barra lateral e no Cockpit abre esta central detalhada com todas as novidades.',
        tag: 'Novo',
      },
      {
        title: 'Filtro de Evoluções por Categoria',
        description:
          'Navegue rapidamente pelas melhorias de Mobilidade, UI/UX, estilo TeamViewer ou Infraestrutura & Cockpit.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.3.9',
    date: 'Outubro 2026',
    title: 'Operação em Mobilidade (PC & Celular) e UI/UX SaaS Premium',
    highlight: 'Recursos desenhados para técnicos em campo operarem com apenas uma mão no smartphone ou em alta velocidade no desktop.',
    items: [
      {
        title: 'Barra de Operação Rápida (Prontos & Fixados em 1 Toque)',
        description:
          'Filtre instantaneamente apenas os computadores Online ("Prontos") ou seus computadores favoritos ("Fixados") com um único toque.',
        tag: 'Mobilidade',
      },
      {
        title: 'Computadores Fixados / Favoritos no Topo (⭐)',
        description:
          'Marque servidores críticos e clientes frequentes com a estrela para mantê-los sempre fixados no topo da listagem com destaque âmbar.',
        tag: 'Mobilidade',
      },
      {
        title: 'Gaveta Tátil (Bottom Sheet) para Smartphones',
        description:
          'Ao tocar nas opções (⋮) pelo celular, abre-se uma gaveta deslizante com botões ergonômicos para Copiar ID, Compartilhar Acesso via WhatsApp, Editar Dados, Diagnosticar e Mover de Pasta.',
        tag: 'Mobilidade',
      },
      {
        title: 'Atalho "Colar ID" + Teclado Numérico Automático',
        description:
          'Na janela Adicionar e Conectar, cole IDs copiados do WhatsApp com 1 toque e utilize o teclado numérico nativo no celular.',
        tag: 'Mobilidade',
      },
      {
        title: 'Ordenação Inteligente & Alternador de Densidade (Confortável / Compacto)',
        description:
          'Priorização automática de máquinas online no topo e modo compacto de alta densidade para visualizar dezenas de máquinas em notebooks e monitores grandes.',
        tag: 'UI/UX',
      },
    ],
  },
  {
    version: 'v1.3.8',
    date: 'Outubro 2026',
    title: 'Lista Contínua Aberta & Filtro Unificado por Organização',
    highlight: 'Visualização imediata de todos os computadores com seleção rápida de categorias.',
    items: [
      {
        title: 'Exibição Contínua de Todos os Computadores',
        description:
          'Todas as máquinas aparecem abertas diretamente na tela inicial, eliminando cliques extras para expandir pastas.',
        tag: 'TeamViewer',
      },
      {
        title: 'Seletor e Pílulas de Organização Padronizadas',
        description:
          'Alterne rapidamente entre Todas, Recentes, Clientes, X-Point Soluções e Servidores e infra tanto no seletor de Organização quanto nas pílulas rápidas.',
        tag: 'TeamViewer',
      },
    ],
  },
  {
    version: 'v1.3.7',
    date: 'Outubro 2026',
    title: 'Design TeamViewer com Riqueza de Detalhes em 3 Níveis',
    highlight: 'Refinamento tipográfico com títulos claros, IDs espaçados e metadados técnicos compactos.',
    items: [
      {
        title: 'Avatar Circular com Indicador Luminoso de Presença',
        description:
          'Ícone de estação com ponto verde pulsante para máquinas online e aro neutro para máquinas offline.',
        tag: 'UI/UX',
      },
      {
        title: 'Subtítulos Técnicos de Alta Densidade',
        description:
          'Exibição limpa do ID RustDesk formatado (XXX XXX XXX) com cópia rápida, acompanhado de Hostname, Sistema Operacional, IP de rede, Pasta e Técnico.',
        tag: 'TeamViewer',
      },
      {
        title: 'Botão Conectar com Setas Opostas',
        description:
          'Botão de conexão rápida no padrão clássico TeamViewer, adaptando-se automaticamente para ícone compacto de 44x44px no celular.',
        tag: 'TeamViewer',
      },
    ],
  },
  {
    version: 'v1.3.6',
    date: 'Outubro 2026',
    title: 'Persistência de Pastas no Banco & Raio-X de Disco VPS',
    highlight: 'Organização permanente de máquinas e diagnóstico avançado de infraestrutura no Cockpit.',
    items: [
      {
        title: 'Edição Inline de Nome, Pasta e Anotações Técnicas',
        description:
          'Clique no nome de qualquer computador para renomeá-lo, trocar de pasta e registrar observações persistidas no banco de dados.',
        tag: 'TeamViewer',
      },
      {
        title: 'Raio-X de Armazenamento VPS & Playbook de Manutenção',
        description:
          'Modal interativo no Cockpit Dev Logger detalhando o uso de disco por container/volume e comandos seguros de limpeza.',
        tag: 'Infra & Cockpit',
      },
      {
        title: 'Gestão de Técnicos, Convites & Controle de Sessão Ativa',
        description:
          'Cronômetro flutuante de atendimento com registro de notas e aba dedicada para gerenciar convites da equipe técnica.',
        tag: 'Infra & Cockpit',
      },
    ],
  },
];

export function VersionChangelogModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose(): void;
}) {
  const [selectedTag, setSelectedTag] = useState<string>('all');

  if (!isOpen) return null;

  const filteredReleases = PLATFORM_RELEASES.map((rel) => {
    if (selectedTag === 'all') return rel;
    return {
      ...rel,
      items: rel.items.filter((item) => item.tag === selectedTag),
    };
  }).filter((rel) => rel.items.length > 0);

  return (
    <div
      className="tv-modal-backdrop changelog-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-modal-title"
    >
      <div
        className="tv-modal-card changelog-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tv-sheet-drag-handle" aria-hidden="true" />

        {/* Cabeçalho Premium */}
        <div className="changelog-modal-header">
          <div className="changelog-header-left">
            <div className="changelog-icon-box">
              <Sparkles size={20} className="text-sky-400" />
            </div>
            <div className="changelog-title-group">
              <div className="changelog-title-row">
                <h2 id="changelog-modal-title">Novidades da Plataforma</h2>
                <span className="changelog-current-pill">v1.6.8 · ATUAL</span>
              </div>
              <p className="changelog-subtitle">
                Histórico de atualizações, recursos de mobilidade e melhorias de UI/UX do XPoint Remote
              </p>
            </div>
          </div>
          <button
            type="button"
            className="tv-modal-close-btn"
            onClick={onClose}
            aria-label="Fechar novidades da versão"
            title="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Barra de Filtros de Categoria */}
        <div className="changelog-filter-bar" role="tablist" aria-label="Filtrar novidades por categoria">
          {[
            { id: 'all', label: 'Todas as Novidades', icon: Layers },
            { id: 'Mobilidade', label: 'Mobilidade (PC & Celular)', icon: Smartphone },
            { id: 'TeamViewer', label: 'Lista & Pastas', icon: Folder },
            { id: 'UI/UX', label: 'Design & UI/UX', icon: Star },
            { id: 'Infra & Cockpit', label: 'Cockpit & Infra', icon: HardDrive },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={`changelog-filter-pill ${selectedTag === tab.id ? 'active' : ''}`}
                onClick={() => setSelectedTag(tab.id)}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Corpo com Linha do Tempo das Versões */}
        <div className="changelog-modal-body">
          {filteredReleases.map((rel) => (
            <section
              key={rel.version}
              className={`changelog-release-block ${rel.isCurrent ? 'is-current' : ''}`}
            >
              <div className="changelog-release-header">
                <div className="changelog-version-tag-row">
                  <span className={`changelog-version-tag ${rel.isCurrent ? 'current' : ''}`}>
                    {rel.version}
                  </span>
                  {rel.isCurrent && (
                    <span className="changelog-latest-badge">
                      <Zap size={11} /> Versão em Execução
                    </span>
                  )}
                  <span className="changelog-release-date">{rel.date}</span>
                </div>
                <h3 className="changelog-release-title">{rel.title}</h3>
                <p className="changelog-release-highlight">{rel.highlight}</p>
              </div>

              <div className="changelog-items-grid">
                {rel.items.map((item) => (
                  <div key={item.title} className="changelog-item-card">
                    <div className="changelog-item-top">
                      <span className="changelog-item-check">
                        <CheckCircle2 size={15} className="text-emerald-400" />
                      </span>
                      <strong className="changelog-item-title">{item.title}</strong>
                      <span className={`changelog-item-badge tag-${item.tag.toLowerCase().replace(/[^a-z]/g, '')}`}>
                        {item.tag}
                      </span>
                    </div>
                    <p className="changelog-item-desc">{item.description}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Rodapé */}
        <div className="changelog-modal-footer">
          <div className="changelog-footer-info">
            <ShieldCheck size={15} className="text-emerald-400" />
            <span>XPoint Soluções · Ambiente de Produção Atualizado (v1.6.8)</span>
          </div>
          <button type="button" className="tv-btn-primary" onClick={onClose}>
            Entendi, voltar ao painel
          </button>
        </div>
      </div>
    </div>
  );
}
