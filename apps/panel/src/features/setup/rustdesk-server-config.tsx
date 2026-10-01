'use client';

import { Copy } from 'lucide-react';
import { useState } from 'react';

// Public client connection settings, verified against the running XPoint hbbs/hbbr
// service on 2026-10-01. This is the Ed25519 PUBLIC key (32 bytes), not a secret.
const fields = [
  { id: 'id-server', label: 'ID Server', value: '179.199.142.157:21116' },
  { id: 'relay-server', label: 'Relay Server', value: '179.199.142.157:21117' },
  { id: 'key', label: 'Key', value: '6qc86QUPst9+H4QjXyQvSLPbGU6ef25iO+ESoi3figk=' },
] as const;

export function RustDeskServerConfig() {
  const [message, setMessage] = useState('');

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copiado. Cole no campo de mesmo nome no RustDesk.`);
    } catch {
      setMessage(`Não foi possível copiar ${label}. Selecione o valor no campo correspondente e copie manualmente.`);
    }
  }

  return <section className="rustdesk-config" aria-labelledby="rustdesk-config-title">
    <h3 id="rustdesk-config-title">Dados do servidor XPoint</h3>
    <p>No RustDesk, abra <strong>Configurações → Rede</strong>, desbloqueie as configurações e preencha os campos abaixo. Use os mesmos valores no computador do cliente e no computador do técnico; depois clique em <strong>Aplicar</strong>.</p>
    <p>Copie somente o valor, sem acrescentar <strong>http://</strong> ou <strong>https://</strong>. A <strong>Key</strong> abaixo é a chave pública do servidor.</p>
    <div className="rustdesk-config-fields">
      {fields.map((field) => <div className="rustdesk-config-field" key={field.id}>
        <label htmlFor={'rustdesk-' + field.id}>{field.label}</label>
        <div className="rustdesk-config-value">
          <textarea id={'rustdesk-' + field.id} rows={field.id === 'key' ? 2 : 1} readOnly value={field.value} spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="command-button guide-link" aria-label={'Copiar ' + field.label} onClick={() => void copy(field.label, field.value)}><Copy size={18} aria-hidden="true" />Copiar</button>
        </div>
      </div>)}
      <div className="rustdesk-config-field">
        <label htmlFor="rustdesk-api-server">API Server</label>
        <input id="rustdesk-api-server" readOnly value="" placeholder="Deixe vazio" aria-describedby="rustdesk-api-help" />
        <p id="rustdesk-api-help">Deixe este campo vazio. Não cole a URL do painel nem a API do AppRemoto.</p>
      </div>
    </div>
    <p className="rustdesk-copy-status" role="status">{message}</p>
    <p>Após aplicar, volte à tela inicial do RustDesk e confirme que aparece o ID e o estado pronto para conexão.</p>
  </section>;
}
