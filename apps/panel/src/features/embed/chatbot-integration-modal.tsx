'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DeviceView } from '@appremoto/contracts';
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  MessageSquare,
  Play,
  Radio,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import {
  dispatchSimulatedChatbotMessage,
  formatDocumentDisplay,
  normalizeDocumentDigits,
  type ChatbotOutboundEvent,
} from './chatbot-bridge';

export function ChatbotIntegrationModal({
  isOpen,
  onClose,
  devices,
}: {
  isOpen: boolean;
  onClose(): void;
  devices: DeviceView[];
}) {
  const [activeTab, setActiveTab] = useState<'simulator' | 'code' | 'events'>('simulator');
  const [simCnpj, setSimCnpj] = useState('');
  const [simContactName, setSimContactName] = useState('');
  const [simPhone, setSimPhone] = useState('5511999999999');
  const [simOpenModal, setSimOpenModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<ChatbotOutboundEvent[]>([]);

  // Extrai CNPJs reais já cadastrados nos dispositivos para facilitar o teste em 1 clique
  const knownCompanies = useMemo(() => {
    const map = new Map<string, { cnpj: string; formatted: string; name: string; count: number }>();
    for (const dev of devices) {
      const rawCnpj = dev.datadivas?.cnpj || '';
      const digits = normalizeDocumentDigits(rawCnpj);
      const key = digits || dev.organizationName;
      if (!key) continue;
      const name =
        dev.datadivas?.nomeFantasia ||
        dev.datadivas?.razaoSocial ||
        dev.organizationName ||
        dev.displayName;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          cnpj: digits || rawCnpj || dev.organizationName,
          formatted: digits ? formatDocumentDisplay(digits) : dev.organizationName,
          name,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).slice(0, 12);
  }, [devices]);

  useEffect(() => {
    if (!simCnpj && knownCompanies.length > 0) {
      setSimCnpj(knownCompanies[0]!.cnpj);
      setSimContactName(knownCompanies[0]!.name);
    }
  }, [knownCompanies, simCnpj]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onOutbound(e: Event) {
      const custom = e as CustomEvent<ChatbotOutboundEvent>;
      if (custom.detail) {
        setEventLog((prev) => [custom.detail, ...prev].slice(0, 15));
      }
    }
    window.addEventListener('xpoint:remote-outbound', onOutbound);
    return () => window.removeEventListener('xpoint:remote-outbound', onOutbound);
  }, []);

  if (!isOpen) return null;

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io';

  const embedUrlExample = `${origin}/embed?cnpj=${encodeURIComponent(simCnpj || '12345678000190')}&contactName=${encodeURIComponent(simContactName || 'Cliente Chatbot')}&contactPhone=${encodeURIComponent(simPhone || '')}`;

  const reactIntegrationCode = `// Componente pronto para colar no Chatbot (React / Next.js)
import { useEffect, useRef } from 'react';

const APPREMOTO_ORIGIN = '${origin}';

export function XPointRemoteChatDrawer({
  cnpj,
  contactName,
  contactPhone,
  contactId,
  conversationId,
  onSessionEvent,
}: {
  cnpj?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  onSessionEvent?: (event: any) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // 1. Sempre que o atendente mudar de conversa/contato no Chatbot, envia o CNPJ ao iframe sem recarregar:
  useEffect(() => {
    if (!iframeRef.current?.contentWindow || !cnpj) return;
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'XPOINT_REMOTE_SET_CNPJ',
        cnpj,
        contactName: contactName || '',
        contactPhone: contactPhone || '',
        contactId: contactId || '',
        conversationId: conversationId || '',
      },
      '*'
    );
  }, [cnpj, contactName, contactPhone, contactId, conversationId]);

  // 2. Escuta eventos vindos do AppRemoto (máquinas do CNPJ, início/fim de sessão e vínculo de contato):
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data.type !== 'string') return;
      if (!event.data.type.startsWith('XPOINT_REMOTE_')) return;

      // Exemplos de eventos recebidos do AppRemoto:
      // - XPOINT_REMOTE_READY (iframe pronto)
      // - XPOINT_REMOTE_CNPJ_RESOLVED (lista de máquinas e total online daquele CNPJ)
      // - XPOINT_REMOTE_CONTACT_ASSOCIATED (técnico vinculou este CNPJ/PC ao contato)
      // - XPOINT_REMOTE_SESSION_STARTED (técnico iniciou acesso remoto + nº de protocolo)
      // - XPOINT_REMOTE_SESSION_ENDED (atendimento remoto concluído + resumo)
      onSessionEvent?.(event.data);

      if (event.data.type === 'XPOINT_REMOTE_READY' && cnpj && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          {
            type: 'XPOINT_REMOTE_SET_CNPJ',
            cnpj,
            contactName: contactName || '',
            contactPhone: contactPhone || '',
            contactId: contactId || '',
            conversationId: conversationId || '',
          },
          '*'
        );
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [cnpj, contactName, contactPhone, contactId, conversationId, onSessionEvent]);

  const initialSrc = \`\${APPREMOTO_ORIGIN}/embed?cnpj=\${encodeURIComponent(cnpj || '')}&contactName=\${encodeURIComponent(contactName || '')}&contactPhone=\${encodeURIComponent(contactPhone || '')}\`;

  return (
    <iframe
      ref={iframeRef}
      src={initialSrc}
      title="XPoint Remote — Acesso Remoto Integrado"
      style={{ width: '100%', height: '100%', minHeight: '640px', border: '0', borderRadius: '12px' }}
      allow="clipboard-write"
    />
  );
}`;

  function copyText(key: string, text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  }

  function handleTriggerSimulation() {
    if (!simCnpj.trim()) return;
    dispatchSimulatedChatbotMessage({
      type: 'XPOINT_REMOTE_SET_CNPJ',
      cnpj: simCnpj.trim(),
      contactName: simContactName.trim() || 'Contato WhatsApp',
      contactPhone: simPhone.trim(),
      conversationId: `chat_${Date.now().toString(36)}`,
      openCnpjModal: simOpenModal,
    });
    onClose();
  }

  return (
    <div
      className="device-dialog-backdrop"
      style={{ zIndex: 1200 }}
      onClick={onClose}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chatbot-bridge-modal-title"
        style={{
          maxWidth: '880px',
          width: '95vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                }}
              >
                <Radio size={12} />
                IFRAME & POSTMESSAGE BRIDGE ATIVA
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Rota dedicada: <code>/embed</code>
              </span>
            </div>
            <h2 id="chatbot-bridge-modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
              Integração Nativa com o Chatbot (WhatsApp / CRM)
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              O AppRemoto está 100% preparado para abrir dentro de um <code>&lt;iframe&gt;</code> no Chatbot e filtrar automaticamente os computadores pelo CNPJ do contato da conversa.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar central de integração Chatbot"
          >
            <X size={18} />
          </button>
        </div>

        {/* Abas de navegação do Modal */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-subtle, rgba(148,163,184,0.2))', paddingBottom: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={activeTab === 'simulator' ? 'primary-button' : 'command-button'}
            onClick={() => setActiveTab('simulator')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.84rem' }}
          >
            <Sparkles size={15} />
            1. Testar Recebimento de CNPJ ao Vivo
          </button>
          <button
            type="button"
            className={activeTab === 'code' ? 'primary-button' : 'command-button'}
            onClick={() => setActiveTab('code')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.84rem' }}
          >
            <Code2 size={15} />
            2. Código Pronto para o Chatbot (Iframe + Eventos)
          </button>
          <button
            type="button"
            className={activeTab === 'events' ? 'primary-button' : 'command-button'}
            onClick={() => setActiveTab('events')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.84rem' }}
          >
            <Terminal size={15} />
            3. Contrato de Eventos Bidirecionais ({eventLog.length})
          </button>
        </div>

        {activeTab === 'simulator' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: 'rgba(6, 182, 212, 0.08)',
                border: '1px solid rgba(6, 182, 212, 0.25)',
              }}
            >
              <strong style={{ display: 'block', marginBottom: 6, fontSize: '0.92rem' }}>
                Como funciona quando o atendente está em uma conversa no Chatbot:
              </strong>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                <li>
                  O contato no Chatbot tem o <strong>CNPJ</strong> salvo (ou o Chatbot envia o CNPJ via URL <code>/embed?cnpj=...</code> ou via <code>postMessage</code>).
                </li>
                <li>
                  O AppRemoto recebe o evento <code>XPOINT_REMOTE_SET_CNPJ</code>, posiciona automaticamente no grupo empresarial daquele CNPJ e lista todas as máquinas da empresa (ex.: <code>SERVIDOR</code>, <code>CAIXA-01</code>, <code>BALANCA-01</code>).
                </li>
                <li>
                  O AppRemoto devolve ao Chatbot o evento <code>XPOINT_REMOTE_CNPJ_RESOLVED</code> com as máquinas online/offline e, ao conectar ou encerrar, envia o protocolo e o resumo do atendimento para a conversa!
                </li>
              </ol>
            </div>

            {knownCompanies.length > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 8 }}>
                  Selecione um cliente/CNPJ já salvo no banco para simular o clique no Chatbot:
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {knownCompanies.map((item) => (
                    <button
                      key={item.cnpj}
                      type="button"
                      className="command-button"
                      style={{
                        fontSize: '0.78rem',
                        padding: '6px 12px',
                        borderColor: simCnpj === item.cnpj ? '#06b6d4' : undefined,
                      }}
                      onClick={() => {
                        setSimCnpj(item.cnpj);
                        setSimContactName(item.name);
                      }}
                    >
                      <strong>{item.name}</strong> · {item.formatted} ({item.count} PC{item.count > 1 ? 's' : ''})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <label htmlFor="sim-cnpj-input" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                  CNPJ / Documento enviado pelo Chatbot
                </label>
                <input
                  id="sim-cnpj-input"
                  type="text"
                  value={simCnpj}
                  onChange={(e) => setSimCnpj(e.target.value)}
                  placeholder="Ex.: 12.345.678/0001-90"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.3)', background: 'var(--surface-input, rgba(15,23,42,0.5))', color: 'inherit' }}
                />
              </div>
              <div>
                <label htmlFor="sim-contact-input" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                  Nome do Contato no Chatbot
                </label>
                <input
                  id="sim-contact-input"
                  type="text"
                  value={simContactName}
                  onChange={(e) => setSimContactName(e.target.value)}
                  placeholder="Ex.: Padaria Pão Quente"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.3)', background: 'var(--surface-input, rgba(15,23,42,0.5))', color: 'inherit' }}
                />
              </div>
              <div>
                <label htmlFor="sim-phone-input" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                  WhatsApp do Contato (opcional)
                </label>
                <input
                  id="sim-phone-input"
                  type="text"
                  value={simPhone}
                  onChange={(e) => setSimPhone(e.target.value)}
                  placeholder="5511999999999"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.3)', background: 'var(--surface-input, rgba(15,23,42,0.5))', color: 'inherit' }}
                />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={simOpenModal}
                onChange={(e) => setSimOpenModal(e.target.checked)}
              />
              Abrir também a Ficha de Funções do Grupo CNPJ automaticamente ao receber o evento
            </label>

            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                  URL direta para o <code>&lt;iframe src=&quot;...&quot;&gt;</code> no Chatbot:
                </span>
                <code style={{ fontSize: '0.78rem', wordBreak: 'break-all', color: '#38bdf8' }}>
                  {embedUrlExample}
                </code>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="command-button"
                  onClick={() => copyText('url', embedUrlExample)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}
                >
                  {copiedKey === 'url' ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey === 'url' ? 'URL Copiada!' : 'Copiar URL'}
                </button>
                <a
                  href={embedUrlExample}
                  target="_blank"
                  rel="noreferrer"
                  className="command-button"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', textDecoration: 'none' }}
                >
                  <ExternalLink size={14} />
                  Abrir /embed
                </a>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button type="button" className="command-button" onClick={onClose}>
                Fechar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!simCnpj.trim()}
                onClick={handleTriggerSimulation}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <Play size={16} />
                Simular Evento do Chatbot com este CNPJ
              </button>
            </div>
          </div>
        )}

        {activeTab === 'code' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                Copie este componente para o projeto do <strong>Chatbot</strong>. Ele abre o AppRemoto em iframe e sincroniza o CNPJ do contato em tempo real:
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => copyText('code', reactIntegrationCode)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}
              >
                {copiedKey === 'code' ? <Check size={15} /> : <Copy size={15} />}
                {copiedKey === 'code' ? 'Código Copiado!' : 'Copiar Componente React'}
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 16,
                borderRadius: 10,
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.78rem',
                lineHeight: 1.5,
                overflowX: 'auto',
                border: '1px solid rgba(148,163,184,0.25)',
              }}
            >
              <code>{reactIntegrationCode}</code>
            </pre>
          </div>
        )}

        {activeTab === 'events' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(148,163,184,0.2)' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', marginBottom: 8, color: '#38bdf8' }}>
                  <MessageSquare size={15} />
                  Eventos que o Chatbot ENVIA para o AppRemoto:
                </strong>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', lineHeight: 1.65 }}>
                  <li>
                    <code>XPOINT_REMOTE_SET_CNPJ</code>: define o <code>cnpj</code>, <code>contactName</code>, <code>contactPhone</code> e <code>conversationId</code> ativos e filtra os computadores da empresa.
                  </li>
                  <li>
                    <code>XPOINT_REMOTE_OPEN_CNPJ_MODAL</code>: abre a central completa de funções e computadores daquele CNPJ.
                  </li>
                  <li>
                    <code>XPOINT_REMOTE_CONNECT_DEVICE</code>: dispara a conexão direta em um <code>deviceId</code>, <code>rustdeskId</code> ou função (ex.: <code>role: &quot;SERVIDOR&quot;</code>).
                  </li>
                  <li>
                    <code>XPOINT_REMOTE_CLEAR_CNPJ</code>: limpa o filtro atual e exibe todas as organizações.
                  </li>
                </ul>
              </div>

              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(148,163,184,0.2)' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', marginBottom: 8, color: '#34d399' }}>
                  <Radio size={15} />
                  Eventos que o AppRemoto DEVOLVE ao Chatbot:
                </strong>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', lineHeight: 1.65 }}>
                  <li>
                    <code>XPOINT_REMOTE_READY</code>: informa ao Chatbot que o iframe carregou e está pronto.
                  </li>
                  <li>
                    <code>XPOINT_REMOTE_CNPJ_RESOLVED</code>: devolve a contagem de máquinas (online/offline) e a lista de computadores daquele CNPJ.
                  </li>
                  <li>
                    <code>XPOINT_REMOTE_CONTACT_ASSOCIATED</code>: disparado quando o técnico clica em &quot;Associar ao Contato&quot; para salvar o vínculo no Chatbot.
                  </li>
                  <li>
                    <code>XPOINT_REMOTE_SESSION_STARTED</code> / <code>ENDED</code>: envia o protocolo, máquina e resumo do atendimento para registrar na conversa.
                  </li>
                </ul>
              </div>
            </div>

            <div>
              <strong style={{ display: 'block', fontSize: '0.84rem', marginBottom: 6 }}>
                Últimos eventos emitidos pelo AppRemoto nesta sessão:
              </strong>
              {eventLog.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Nenhum evento emitido ainda. Use a aba &quot;1. Testar Recebimento de CNPJ ao Vivo&quot; para disparar um teste.
                </p>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    borderRadius: 8,
                    background: '#0f172a',
                    color: '#a7f3d0',
                    fontSize: '0.75rem',
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  <code>{JSON.stringify(eventLog, null, 2)}</code>
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
