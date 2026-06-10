import React, { useState, useEffect } from 'react';
import {
  Link2,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Search,
  FolderPlus,
  Folder,
  ArrowUpRight,
  Plus,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import { TuiContainer } from './components/TuiContainer';
import { LinkPreview } from './components/LinkPreview';
import { TuiButton } from './components/TuiButton';
import { ConflictModal } from './components/ConflictModal';
import { TuiAlertModal } from './components/TuiAlertModal';
import { TitleBar } from './components/TitleBar';
import { IconSvg } from './components/IconSvg';
import { listen } from '@tauri-apps/api/event';
import {
  initiateOAuthFlow,
  exchangeCodeForTokens,
  fetchUserInfo,
  saveAuthSession,
  clearAuthSession,
  getGoogleUserInfo,
  isUserSignedIn,
  fetchAllMetadataFromDrive,
} from './utils/google-drive';
import {
  getItems,
  saveItems,
  getSyncQueue,
  saveSyncQueue,
  getItemFile,
  saveItemFile,
  deleteItemFile,
  addItem,
  DumpItem,
  getSetting,
  saveSetting,
  subscribeToStorage,
} from './utils/db';
import {
  subscribeToSyncStatus,
  processSyncQueue,
  enqueueSyncTask,
  enqueueSyncTasks,
  pullChangesFromDrive,
  setConflictResolver,
  subscribeToUploadProgress,
  SyncStatus,
  clearSyncError,
  updateSyncStatus,
  initializeRealtimeSync,
  closeRealtimeSync,
} from './utils/sync-engine';

const ACCENT_COLORS = {
  classic: { dark: '#FFFFFF', light: '#000000' },
  gray: { dark: '#71717A', light: '#71717A' },
  amber: { dark: '#F59E0B', light: '#D97706' },
  green: { dark: '#10B981', light: '#059669' },
  rose: { dark: '#F43F5E', light: '#E11D48' },
  cobalt: { dark: '#3B82F6', light: '#2563EB' },
};

type AccentTheme = 'classic' | 'gray' | 'amber' | 'green' | 'rose' | 'cobalt';
type TabType = 'link' | 'text' | 'photo' | 'file';

interface PhotoThumbnailProps {
  itemId: string;
}

const PhotoThumbnail: React.FC<PhotoThumbnailProps> = ({ itemId }) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const loadImg = async () => {
      try {
        const blob = await getItemFile(itemId);
        if (blob && active) {
          objectUrl = URL.createObjectURL(blob);
          setImgUrl(objectUrl);
        }
      } catch (err) {
        console.error('Failed to load thumbnail:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadImg();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [itemId]);

  if (loading) {
    return (
      <div className="border-[1.5px] border-border aspect-video bg-card flex items-center justify-center select-none">
        <span className="text-[10px] text-muted font-bold animate-pulse">[ Loading... ]</span>
      </div>
    );
  }

  if (!imgUrl) {
    return (
      <div className="border-[1.5px] border-border aspect-video bg-black flex items-center justify-center select-none">
        <ImageIcon size={24} className="text-zinc-700" />
      </div>
    );
  }

  return (
    <div className="border-[1.5px] border-border aspect-video bg-black flex items-center justify-center overflow-hidden select-none">
      <img
        src={imgUrl}
        alt="thumbnail"
        className="w-full h-full object-cover"
      />
    </div>
  );
};

interface PhotoPreviewModalProps {
  itemId: string;
  onClose: () => void;
}

const PhotoPreviewModal: React.FC<PhotoPreviewModalProps> = ({ itemId, onClose }) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const loadImg = async () => {
      try {
        const blob = await getItemFile(itemId);
        if (blob && active) {
          objectUrl = URL.createObjectURL(blob);
          setImgUrl(objectUrl);
        }
      } catch (err) {
        console.error('Failed to load preview:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadImg();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [itemId]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4 select-none animate-in fade-in duration-150 cursor-zoom-out"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl flex flex-col items-center gap-4 cursor-default animate-in zoom-in-95 duration-150"
      >
        <TuiContainer label="Photo Preview">
          <div className="relative flex flex-col items-center justify-center min-h-[200px] py-2">
            {loading ? (
              <span className="text-sm text-muted font-bold animate-pulse font-mono">[ Loading Image... ]</span>
            ) : imgUrl ? (
              <img
                src={imgUrl}
                alt="preview"
                className="max-w-full max-h-[70vh] border-[1.5px] border-border object-contain bg-[#09090b]"
              />
            ) : (
              <span className="text-sm text-destructive font-bold font-mono">Failed to load preview image.</span>
            )}
            
            <div className="flex gap-4 mt-6 w-full max-w-xs justify-center mx-auto">
              <TuiButton onPress={onClose} variant="outline" className="flex-1">
                Close
              </TuiButton>
            </div>
          </div>
        </TuiContainer>
      </div>
    </div>
  );
};

export default function App() {
  const dragCounter = React.useRef(0);
  const isInternalDrag = React.useRef(false);

  // Track if a drag operation started inside the app
  useEffect(() => {
    const handleDragStart = () => {
      isInternalDrag.current = true;
    };
    const handleDragEnd = () => {
      isInternalDrag.current = false;
    };
    window.addEventListener('dragstart', handleDragStart);
    window.addEventListener('dragend', handleDragEnd);
    return () => {
      window.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('dragend', handleDragEnd);
    };
  }, []);

  // Navigation & View State
  const [activeTab, setActiveTab] = useState<TabType>('link');
  const [searchQuery, setSearchQuery] = useState('');

  // Item List & Folder States
  const [items, setItems] = useState<DumpItem[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);

  // Input fields
  const [inputText, setInputText] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    if (isInternalDrag.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (isInternalDrag.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragActive(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (isInternalDrag.current) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    if (isInternalDrag.current) return;
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileDrop(e.dataTransfer.files);
    }
  };

  // Authentication & Settings
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');
  const [accentTheme, setAccentTheme] = useState<AccentTheme>('classic');

  // Custom folder prompt
  const [folderPrompt, setFolderPrompt] = useState({
    visible: false,
    name: '',
  });

  // Custom dialog alert/confirm modal state
  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm';
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    type: 'alert',
    onConfirm: () => {},
  });

  const showAlert = (title: string, message: string, onConfirm?: () => void) => {
    return new Promise<void>((resolve) => {
      setDialog({
        visible: true,
        title,
        message,
        type: 'alert',
        confirmText: 'OK',
        onConfirm: () => {
          setDialog((prev) => ({ ...prev, visible: false }));
          if (onConfirm) onConfirm();
          resolve();
        },
      });
    });
  };

  const showConfirm = (
    title: string,
    message: string,
    options?: { confirmText?: string; cancelText?: string; isDestructive?: boolean }
  ) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        visible: true,
        title,
        message,
        type: 'confirm',
        confirmText: options?.confirmText || 'OK',
        cancelText: options?.cancelText || 'Cancel',
        isDestructive: options?.isDestructive || false,
        onConfirm: () => {
          setDialog((prev) => ({ ...prev, visible: false }));
          resolve(true);
        },
        onCancel: () => {
          setDialog((prev) => ({ ...prev, visible: false }));
          resolve(false);
        },
      });
    });
  };

  // Sync Status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    error: null,
    lastSynced: null,
  });
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  // Custom modals/alerts
  const [conflictAlert, setConflictAlert] = useState<{
    visible: boolean;
    title: string;
    message: string;
    options: Array<{ text: string; onPress: () => void; style?: 'cancel' | 'destructive' }>;
  }>({
    visible: false,
    title: '',
    message: '',
    options: [],
  });

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    item: DumpItem | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
  });

  const [editPrompt, setEditPrompt] = useState<{
    visible: boolean;
    itemId: string;
    label: string;
    value: string;
    type: DumpItem['type'];
  }>({
    visible: false,
    itemId: '',
    label: '',
    value: '',
    type: 'text',
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragBox, setDragBox] = useState<{
    active: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  }>({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });

  // Global handler to hide context menu on click or right-click elsewhere
  useEffect(() => {
    const handleGlobalClose = (e: MouseEvent) => {
      // Prevent default browser context menu globally
      if (e.type === 'contextmenu') {
        e.preventDefault();
      }
      setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    window.addEventListener('click', handleGlobalClose);
    window.addEventListener('contextmenu', handleGlobalClose);
    return () => {
      window.removeEventListener('click', handleGlobalClose);
      window.removeEventListener('contextmenu', handleGlobalClose);
    };
  }, []);



  // Global handler to end drag selection
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setDragBox((prev) => {
        if (prev.active) return { ...prev, active: false };
        return prev;
      });
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const handleClipboardFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const currentItems = await getItems();
    const newItemsList: DumpItem[] = [];

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = `${Date.now()}_clipboard_${i}`;
      const isImage = file.type.startsWith('image/');
      const type = (isImage || activeTab === 'photo') ? 'photo' : 'file';

      let value = '';
      if (type === 'photo') {
        value = file.name || `screenshot_${id}.png`;
      } else {
        value = JSON.stringify({
          name: file.name || `file_${id}.bin`,
          size: file.size,
          mimeType: file.type,
        });
      }

      const newItem: DumpItem = {
        id,
        type,
        label,
        value,
        syncState: 'pending',
        folderId: activeFolderId || undefined,
      };

      await saveItemFile(id, file);
      await addItem(newItem);
      newItemsList.push(newItem);
    }

    const merged = [...newItemsList, ...currentItems];
    setItems(merged);

    await enqueueSyncTasks(
      newItemsList.map((item) => ({
        action: 'UPLOAD',
        itemId: item.id,
        itemType: item.type,
      }))
    );
    processSyncQueue();
  };

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;

      const files: File[] = [];
      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        handleClipboardFiles(files);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [activeFolderId, activeTab]);

  // Load local database items and auth status on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const localItems = await getItems();
        setItems(localItems);

        const signed = await isUserSignedIn();
        setIsSignedIn(signed);
        if (signed) {
          const info = await getGoogleUserInfo();
          setUserInfo(info);
          // Auto-trigger sync on launch
          processSyncQueue();
          initializeRealtimeSync();
        }

        // Load theme preferences
        const savedMode = await getSetting<'dark' | 'light'>('theme_mode');
        if (savedMode) setThemeMode(savedMode);
        
        const savedAccent = await getSetting<AccentTheme>('accent_theme');
        if (savedAccent) setAccentTheme(savedAccent);
      } catch (err) {
        console.error('Failed to initialize local data:', err);
      } finally {
        setIsAuthLoading(false);
      }
    };
    loadData();

    const unsubscribeStorage = subscribeToStorage(async () => {
      try {
        const data = await getItems();
        setItems(data);
      } catch (err) {
        console.error('Failed to reload items on storage change:', err);
      }
    });

    // Subscribe to global sync progress & status events
    const unsubscribeSync = subscribeToSyncStatus((status) => {
      setSyncStatus(status);
    });

    const unsubscribeProgress = subscribeToUploadProgress((itemId, progress) => {
      setUploadProgress((prev) => ({ ...prev, [itemId]: progress }));
    });

    return () => {
      unsubscribeStorage();
      unsubscribeSync();
      unsubscribeProgress();
    };
  }, []);

  // Listen to Google OAuth redirects from Rust TCP server
  useEffect(() => {
    const setupOauthListener = async () => {
      const unlisten = await listen('oauth-code', async (event) => {
        const code = event.payload as string;
        try {
          setIsAuthLoading(true);
          const verifier = localStorage.getItem('boothub_oauth_verifier') || '';
          const redirectUri = 'http://localhost:14200/oauth2redirect';

          const tokens = await exchangeCodeForTokens(code, verifier, redirectUri);
          const info = await fetchUserInfo(tokens.access_token);

          await saveAuthSession(tokens.access_token, tokens.refresh_token, tokens.expires_in, info);
          setIsSignedIn(true);
          setUserInfo(info);
          clearSyncError();
          initializeRealtimeSync();

          // Handle sync conflict upon sign-in/reconnection
          const queue = await getSyncQueue();
          const hasPendingDeletions = queue.some((t) => t.action === 'DELETE');
          let handledConflict = false;

          if (hasPendingDeletions) {
            const remoteFiles = await fetchAllMetadataFromDrive(tokens.access_token);
            if (remoteFiles && remoteFiles.length > 0) {
              handledConflict = true;
              setConflictAlert({
                visible: true,
                title: 'Sync Conflict Detected',
                message:
                  'You deleted some items on this device while disconnected, but they still exist on Google Drive. Would you like to restore them to this device or remove them from Google Drive?',
                options: [
                  {
                    text: 'Restore to Device',
                    onPress: async () => {
                      setConflictAlert((prev) => ({ ...prev, visible: false }));
                      updateSyncStatus({ isSyncing: true, error: null });
                      try {
                        const currentQueue = await getSyncQueue();
                        const filteredQueue = currentQueue.filter((t) => t.action !== 'DELETE');
                        await saveSyncQueue(filteredQueue);
                        await pullChangesFromDrive();
                      } catch (e) {
                        console.error(e);
                      } finally {
                        processSyncQueue();
                      }
                    },
                  },
                  {
                    text: 'Remove from Drive',
                    style: 'destructive',
                    onPress: () => {
                      setConflictAlert((prev) => ({ ...prev, visible: false }));
                      updateSyncStatus({ isSyncing: true, error: null });
                      processSyncQueue();
                    },
                  },
                ],
              });
            }
          }

          if (!handledConflict) {
            await pullChangesFromDrive();
          }
        } catch (err: any) {
          console.error('Failed to exchange auth tokens:', err);
          const errorMsg = err.response?.data
            ? (typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data))
            : (err.message || String(err));
          showAlert('Auth Error', `Google Auth failed: ${errorMsg}`);
        } finally {
          setIsAuthLoading(false);
        }
      });

      return unlisten;
    };

    const unlistenPromise = setupOauthListener();
    return () => {
      unlistenPromise.then((unlistenFn) => unlistenFn());
    };
  }, []);

  // Register the sync engine conflict modal trigger
  useEffect(() => {
    setConflictResolver((count) => {
      return new Promise((resolve) => {
        setConflictAlert({
          visible: true,
          title: 'Sync Conflict Detected',
          message: `We found ${count} item(s) that were deleted on Google Drive but still exist on this device. Would you like to restore them to the cloud or remove them from this device?`,
          options: [
            {
              text: 'Restore to Cloud',
              onPress: () => {
                setConflictAlert((prev) => ({ ...prev, visible: false }));
                resolve('follow_phone');
              },
            },
            {
              text: 'Remove from Device',
              style: 'destructive',
              onPress: () => {
                setConflictAlert((prev) => ({ ...prev, visible: false }));
                resolve('follow_drive');
              },
            },
          ],
        });
      });
    });
  }, []);

  // Handle Google Drive login triggers
  const handleConnect = async () => {
    setIsAuthLoading(true);
    try {
      await initiateOAuthFlow();
    } catch (err) {
      console.error(err);
      setIsAuthLoading(false);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = await showConfirm(
      'Disconnect Cloud',
      'Disconnect Google Drive? This will stop syncing but local items will remain.',
      { confirmText: 'Disconnect', isDestructive: true }
    );
    if (confirmed) {
      setIsAuthLoading(true);
      await clearAuthSession();
      setIsSignedIn(false);
      setUserInfo(null);
      setIsAuthLoading(false);
      closeRealtimeSync();
    }
  };

  const handleManualSync = () => {
    pullChangesFromDrive().catch((err) => console.error(err));
  };

  const handleSetThemeMode = async (mode: 'dark' | 'light') => {
    setThemeMode(mode);
    await saveSetting('theme_mode', mode);
  };

  // --- Creator actions ---

  const handleSubmitItem = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const trimmed = inputText.trim();
    // Parse links
    const isUrl = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(trimmed);
    const type = isUrl ? 'link' : 'text';

    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`;

    const newItem: DumpItem = {
      id,
      type,
      label,
      value: trimmed,
      syncState: 'pending',
      folderId: activeFolderId || undefined,
    };

    const currentItems = await getItems();
    await saveItems([newItem, ...currentItems]);
    setItems([newItem, ...currentItems]);
    setInputText('');

    await enqueueSyncTask('UPLOAD', newItem.id, newItem.type);
    processSyncQueue();
  };

  const handleFileDrop = async (files: FileList) => {
    if (files.length === 0) return;

    const currentItems = await getItems();
    const newItemsList: DumpItem[] = [];

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = `${Date.now()}_${i}`;
      const isImage = file.type.startsWith('image/');
      const type = isImage ? 'photo' : 'file';

      let value = '';
      if (isImage) {
        value = file.name;
      } else {
        value = JSON.stringify({
          name: file.name,
          size: file.size,
          mimeType: file.type,
        });
      }

      const newItem: DumpItem = {
        id,
        type,
        label,
        value,
        syncState: 'pending',
        folderId: activeFolderId || undefined,
      };

      // Save binary blob to IndexedDB
      await saveItemFile(id, file);
      await addItem(newItem);
      newItemsList.push(newItem);
    }

    const merged = [...newItemsList, ...currentItems];
    setItems(merged);

    await enqueueSyncTasks(
      newItemsList.map((item) => ({
        action: 'UPLOAD',
        itemId: item.id,
        itemType: item.type,
      }))
    );
    processSyncQueue();
  };

  const handleCreateFolder = () => {
    setFolderPrompt({ visible: true, name: '' });
  };

  const createFolderWithName = async (name: string) => {
    const id = `folder_${Date.now()}`;
    const value = JSON.stringify({
      name: name.trim(),
      tab: activeTab,
    });

    const newItem: DumpItem = {
      id,
      type: 'folder',
      label: name.trim(),
      value,
      syncState: 'pending',
      folderId: activeFolderId || undefined,
    };

    const currentItems = await getItems();
    const merged = [newItem, ...currentItems];
    await saveItems(merged);
    setItems(merged);

    await enqueueSyncTask('UPLOAD', newItem.id, newItem.type);
    processSyncQueue();
  };

  const handleDeleteItem = async (item: DumpItem) => {
    const confirmed = await showConfirm(
      'Confirm Deletion',
      `Delete "${item.label || item.type}"?`,
      { confirmText: 'Delete', isDestructive: true }
    );
    if (!confirmed) return;

    const currentItems = await getItems();
    const filtered = currentItems.filter((x) => x.id !== item.id);
    await saveItems(filtered);
    setItems(filtered);

    // Delete linked local file if present
    if (item.type === 'photo' || item.type === 'file') {
      await deleteItemFile(item.id);
    }

    await enqueueSyncTask('DELETE', item.id, item.type, {
      driveFileId: item.driveFileId,
      driveMetaFileId: item.driveMetaFileId,
    });
    processSyncQueue();
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await showConfirm(
      'Confirm Deletion',
      count === 1
        ? `Delete the selected item?`
        : `Delete all ${count} selected items?`,
      { confirmText: 'Delete', isDestructive: true }
    );
    if (!confirmed) return;

    const currentItems = await getItems();
    const remaining = currentItems.filter(x => !selectedIds.has(x.id));
    const deletedItems = currentItems.filter(x => selectedIds.has(x.id));
    await saveItems(remaining);
    setItems(remaining);
    setSelectedIds(new Set());

    for (const delItem of deletedItems) {
      if (delItem.type === 'photo' || delItem.type === 'file') {
        await deleteItemFile(delItem.id);
      }
      await enqueueSyncTask('DELETE', delItem.id, delItem.type, {
        driveFileId: delItem.driveFileId,
        driveMetaFileId: delItem.driveMetaFileId,
      });
    }
    processSyncQueue();
  };

  // Copy helper
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showAlert('Success', 'Copied to clipboard!');
  };

  // Download binary helper
  const handleDownloadFile = async (item: DumpItem) => {
    const blob = await getItemFile(item.id);
    if (!blob) {
      showAlert('Error', 'Local file not found on disk.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    if (item.type === 'photo') {
      a.download = `photo_${item.id}.jpg`;
    } else {
      const fileObj = JSON.parse(item.value);
      a.download = fileObj.name || 'file';
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyItem = async (item: DumpItem) => {
    try {
      if (item.type === 'text' || item.type === 'link') {
        await navigator.clipboard.writeText(item.value);
        showAlert('Success', 'Copied text to clipboard!');
      } else if (item.type === 'photo') {
        const blob = await getItemFile(item.id);
        if (blob) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({
                [blob.type]: blob
              })
            ]);
            showAlert('Success', 'Copied photo to clipboard!');
          } catch (e) {
            await navigator.clipboard.writeText(item.value);
            showAlert('Success', 'Copied photo filename to clipboard!');
          }
        } else {
          await navigator.clipboard.writeText(item.value);
          showAlert('Success', 'Copied photo filename to clipboard!');
        }
      } else {
        let name = item.value;
        try {
          const parsed = JSON.parse(item.value);
          name = parsed.name || item.value;
        } catch (_) {}
        await navigator.clipboard.writeText(name);
        showAlert('Success', `Copied filename "${name}" to clipboard!`);
      }
    } catch (err) {
      console.error('Copy failed:', err);
      showAlert('Error', 'Failed to copy to clipboard.');
    }
  };

  const handleCutItem = async (item: DumpItem) => {
    await handleCopyItem(item);

    const currentItems = await getItems();
    const filtered = currentItems.filter((x) => x.id !== item.id);
    await saveItems(filtered);
    setItems(filtered);

    if (item.type === 'photo' || item.type === 'file') {
      await deleteItemFile(item.id);
    }

    await enqueueSyncTask('DELETE', item.id, item.type, {
      driveFileId: item.driveFileId,
      driveMetaFileId: item.driveMetaFileId,
    });
    processSyncQueue();
  };

  // Folder helper
  const getFolderTab = (item: DumpItem) => {
    try {
      return JSON.parse(item.value).tab || 'link';
    } catch {
      return 'link';
    }
  };

  const getFolderName = (item: DumpItem) => {
    try {
      return JSON.parse(item.value).name || item.label;
    } catch {
      return item.label;
    }
  };

  const handleSaveEdit = async () => {
    if (!editPrompt.itemId) return;
    const currentItems = await getItems();
    const updatedItems = currentItems.map((item) => {
      if (item.id === editPrompt.itemId) {
        return {
          ...item,
          label: editPrompt.label.trim(),
          value: editPrompt.type === 'text' || editPrompt.type === 'link' ? editPrompt.value.trim() : item.value,
          syncState: 'pending' as const,
        };
      }
      return item;
    });
    await saveItems(updatedItems);
    setItems(updatedItems);
    setEditPrompt((prev) => ({ ...prev, visible: false }));

    await enqueueSyncTask('UPLOAD', editPrompt.itemId, editPrompt.type);
    processSyncQueue();
  };

  // Filter items
  const filteredList = items.filter((item) => {
    // Check search query
    if (searchQuery) {
      const match = item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.value.toLowerCase().includes(searchQuery.toLowerCase());
      if (!match) return false;
    }

    // Check nested folder hierarchy
    if (item.folderId !== (activeFolderId || undefined)) {
      return false;
    }

    // Check tab type
    if (item.type === 'folder') {
      return getFolderTab(item) === activeTab;
    }
    return item.type === activeTab;
  });

  const folders = filteredList.filter((item) => item.type === 'folder');
  const normalItems = filteredList.filter((item) => item.type !== 'folder');

  // Keyboard shortcut Ctrl+A and Delete/Del listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputActive = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '');
      if (isInputActive) return;

      if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const allIds = filteredList.map((item) => item.id);
        setSelectedIds(new Set(allIds));
      } else if ((e.key === 'Delete' || e.key === 'Del') && selectedIds.size > 0) {
        e.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredList, selectedIds]);

  const renderCard = (item: DumpItem) => {
    const isSyncing = item.syncState === 'syncing';
    const progress = uploadProgress[item.id] || 0;
    const isSelected = selectedIds.has(item.id);

    return (
      <div
        key={item.id}
        data-id={item.id}
        className={`item-card relative animate-in fade-in duration-200 select-none ${
          isSelected ? 'bg-primary/5 transition-colors duration-150' : ''
        }`}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();

          let newSelected = new Set(selectedIds);
          if (!selectedIds.has(item.id)) {
            newSelected = new Set([item.id]);
            setSelectedIds(newSelected);
          }

          setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            item,
          });
        }}
        onClick={(e) => {
          e.stopPropagation();
          const newSelected = new Set(selectedIds);
          if (e.ctrlKey || e.metaKey) {
            if (newSelected.has(item.id)) {
              newSelected.delete(item.id);
            } else {
              newSelected.add(item.id);
            }
          } else if (e.shiftKey && selectedIds.size > 0) {
            // Shift click range selection
            const listIds = filteredList.map(x => x.id);
            const currentIdx = listIds.indexOf(item.id);
            const lastSelectedId = Array.from(selectedIds).pop();
            const lastIdx = lastSelectedId ? listIds.indexOf(lastSelectedId) : -1;
            
            if (lastIdx !== -1) {
              const start = Math.min(lastIdx, currentIdx);
              const end = Math.max(lastIdx, currentIdx);
              for (let i = start; i <= end; i++) {
                newSelected.add(listIds[i]);
              }
            } else {
              newSelected.add(item.id);
            }
          } else {
            newSelected.clear();
            newSelected.add(item.id);
          }
          setSelectedIds(newSelected);
        }}
      >
        <TuiContainer
          label={item.type === 'folder' ? '' : item.label}
          accentBorder={isSyncing || isSelected}
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          contentStyle={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
        >
          {/* Sync Progress Bar */}
          {isSyncing && (
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary/20">
              <div
                className="h-full bg-primary transition-all duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          <div className="flex flex-col gap-3 h-full justify-between flex-1">
            {/* Content area */}
            {item.type === 'folder' ? (
              <button
                onClick={() => setActiveFolderId(item.id)}
                className="flex items-center gap-3 text-left w-full hover:text-primary group"
              >
                <Folder size={16} className="text-primary fill-primary/10 group-hover:scale-110 transition-transform duration-150" />
                <span className="font-bold text-sm leading-tight">{getFolderName(item)}</span>
              </button>
            ) : item.type === 'link' ? (
              <div className="flex flex-col gap-1">
                <a
                  href={item.value.startsWith('http') ? item.value : `https://${item.value}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-sm font-bold flex items-center justify-between gap-1.5 w-full min-w-0"
                >
                  <span className="truncate flex-1 min-w-0">
                    {item.value}
                  </span>
                  <ArrowUpRight size={14} className="shrink-0" />
                </a>
                <LinkPreview url={item.value.startsWith('http') ? item.value : `https://${item.value}`} />
              </div>
            ) : item.type === 'text' ? (
              <p className="text-xs leading-relaxed text-foreground break-all whitespace-pre-wrap select-text">
                {item.value}
              </p>
            ) : item.type === 'photo' ? (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setPreviewPhotoId(item.id)}
                  className="w-full text-left cursor-pointer hover:opacity-95 active:scale-[0.99] transition-all duration-150"
                  title="Click to view full preview"
                >
                  <PhotoThumbnail itemId={item.id} />
                </button>
              </div>
            ) : (
              // File
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-bold leading-tight truncate">
                  {JSON.parse(item.value).name}
                </p>
                <p className="text-[10px] text-muted">
                  {(JSON.parse(item.value).size / 1024).toFixed(1)} KB
                </p>
              </div>
            )}
          </div>
        </TuiContainer>
      </div>
    );
  };

  const getPrimaryForeground = (theme: AccentTheme, isDark: boolean) => {
    if (isDark) {
      return '#000000';
    } else {
      if (theme === 'classic' || theme === 'rose' || theme === 'cobalt' || theme === 'green') {
        return '#FFFFFF';
      }
      return '#000000';
    }
  };

  // Calculate dynamic colors mapped from the mobile theme provider
  const isDark = themeMode === 'dark';
  const primaryColor = ACCENT_COLORS[accentTheme][isDark ? 'dark' : 'light'];
  const primaryForeground = getPrimaryForeground(accentTheme, isDark);

  const themeColors = isDark
    ? {
        background: '#18181B', // zinc-900
        foreground: '#FAFAFA',
        card: '#18181B',
        border: '#52525B', // zinc-600 (lighter, matches mobile contrast)
        muted: '#A1A1AA', // zinc-400
        primary: primaryColor,
        primaryForeground,
      }
    : {
        background: '#F4F4F5', // zinc-100
        foreground: '#09090B', // zinc-950
        card: '#F4F4F5',
        border: '#000000', // high-contrast retro black border
        muted: '#71717A', // zinc-500
        primary: primaryColor,
        primaryForeground,
      };

  const rootStyles = {
    '--color-background': themeColors.background,
    '--color-foreground': themeColors.foreground,
    '--color-card': themeColors.card,
    '--color-border': themeColors.border,
    '--color-muted': themeColors.muted,
    '--color-primary': themeColors.primary,
    '--color-primary-foreground': themeColors.primaryForeground,
    '--color-destructive': '#ef4444',
  } as React.CSSProperties;

  return (
    <div
      style={rootStyles}
      className="h-screen bg-background text-foreground flex flex-col font-mono antialiased overflow-hidden"
    >
      <TitleBar title="BootHub" />
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden min-h-0">
      {/* --- TOP NAV PANEL (covers the whole row) --- */}
      <nav className="shrink-0 select-none">
        <TuiContainer label="Nav" style={{ width: '100%' }}>
          <div className="flex items-center justify-between gap-6 py-1 select-none">
            {/* Logo / Brand & Theme Toggle */}
            <div className="flex items-center gap-4 shrink-0">
              <div className="flex items-center gap-3">
                <IconSvg className="w-8 h-8 text-primary shrink-0" />
                <div>
                  <h1 className="text-sm md:text-base font-bold tracking-widest text-primary leading-none">BootHub</h1>
                  <p className="text-[10px] text-muted leading-none mt-1">by BootlegYouki</p>
                </div>
              </div>
              <button
                onClick={() => handleSetThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
                className="w-9 h-9 flex items-center justify-center border-[1.5px] border-border hover:bg-primary/10 active:scale-95 cursor-pointer select-none shrink-0"
                title="Toggle Theme Mode"
              >
                {themeMode === 'dark' ? <Sun size={18} className="text-primary" /> : <Moon size={18} className="text-primary" />}
              </button>
            </div>

            {/* Search and New Folder */}
            <div className="flex-1 max-w-xl flex gap-4 items-center">
              <div className="flex-1 flex items-center border-[1.5px] border-border px-3 bg-card gap-2 h-9">
                <Search size={14} className="text-muted" />
                <input
                  type="text"
                  placeholder={`Search ${activeTab}s...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-xs py-1 focus:outline-hidden font-mono text-foreground"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="cursor-pointer">
                    <X size={12} className="text-muted hover:text-foreground" />
                  </button>
                )}
              </div>
              <button
                onClick={handleCreateFolder}
                className="border-[1.5px] border-primary text-primary px-4 h-9 flex items-center gap-2 hover:bg-primary/20 cursor-pointer text-xs font-bold active:scale-95 shrink-0"
              >
                <FolderPlus size={14} />
                <span>New Folder</span>
              </button>
            </div>
          </div>
        </TuiContainer>
      </nav>

      {/* --- LOWER CONTAINER (SIDEBAR + CONTENT STACK) --- */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* --- SIDEBAR --- */}
        <aside className="w-64 shrink-0 flex flex-col gap-4 min-h-0 select-none">
          {/* NAVIGATION TABS / LIBRARY */}
          <TuiContainer
            label="Library"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            contentStyle={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}
          >
            {(['link', 'text', 'photo', 'file'] as TabType[]).map((tab) => {
              const isActive = activeTab === tab;
              const iconMap = {
                link: <Link2 size={16} />,
                text: <FileText size={16} />,
                photo: <ImageIcon size={16} />,
                file: <Paperclip size={16} />,
              };
              return (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    setActiveFolderId(null);
                  }}
                  className={`w-full border-[1.5px] py-3 px-4 flex items-center gap-3 font-bold cursor-pointer text-xs select-none shrink-0 ${
                    isActive
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-border text-foreground hover:bg-primary/10 hover:border-primary'
                  }`}
                >
                  {iconMap[tab]}
                  <span className="capitalize">{tab}s</span>
                </button>
              );
            })}
          </TuiContainer>

          {/* CLOUD STATUS */}
          <div className="shrink-0">
            <TuiContainer
              label="Cloud Status"
              noPadding={false}
              style={{ height: '145px' }}
              contentStyle={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
            >
              {isSignedIn ? (
                <div className="flex flex-col gap-2 py-0.5">
                  <div className="flex items-center gap-2">
                    {userInfo?.picture ? (
                      <img
                        src={userInfo.picture}
                        alt="avatar"
                        className="w-7 h-7 border-[1.5px] border-primary"
                      />
                    ) : (
                      <div className="w-7 h-7 border-[1.5px] border-primary flex items-center justify-center font-bold text-xs text-primary bg-card">
                        {userInfo?.name?.charAt(0).toUpperCase() || 'U'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-sm truncate leading-tight">
                        {userInfo?.name || 'Google User'}
                      </h4>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <TuiButton
                      onPress={handleManualSync}
                      variant="accent"
                      disabled={syncStatus.isSyncing}
                      className="w-full !min-h-[32px] !py-1 text-xs"
                    >
                      {syncStatus.isSyncing ? 'Syncing...' : 'Sync Now'}
                    </TuiButton>
                    <TuiButton
                      onPress={handleDisconnect}
                      variant="destructive"
                      disabled={syncStatus.isSyncing || isAuthLoading}
                      className="w-full !min-h-[32px] !py-1 text-xs"
                    >
                      Disconnect
                    </TuiButton>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col justify-between h-full py-1">
                  <div className="flex-1 flex items-center justify-center px-2">
                    <p className="text-[11px] text-muted leading-normal text-center">
                      Offline. Sign-in to sync dumps.
                    </p>
                  </div>
                  <TuiButton
                    onPress={handleConnect}
                    loading={isAuthLoading}
                    variant="outline"
                    className="w-full !min-h-[32px] !py-1 text-xs mt-auto"
                  >
                    Connect Drive
                  </TuiButton>
                </div>
              )}
            </TuiContainer>
          </div>
        </aside>

        {/* --- RIGHT CONTENT STACK (MAIN + FOOTER) --- */}
        <div className="flex-1 flex flex-col gap-4 min-h-0 min-w-0">
          {/* MAIN WORKSPACE */}
          <main className="flex-1 min-h-0 min-w-0 flex flex-col">
            <TuiContainer
              label="Main"
              accentBorder={dragActive}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}
              contentStyle={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, padding: '12px' }}
            >
              {/* BREADCRUMB */}
              {activeFolderId && (
                <div className="mb-3 shrink-0 px-4">
                  <TuiContainer label="Path" noPadding={true}>
                    <div className="flex items-center gap-1.5 text-sm font-bold text-primary px-4 py-1.5">
                      <button
                        onClick={() => setActiveFolderId(null)}
                        className="hover:underline cursor-pointer text-primary"
                      >
                        Root
                      </button>
                      <span>/</span>
                      <span className="text-foreground">
                        {(() => {
                          const f = items.find((x) => x.id === activeFolderId);
                          return f ? getFolderName(f) : 'Folder';
                        })()}
                      </span>
                    </div>
                  </TuiContainer>
                </div>
              )}

              {/* WORKSPACE CONTENT CARD ENVELOPE / DRAG & DROP ZONE */}
              <div
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  const target = e.target as HTMLElement;
                  if (target.closest('.item-card') || target.closest('button') || target.closest('input') || target.closest('textarea')) {
                    return;
                  }
                  if (!e.ctrlKey && !e.shiftKey) {
                    setSelectedIds(new Set());
                  }
                  setDragBox({
                    active: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    currentX: e.clientX,
                    currentY: e.clientY,
                  });
                }}
                onMouseMove={(e) => {
                  if (!dragBox.active) return;
                  const currentX = e.clientX;
                  const currentY = e.clientY;
                  setDragBox(prev => ({ ...prev, currentX, currentY }));

                  const left = Math.min(dragBox.startX, currentX);
                  const top = Math.min(dragBox.startY, currentY);
                  const right = Math.max(dragBox.startX, currentX);
                  const bottom = Math.max(dragBox.startY, currentY);

                  const cardElements = document.querySelectorAll('.item-card');
                  const newSelected = new Set<string>();

                  cardElements.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    const id = el.getAttribute('data-id');
                    if (!id) return;
                    const intersect = !(
                      rect.right < left ||
                      rect.left > right ||
                      rect.bottom < top ||
                      rect.top > bottom
                    );
                    if (intersect) {
                      newSelected.add(id);
                    }
                  });
                  setSelectedIds(newSelected);
                }}
                onMouseUp={() => {
                  setDragBox(prev => ({ ...prev, active: false }));
                }}
                className="flex-1 flex flex-col p-4 min-h-0 min-w-0 overflow-y-auto"
              >
                <div className="flex-1 min-h-0">
                  {filteredList.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted text-sm select-none">
                      No {activeTab}s dumped yet.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-8">
                      {/* Folders Section */}
                      {folders.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {folders.map(renderCard)}
                        </div>
                      )}

                      {/* Items Section */}
                      {normalItems.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {normalItems.map(renderCard)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </TuiContainer>
          </main>

          {/* --- FOOTER INPUT CONSOLE --- */}
          <footer className="shrink-0 select-none">
            <TuiContainer
              label="Input Console"
              style={{ width: '100%', height: '110px' }}
              contentStyle={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
            >
              <div className="flex flex-col gap-3">
                <form onSubmit={handleSubmitItem} className="flex gap-4 w-full items-center">
                  <input
                    type="file"
                    id="attachment-input"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      if (e.target.files) {
                        await handleFileDrop(e.target.files);
                        e.target.value = '';
                      }
                    }}
                  />
                  <TuiButton
                    type="button"
                    onPress={() => document.getElementById('attachment-input')?.click()}
                    className="!w-auto px-4 !h-10 !min-h-[40px] flex items-center justify-center gap-2 shrink-0"
                    variant="outline"
                    title="Attach Photos/Files"
                  >
                    <Paperclip size={18} />
                    <span>File</span>
                  </TuiButton>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Enter link or text content here..."
                    className="flex-1 border-[1.5px] border-border bg-card px-4 text-xs focus:outline-hidden font-mono min-h-[40px] text-foreground"
                  />
                  <TuiButton onPress={handleSubmitItem} className="!w-auto px-6 !min-h-[40px]">
                    <Plus size={15} className="mr-1" />
                    <span>Add</span>
                  </TuiButton>
                </form>
                <p className="text-[9px] text-muted text-center leading-normal mt-0.5">
                  Tip: Drag & Drop files or Paste (Ctrl+V) directly anywhere on the active workspace page to save them!
                </p>
              </div>
            </TuiContainer>
          </footer>
        </div>
      </div>
      {/* SYNC CONFLICT MODAL */}
      <ConflictModal
        visible={conflictAlert.visible}
        title={conflictAlert.title}
        message={conflictAlert.message}
        options={conflictAlert.options}
      />

      {/* CUSTOM DIALOG ALERT/CONFIRM MODAL */}
      <TuiAlertModal
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        type={dialog.type}
        confirmText={dialog.confirmText}
        cancelText={dialog.cancelText}
        isDestructive={dialog.isDestructive}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />

      {/* CUSTOM FOLDER PROMPT MODAL */}
      {folderPrompt.visible && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 select-none animate-in fade-in duration-100">
          <div className="w-full max-w-sm">
            <TuiContainer label="New Folder">
              <div className="py-2 flex flex-col gap-4">
                <p className="text-xs text-muted mb-1 font-mono">Enter folder name:</p>
                <input
                  type="text"
                  value={folderPrompt.name}
                  onChange={(e) => setFolderPrompt({ ...folderPrompt, name: e.target.value })}
                  placeholder="Folder Name"
                  className="w-full border-[1.5px] border-border bg-card px-3 py-2 text-xs focus:outline-hidden font-mono text-foreground"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name = folderPrompt.name.trim();
                      setFolderPrompt({ ...folderPrompt, visible: false });
                      if (name) createFolderWithName(name);
                    } else if (e.key === 'Escape') {
                      setFolderPrompt({ ...folderPrompt, visible: false });
                    }
                  }}
                />
                <div className="flex gap-4">
                  <TuiButton
                    onPress={() => setFolderPrompt({ ...folderPrompt, visible: false })}
                    variant="outline"
                  >
                    Cancel
                  </TuiButton>
                  <TuiButton
                    onPress={async () => {
                      const name = folderPrompt.name.trim();
                      setFolderPrompt({ ...folderPrompt, visible: false });
                      if (name) {
                        await createFolderWithName(name);
                      }
                    }}
                    variant="accent"
                  >
                    Create
                  </TuiButton>
                </div>
              </div>
            </TuiContainer>
          </div>
        </div>
      )}

      {/* PHOTO PREVIEW OVERLAY MODAL */}
      {previewPhotoId && (
        <PhotoPreviewModal
          itemId={previewPhotoId}
          onClose={() => setPreviewPhotoId(null)}
        />
      )}

      {/* CUSTOM CONTEXT MENU */}
      {contextMenu.visible && contextMenu.item && (
        <div
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 99999,
          }}
          className="bg-card border-[1.5px] border-border py-1 min-w-[150px] font-mono animate-in fade-in zoom-in-95 duration-100 select-none animate-duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {selectedIds.size > 1 ? (
            <>
              <button
                onClick={() => {
                  const itemsToCopy = items.filter(x => selectedIds.has(x.id) && (x.type === 'text' || x.type === 'link'));
                  const concatenated = itemsToCopy.map(x => x.value).join('\n');
                  if (concatenated) {
                    handleCopyText(concatenated);
                  }
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
              >
                Copy Selected ({selectedIds.size})
              </button>
              <button
                onClick={async () => {
                  const itemsToCopy = items.filter(x => selectedIds.has(x.id) && (x.type === 'text' || x.type === 'link'));
                  const concatenated = itemsToCopy.map(x => x.value).join('\n');
                  if (concatenated) {
                    await navigator.clipboard.writeText(concatenated);
                  }
                  
                  const currentItems = await getItems();
                  const remaining = currentItems.filter(x => !selectedIds.has(x.id));
                  const deletedItems = currentItems.filter(x => selectedIds.has(x.id));
                  await saveItems(remaining);
                  setItems(remaining);
                  setSelectedIds(new Set());

                  for (const delItem of deletedItems) {
                    if (delItem.type === 'photo' || delItem.type === 'file') {
                      await deleteItemFile(delItem.id);
                    }
                    await enqueueSyncTask('DELETE', delItem.id, delItem.type, {
                      driveFileId: delItem.driveFileId,
                      driveMetaFileId: delItem.driveMetaFileId,
                    });
                  }
                  processSyncQueue();
                  showAlert('Success', `Cut ${selectedIds.size} items to clipboard!`);
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
              >
                Cut Selected ({selectedIds.size})
              </button>
              <button
                onClick={async () => {
                  const confirmed = await showConfirm(
                    'Confirm Deletion',
                    `Delete all ${selectedIds.size} selected items?`,
                    { confirmText: 'Delete All', isDestructive: true }
                  );
                  if (confirmed) {
                    const currentItems = await getItems();
                    const remaining = currentItems.filter(x => !selectedIds.has(x.id));
                    const deletedItems = currentItems.filter(x => selectedIds.has(x.id));
                    await saveItems(remaining);
                    setItems(remaining);
                    setSelectedIds(new Set());

                    for (const delItem of deletedItems) {
                      if (delItem.type === 'photo' || delItem.type === 'file') {
                        await deleteItemFile(delItem.id);
                      }
                      await enqueueSyncTask('DELETE', delItem.id, delItem.type, {
                        driveFileId: delItem.driveFileId,
                        driveMetaFileId: delItem.driveMetaFileId,
                      });
                    }
                    processSyncQueue();
                  }
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive hover:text-white cursor-pointer transition-colors"
              >
                Delete Selected ({selectedIds.size})
              </button>
            </>
          ) : (
            <>
              {/* Copy option */}
              <button
                onClick={() => {
                  handleCopyItem(contextMenu.item!);
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
              >
                Copy
              </button>

              {/* Cut option */}
              <button
                onClick={() => {
                  handleCutItem(contextMenu.item!);
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
              >
                Cut
              </button>

              {/* Download option (for photos/files) */}
              {(contextMenu.item.type === 'photo' || contextMenu.item.type === 'file') && (
                <button
                  onClick={() => {
                    handleDownloadFile(contextMenu.item!);
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
                >
                  Download File
                </button>
              )}

              {/* Edit option */}
              <button
                onClick={() => {
                  setEditPrompt({
                    visible: true,
                    itemId: contextMenu.item!.id,
                    label: contextMenu.item!.label,
                    value: contextMenu.item!.value,
                    type: contextMenu.item!.type,
                  });
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
              >
                Edit
              </button>

              {/* Delete option */}
              <button
                onClick={() => {
                  handleDeleteItem(contextMenu.item!);
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive hover:text-white cursor-pointer transition-colors"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* DRAG SELECTION BOUNDING BOX */}
      {dragBox.active && (
        <div
          style={{
            position: 'fixed',
            left: `${Math.min(dragBox.startX, dragBox.currentX)}px`,
            top: `${Math.min(dragBox.startY, dragBox.currentY)}px`,
            width: `${Math.abs(dragBox.startX - dragBox.currentX)}px`,
            height: `${Math.abs(dragBox.startY - dragBox.currentY)}px`,
            zIndex: 999999,
          }}
          className="border-[1.5px] border-primary bg-primary/10 pointer-events-none"
        />
      )}

      {/* CUSTOM EDIT PROMPT MODAL */}
      {editPrompt.visible && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 select-none animate-in fade-in duration-100">
          <div className="w-full max-w-sm">
            <TuiContainer label={`Edit ${editPrompt.type}`}>
              <div className="py-2 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-muted">Label / Date</label>
                  <input
                    type="text"
                    value={editPrompt.label}
                    onChange={(e) => setEditPrompt({ ...editPrompt, label: e.target.value })}
                    className="w-full border-[1.5px] border-border bg-card px-3 py-2 text-xs focus:outline-hidden font-mono text-foreground"
                  />
                </div>

                {(editPrompt.type === 'text' || editPrompt.type === 'link') && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-bold text-muted">Value / Content</label>
                    <textarea
                      value={editPrompt.value}
                      onChange={(e) => setEditPrompt({ ...editPrompt, value: e.target.value })}
                      rows={4}
                      className="w-full border-[1.5px] border-border bg-card px-3 py-2 text-xs focus:outline-hidden font-mono text-foreground resize-none"
                    />
                  </div>
                )}

                <div className="flex gap-4 mt-2">
                  <TuiButton
                    onPress={() => setEditPrompt({ ...editPrompt, visible: false })}
                    variant="outline"
                  >
                    Cancel
                  </TuiButton>
                  <TuiButton
                    onPress={handleSaveEdit}
                    variant="accent"
                  >
                    Save
                  </TuiButton>
                </div>
              </div>
            </TuiContainer>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
