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
    version: 'v1.4.3',
    date: 'Outubro 2026',
    title: 'Documentação Automática em 20s & Supressão de Caixa Duplicada',
    highlight: 'Conclusão automática do laudo após 20s de inatividade e exibição do aviso de conexão restrita apenas a erros críticos.',
    isCurrent: true,
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
                <span className="changelog-current-pill">v1.4.3 · ATUAL</span>
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
            <span>XPoint Soluções · Ambiente de Produção Atualizado (v1.4.3)</span>
          </div>
          <button type="button" className="tv-btn-primary" onClick={onClose}>
            Entendi, voltar ao painel
          </button>
        </div>
      </div>
    </div>
  );
}
