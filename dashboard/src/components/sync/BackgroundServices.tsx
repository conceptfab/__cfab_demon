import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-notification';
import { DaemonSyncOverlay } from '@/components/sync/DaemonSyncOverlay';
import { LanPeerNotification } from '@/components/sync/LanPeerNotification';
import {
  AI_ASSIGNMENT_DONE_EVENT,
  ONLINE_SYNC_DONE_EVENT,
  LAN_SYNC_DONE_EVENT,
} from '@/lib/background-helpers';
import {
  useAutoImporter,
  useAutoSessionRebuild,
  useStartupProjectSyncAndAiAssignment,
} from '@/hooks/useBackgroundStartup';
import { useJobPool } from '@/hooks/useJobPool';
import {
  useLanSyncServerStartup,
  useOnlineSyncSSE,
} from '@/hooks/useBackgroundSync';

export function BackgroundServices() {
  useAutoImporter();
  useAutoSessionRebuild();
  useStartupProjectSyncAndAiAssignment();
  useJobPool();
  useLanSyncServerStartup();
  useOnlineSyncSSE();

  const { t } = useTranslation();
  const { showInfo } = useToast();
  const showInfoRef = useRef(showInfo);
  showInfoRef.current = showInfo;
  const tRef = useRef(t);
  tRef.current = t;
  const handleAiAssignmentDone = useCallback((e: Event) => {
    const count = (e as CustomEvent<number>).detail;
    showInfoRef.current(tRef.current('background.ai_assigned_sessions', { count }));
  }, []);
  const handleOnlineSyncDone = useCallback((e: Event) => {
    const { action } = (e as CustomEvent<{ action: string; reason: string }>).detail;
    if (action === 'pull') {
      showInfoRef.current(tRef.current('background.online_sync_pulled', { defaultValue: 'Data synchronized from server' }));
    } else if (action === 'push') {
      showInfoRef.current(tRef.current('background.online_sync_pushed', { defaultValue: 'Data sent to server' }));
    }
  }, []);
  const handleLanSyncDone = useCallback((e: Event) => {
    const { peerName } = (e as CustomEvent<{ peerName: string }>).detail;
    showInfoRef.current(tRef.current('background.lan_sync_done', { peer: peerName, defaultValue: `LAN sync with ${peerName} completed` }));
  }, []);
  useEffect(() => {
    window.addEventListener(AI_ASSIGNMENT_DONE_EVENT, handleAiAssignmentDone);
    window.addEventListener(ONLINE_SYNC_DONE_EVENT, handleOnlineSyncDone);
    window.addEventListener(LAN_SYNC_DONE_EVENT, handleLanSyncDone);
    return () => {
      window.removeEventListener(AI_ASSIGNMENT_DONE_EVENT, handleAiAssignmentDone);
      window.removeEventListener(ONLINE_SYNC_DONE_EVENT, handleOnlineSyncDone);
      window.removeEventListener(LAN_SYNC_DONE_EVENT, handleLanSyncDone);
    };
  }, []);

  return (
    <>
      <LanPeerNotification />
      <DaemonSyncOverlay />
    </>
  );
}
