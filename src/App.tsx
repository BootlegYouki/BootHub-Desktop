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
import { openUrl } from '@tauri-apps/plugin-opener';
import { check } from '@tauri-apps/plugin-updater';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
      <div className="w-full h-full aspect-video bg-card flex items-center justify-center select-none">
        <span className="text-[10px] text-muted font-bold animate-pulse">[ Loading... ]</span>
      </div>
    );
  }

  if (!imgUrl) {
    return (
      <div className="w-full h-full aspect-video bg-black flex items-center justify-center select-none">
        <ImageIcon size={24} className="text-zinc-700" />
      </div>
    );
  }

  return (
    <div className="w-full h-full aspect-video bg-black flex items-center justify-center overflow-hidden select-none">
      <img
        src={imgUrl}
        alt="thumbnail"
        className="w-full h-full object-cover"
      />
    </div>
  );
};

interface ImagePreviewProps {
  file: File;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ file }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!url) return null;
  return <img src={url} alt="preview" className="w-full h-full object-cover" />;
};

interface PhotoPreviewModalProps {
  item: DumpItem;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent, item: DumpItem) => void;
  isContextMenuVisible: boolean;
}

const PhotoPreviewModal: React.FC<PhotoPreviewModalProps> = ({ item, onClose, onContextMenu, isContextMenuVisible }) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const loadImg = async () => {
      try {
        const blob = await getItemFile(item.id);
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
  }, [item.id]);

  return (
    <div
      onClick={() => {
        if (!isContextMenuVisible) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-4 select-none animate-in fade-in duration-150"
    >
      {loading ? (
        <span className="text-sm text-muted font-bold animate-pulse font-mono">[ Loading Image... ]</span>
      ) : imgUrl ? (
        <img
          src={imgUrl}
          alt="preview"
          className="max-w-[80vw] max-h-[80vh] object-contain select-none shadow-2xl animate-in zoom-in-95 duration-150"
          onContextMenu={(e) => onContextMenu(e, item)}
        />
      ) : (
        <span className="text-sm text-destructive font-bold font-mono bg-[#18181b] border-[1.5px] border-border p-4 shadow-xl">
          Failed to load preview image.
        </span>
      )}
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

  // Show window with a slight delay so assets can load
  useEffect(() => {
    const timer = setTimeout(() => {
      getCurrentWindow().show().catch((err) => {
        console.error('Failed to show window:', err);
      });
    }, 150); // 150ms delay for assets/DOM to load smoothly
    return () => clearTimeout(timer);
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
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [inputText]);

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitItem();
    }
  };

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
      handleDirectAddFiles(e.dataTransfer.files);
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
    onConfirm: () => { },
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
  const [clipboard, setClipboard] = useState<{
    type: 'copy' | 'cut';
    itemIds: Set<string>;
  } | null>(null);

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

  // Listen to Tray Sync trigger from Rust
  useEffect(() => {
    const setupTraySyncListener = async () => {
      const unlisten = await listen('tray-sync', () => {
        pullChangesFromDrive().catch((err) => console.error(err));
      });
      return unlisten;
    };
    const unlistenPromise = setupTraySyncListener();
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
    const trimmedText = inputText.trim();
    if (!trimmedText && attachedFiles.length === 0) return;

    const newItemsList: DumpItem[] = [];
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`;

    // 1. Process text input if present
    if (trimmedText) {
      const isUrl = /^https?:\/\//i.test(trimmedText) || /^(https?:\/\/)?((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,6}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)(:\d+)?(\/.*)?$/i.test(trimmedText);
      const type = isUrl ? 'link' : 'text';
      const textId = `${Date.now()}_text_${Math.random().toString(36).substring(2, 5)}`;

      const newTextItem: DumpItem = {
        id: textId,
        type,
        label,
        value: trimmedText,
        syncState: 'pending',
        folderId: activeFolderId || undefined,
      };

      await addItem(newTextItem);
      newItemsList.push(newTextItem);
      setInputText('');
    }

    // 2. Process attached files if present
    if (attachedFiles.length > 0) {
      for (let i = 0; i < attachedFiles.length; i++) {
        const file = attachedFiles[i];
        const fileId = `${Date.now()}_file_${i}_${Math.random().toString(36).substring(2, 5)}`;
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

        const newFileItem: DumpItem = {
          id: fileId,
          type,
          label,
          value,
          syncState: 'pending',
          folderId: activeFolderId || undefined,
        };

        await saveItemFile(fileId, file);
        await addItem(newFileItem);
        newItemsList.push(newFileItem);
      }
      setAttachedFiles([]);
    }


    // Enqueue sync tasks for all new items
    if (newItemsList.length > 0) {
      const firstItem = newItemsList[0];
      if (firstItem.type !== 'folder') {
        setActiveTab(firstItem.type);
      }

      await enqueueSyncTasks(
        newItemsList.map((item) => ({
          action: 'UPLOAD',
          itemId: item.id,
          itemType: item.type,
        }))
      );
      processSyncQueue();
    }
  };

  const handleDirectAddFiles = async (files: FileList | File[]) => {
    if (files.length === 0) return;

    const newItemsList: DumpItem[] = [];
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileId = `${Date.now()}_file_${i}_${Math.random().toString(36).substring(2, 5)}`;
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

      const newFileItem: DumpItem = {
        id: fileId,
        type,
        label,
        value,
        syncState: 'pending',
        folderId: activeFolderId || undefined,
      };

      await saveItemFile(fileId, file);
      await addItem(newFileItem);
      newItemsList.push(newFileItem);
    }

    if (newItemsList.length > 0) {
      const firstItem = newItemsList[0];
      if (firstItem.type !== 'folder') {
        setActiveTab(firstItem.type);
      }

      await enqueueSyncTasks(
        newItemsList.map((item) => ({
          action: 'UPLOAD',
          itemId: item.id,
          itemType: item.type,
        }))
      );
      processSyncQueue();
    }
  };

  const handleInputPaste = (e: React.ClipboardEvent) => {
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
      e.preventDefault();
      setAttachedFiles((prev) => [...prev, ...files]);
    }
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

  const convertImageBlobToPng = (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(url);
          if (pngBlob) {
            resolve(pngBlob);
          } else {
            reject(new Error('Failed to convert canvas to blob'));
          }
        }, 'image/png');
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  };

  const handleCopyItem = async (item: DumpItem) => {
    try {
      if (item.type === 'text' || item.type === 'link') {
        await navigator.clipboard.writeText(item.value);
      } else if (item.type === 'photo') {
        const blob = await getItemFile(item.id);
        if (blob) {
          try {
            const pngBlob = await convertImageBlobToPng(blob);
            await navigator.clipboard.write([
              new ClipboardItem({
                'image/png': pngBlob
              })
            ]);
          } catch (e) {
            await navigator.clipboard.writeText(item.value);
          }
        } else {
          await navigator.clipboard.writeText(item.value);
        }
      } else {
        let name = item.value;
        try {
          const parsed = JSON.parse(item.value);
          name = parsed.name || item.value;
        } catch (_) { }
        await navigator.clipboard.writeText(name);
      }
    } catch (err) {
      console.error('Copy failed:', err);
      showAlert('Error', 'Failed to copy to clipboard.');
    }
  };

  const handleCutItem = async (item: DumpItem) => {
    await handleCopyItem(item);
    setClipboard({
      type: 'cut',
      itemIds: new Set([item.id]),
    });
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

  const handleCopySelected = () => {
    if (selectedIds.size === 0) return;
    setClipboard({
      type: 'copy',
      itemIds: new Set(selectedIds),
    });
  };

  const handleCutSelected = () => {
    if (selectedIds.size === 0) return;
    setClipboard({
      type: 'cut',
      itemIds: new Set(selectedIds),
    });
  };

  const handlePasteSelected = async () => {
    if (!clipboard || clipboard.itemIds.size === 0) return;

    const allItems = await getItems();
    const itemsToProcess = allItems.filter(item => clipboard.itemIds.has(item.id));

    const hasSelectedAncestor = (item: DumpItem, selectedSet: Set<string>, list: DumpItem[]): boolean => {
      let current = item;
      while (current.folderId) {
        const parentId = current.folderId;
        if (selectedSet.has(parentId)) return true;
        const parent = list.find(x => x.id === parentId);
        if (!parent) break;
        current = parent;
      }
      return false;
    };

    const topLevelItems = itemsToProcess.filter(
      (item) => !hasSelectedAncestor(item, clipboard.itemIds, allItems)
    );

    if (clipboard.type === 'cut') {
      const updatedList = allItems.map(item => {
        const isTopLevelCut = topLevelItems.some(x => x.id === item.id);
        if (isTopLevelCut) {
          return {
            ...item,
            folderId: activeFolderId || undefined,
            syncState: 'pending' as const,
          };
        }
        return item;
      });

      await saveItems(updatedList);
      setItems(updatedList);

      for (const item of topLevelItems) {
        await enqueueSyncTask('UPDATE', item.id, item.type);
      }
      processSyncQueue();
      setClipboard(null);
      setSelectedIds(new Set());
    } else if (clipboard.type === 'copy') {
      const copiedIds: string[] = [];

      const copyItemTree = async (
        item: DumpItem,
        newParentId: string | undefined,
        list: DumpItem[]
      ) => {
        const newId = item.type === 'folder'
          ? `folder_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
          : `${Date.now()}_${item.type}_${Math.random().toString(36).substring(2, 7)}`;

        if (item.type === 'photo' || item.type === 'file') {
          const blob = await getItemFile(item.id);
          if (blob) {
            await saveItemFile(newId, blob);
          }
        }

        let newLabel = item.label;
        let newValue = item.value;
        if (item.folderId === newParentId) {
          if (item.type === 'folder') {
            try {
              const parsed = JSON.parse(item.value);
              parsed.name = `Copy of ${parsed.name}`;
              newLabel = parsed.name;
              newValue = JSON.stringify(parsed);
            } catch { }
          } else {
            newLabel = `Copy of ${item.label}`;
          }
        }

        const copiedItem: DumpItem = {
          ...item,
          id: newId,
          label: newLabel,
          value: newValue,
          folderId: newParentId,
          driveFileId: undefined,
          driveMetaFileId: undefined,
          syncState: 'pending',
        };

        await addItem(copiedItem);
        copiedIds.push(newId);

        if (item.type === 'folder') {
          const children = list.filter(x => x.folderId === item.id);
          for (const child of children) {
            await copyItemTree(child, newId, list);
          }
        }
      };

      for (const item of topLevelItems) {
        await copyItemTree(item, activeFolderId || undefined, allItems);
      }

      const freshItems = await getItems();
      setItems(freshItems);

      if (copiedIds.length > 0) {
        const tasks = copiedIds.map(id => {
          const item = freshItems.find(x => x.id === id);
          return {
            action: 'UPLOAD' as const,
            itemId: id,
            itemType: item ? item.type : 'text' as any,
          };
        });
        await enqueueSyncTasks(tasks);
        processSyncQueue();
      }

      setClipboard(null);
      setSelectedIds(new Set());
    }
  };

  // Keyboard shortcut Ctrl+A and Delete/Del listener, and copy/cut/paste key handlers
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
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopySelected();
        if (selectedIds.size === 1) {
          const singleItemId = Array.from(selectedIds)[0];
          const item = items.find(x => x.id === singleItemId);
          if (item) {
            handleCopyItem(item);
          }
        } else if (selectedIds.size > 1) {
          const itemsToCopy = items.filter(x => selectedIds.has(x.id) && (x.type === 'text' || x.type === 'link'));
          const concatenated = itemsToCopy.map(x => x.value).join('\n');
          if (concatenated) {
            handleCopyText(concatenated);
          }
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleCutSelected();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePasteSelected();
      } else if (e.key === 'Enter' && selectedIds.size === 1) {
        e.preventDefault();
        const singleItemId = Array.from(selectedIds)[0];
        const item = items.find(x => x.id === singleItemId);
        if (item) {
          if (item.type === 'folder') {
            setActiveFolderId(item.id);
          } else if (item.type === 'photo') {
            setPreviewPhotoId(item.id);
          } else if (item.type === 'link') {
            const url = item.value.startsWith('http') ? item.value : `https://${item.value}`;
            openUrl(url).catch((err) => console.error('Failed to open URL:', err));
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredList, selectedIds, clipboard, activeFolderId, items]);

  const renderCard = (item: DumpItem) => {
    const isSyncing = item.syncState === 'syncing';
    const progress = uploadProgress[item.id] || 0;
    const isSelected = selectedIds.has(item.id);
    const isCut = clipboard?.type === 'cut' && clipboard.itemIds.has(item.id);

    return (
      <div
        key={item.id}
        data-id={item.id}
        className={`item-card relative animate-in fade-in duration-200 select-none transition-all ${isSelected ? 'bg-primary/5' : ''
          } ${isCut ? 'opacity-40 border-dashed border-primary/50' : ''}`}
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
          const isAlreadySelected = selectedIds.has(item.id) && selectedIds.size === 1;

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

          if (isAlreadySelected) {
            if (item.type === 'folder') {
              setActiveFolderId(item.id);
            } else if (item.type === 'photo') {
              setPreviewPhotoId(item.id);
            }
          }

          if (item.type === 'link') {
            const url = item.value.startsWith('http') ? item.value : `https://${item.value}`;
            openUrl(url).catch((err) => console.error('Failed to open URL:', err));
          }
        }}
        onDoubleClick={(e) => {
          if (item.type === 'folder') {
            e.stopPropagation();
            setActiveFolderId(item.id);
          } else if (item.type === 'photo') {
            e.stopPropagation();
            setPreviewPhotoId(item.id);
          }
        }}
      >
        {item.type === 'photo' ? (
          <div
            className={`w-full h-full relative border-[1.5px] bg-card transition-all ${isSelected
                ? 'border-primary shadow-[0_0_8px_rgba(168,85,247,0.3)]'
                : 'border-border hover:border-foreground'
              }`}
            title="Double click to view full preview"
          >
            {/* Sync Progress Bar */}
            {isSyncing && (
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary/20 z-20">
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            )}
            <PhotoThumbnail itemId={item.id} />
          </div>
        ) : (
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
                <div
                  className="flex items-center gap-3 text-left w-full hover:text-primary group"
                >
                  <Folder size={16} className="text-primary fill-primary/10 group-hover:scale-110 transition-transform duration-150" />
                  <span className="font-bold text-sm leading-tight">{getFolderName(item)}</span>
                </div>
              ) : item.type === 'link' ? (
                <div className="flex flex-col gap-1">
                  <a
                    href={item.value.startsWith('http') ? item.value : `https://${item.value}`}
                    onClick={(e) => {
                      e.preventDefault();
                    }}
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
        )}
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
      border: '#D4D4D8', // zinc-300 border
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
                    className={`w-full border-[1.5px] py-3 px-4 flex items-center gap-3 font-bold cursor-pointer text-xs select-none shrink-0 ${isActive
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
                  className={`flex-1 flex flex-col p-4 min-h-0 min-w-0 ${contextMenu.visible ? 'overflow-hidden' : 'overflow-y-auto'}`}
                >
                  {/* BREADCRUMB */}
                  {activeFolderId && (
                    <div className="mb-4 shrink-0">
                      <TuiContainer label="Path" noPadding={true}>
                        <div className="flex items-center gap-1.5 text-sm font-bold text-primary px-3 py-[11px]">
                          <button
                            onClick={() => setActiveFolderId(null)}
                            className="hover:underline cursor-pointer text-primary"
                          >
                            Root
                          </button>
                          <span>&gt;</span>
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

            <footer className="shrink-0 select-none">
              <TuiContainer
                label="Input Console"
                style={{ width: '100%' }}
                contentStyle={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
              >
                <div className="flex flex-col gap-3">
                  <form onSubmit={handleSubmitItem} className="flex gap-4 w-full items-end">
                    <input
                      type="file"
                      id="attachment-input"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) {
                          handleDirectAddFiles(e.target.files);
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

                    {/* Combined Staged File List + Input Wrapper */}
                    <div className={`flex-1 flex flex-col border-[1.5px] border-border bg-card px-3 gap-3 min-h-[40px] justify-center ${attachedFiles.length > 0 ? 'py-2.25' : 'py-2'}`}>
                      {/* Attachment Previews */}
                      {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-4 border-b border-border/30 pb-3">
                          {attachedFiles.map((file, index) => {
                            const isImage = file.type.startsWith('image/');
                            return (
                              <div key={index} className="relative border-[1.5px] border-border w-32 h-32 flex items-center justify-center bg-[#18181b] select-none">
                                {isImage ? (
                                  <ImagePreview file={file} />
                                ) : (
                                  <div className="flex flex-col items-center gap-1.5 px-2 text-center min-w-0">
                                    <span className="text-xs text-muted font-bold font-mono">
                                      [ {file.name.split('.').pop()?.toUpperCase() || 'FILE'} ]
                                    </span>
                                    <span className="text-[9px] text-muted/60 truncate max-w-full font-mono">
                                      {file.name}
                                    </span>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
                                  }}
                                  className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 cursor-pointer focus:outline-hidden"
                                  title="Remove Attachment"
                                >
                                  <X size={24} className="text-white hover:scale-110 transition-transform duration-100" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <textarea
                        ref={textareaRef}
                        rows={1}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleTextareaKeyDown}
                        onPaste={handleInputPaste}
                        placeholder="Enter link or text content here..."
                        className="w-full bg-transparent text-xs focus:outline-hidden font-mono text-foreground p-0.5 resize-none overflow-y-hidden"
                        style={{ height: 'auto', minHeight: '20px' }}
                      />
                    </div>

                    <TuiButton onPress={handleSubmitItem} className="!w-auto px-6 !h-10 !min-h-[40px]">
                      <Plus size={15} className="mr-1" />
                      <span>Add</span>
                    </TuiButton>
                  </form>
                  <p className="text-[9px] text-muted text-center leading-normal mt-0.5">
                    Tip: Drag & Drop files or Paste (Ctrl+V) directly inside the input console text box to stage attachments!
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
              <TuiContainer label="New Folder" disableHover={true}>
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
            item={items.find(x => x.id === previewPhotoId)!}
            onClose={() => setPreviewPhotoId(null)}
            isContextMenuVisible={contextMenu.visible}
            onContextMenu={(e, item) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                item,
              });
            }}
          />
        )}

        {/* CUSTOM CONTEXT MENU */}
        {contextMenu.visible && (
          <div
            className="fixed inset-0 z-[99998] bg-transparent cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          />
        )}
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
                    handleCutSelected();
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
                  Move
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
              <TuiContainer label={`Edit ${editPrompt.type}`} disableHover={true}>
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
