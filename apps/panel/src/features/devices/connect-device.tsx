'use client';

import { MonitorUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionEpoch } from '../auth/session-cache';
import { launchRustDesk } from './rustdesk-launch';

export interface ConnectionService {
  connectDevice(deviceId: string): Promise<{ launchUri: string }>;
}

export function ConnectDevice({ deviceId, enabled, service }: { deviceId: string; enabled: boolean; service: ConnectionService }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const active = useRef(false);
  const currentDevice = useRef(deviceId);
  currentDevice.current = deviceId;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function connect() {
    if (!enabled || lock.current) return;
    lock.current = true;
    setPending(true); setMessage('');
    const epoch = sessionEpoch(queryClient);
    try {
      const result = await service.connectDevice(deviceId);
      try {
        if (!active.current || currentDevice.current !== deviceId || sessionEpoch(queryClient) !== epoch) return;
        launchRustDesk(result.launchUri);
      } finally { result.launchUri = ''; }
      setMessage('Solicitação enviada ao RustDesk. Confirme a abertura do aplicativo, se solicitado.');
    } catch {
      if (active.current && sessionEpoch(queryClient) === epoch) setMessage('Não foi possível iniciar o acesso. Confira a conexão e sua permissão e tente novamente.');
    } finally { lock.current = false; if (active.current) setPending(false); }
  }
  return <div className="device-connect">
    <button type="button" className="primary-button guide-link" disabled={!enabled || pending} onClick={() => void connect()} title={!enabled ? 'Aguarde o dispositivo ficar online e a atualização terminar.' : 'Abrir no RustDesk'}>
      <MonitorUp size={18} aria-hidden="true" />{pending ? 'Abrindo…' : 'Conectar'}
    </button>
    {message && <p role="status">{message}</p>}
  </div>;
}
