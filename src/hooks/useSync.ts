import { useState, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getSetting, saveSetting } from '../utils/db';
import { AccentTheme } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { v4 as uuidv4 } from 'uuid';

export interface SyncStatus {
  isSyncing: boolean;
  error: string | null;
  lastSynced: number | null;
}

export function useSync(modals: any) {
  const { showAlert, showConfirm } = modals;

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isPaired, setIsPaired] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');
  const [accentTheme, setAccentTheme] = useState<AccentTheme>('classic');

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    error: null,
    lastSynced: null,
  });

  // Initialize Settings & Device Identity
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const theme = await getSetting('theme_mode');
        if (theme && mounted) setThemeMode(theme as 'dark' | 'light');
        const accent = await getSetting('accent_theme');
        if (accent && mounted) setAccentTheme(accent as AccentTheme);

        let did = await getSetting('device_id');
        if (!did) {
          did = uuidv4();
          await saveSetting('device_id', did as string);
        }
        if (mounted) setDeviceId(did as string);

        const paired = await getSetting('is_paired');
        if (mounted) setIsPaired(paired === 'true');
      } catch (err) {
        console.error(err);
      }
    };
    init();
    return () => { mounted = false; };
  }, []);

  // Listen for pairing success from backend
  useEffect(() => {
    let unlistenFn: () => void;
    const setupListener = async () => {
      unlistenFn = await listen('device-paired', async (event) => {
        const pairedDeviceId = event.payload as string;
        setIsPaired(true);
        setPairingCode(null);
        await saveSetting('is_paired', 'true');
        await saveSetting(`paired_${pairedDeviceId}`, 'true');
        showAlert('Paired Successfully', 'Your device is now paired and ready to sync!');
      });
    };
    setupListener();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [showAlert]);

  // Show window with a slight delay so assets can load
  useEffect(() => {
    const timer = setTimeout(() => {
      getCurrentWindow().show().catch((err) => {
        console.error('Failed to show window:', err);
      });
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  // Update check
  useEffect(() => {
    const runUpdater = async () => {
      try {
        const update = await check();
        if (update && update.available) {
          const confirmed = await showConfirm(
            'Update Available',
            `A new version (v${update.version}) of BootHub is available. Would you like to download and install it now?`,
            { confirmText: 'Update Now', cancelText: 'Later' }
          );
          if (confirmed) {
            showAlert('Updating', 'Downloading and installing update... The application will restart or exit when complete.');
            await update.downloadAndInstall();
          }
        }
      } catch (err) {
        console.error('Failed to check for updates:', err);
      }
    };
    runUpdater();
  }, [showConfirm, showAlert]);

  const handlePairDevice = async () => {
    try {
      const code: string = await invoke('generate_pairing_code');
      setPairingCode(code);
    } catch (err) {
      console.error('Failed to generate pairing code:', err);
      showAlert('Error', 'Failed to generate pairing code.');
    }
  };

  const cancelPairing = () => {
    setPairingCode(null);
  };

  const handleDisconnect = async () => {
    const confirmed = await showConfirm(
      'Disconnect Device',
      'Disconnect from paired devices? This will stop syncing but local items will remain.',
      { confirmText: 'Disconnect', isDestructive: true }
    );
    if (confirmed) {
      await saveSetting('is_paired', 'false');
      setIsPaired(false);
    }
  };

  const handleManualSync = async () => {
    showAlert('Sync', 'P2P sync engine not yet implemented.');
  };

  const handleSetThemeMode = async (mode: 'dark' | 'light') => {
    setThemeMode(mode);
    await saveSetting('theme_mode', mode);
  };

  return {
    deviceId, isPaired, setIsPaired,
    pairingCode, handlePairDevice, cancelPairing,
    themeMode, setThemeMode, handleSetThemeMode,
    accentTheme, setAccentTheme,
    syncStatus, setSyncStatus,
    handleDisconnect, handleManualSync,
  };
}
