import { getGoogleUserInfo } from './google-drive';
import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  getItems,
  saveItems,
  getSyncQueue,
  saveSyncQueue,
  getItemFile,
  saveItemFile,
  deleteItemFile,
  getSetting,
  saveSetting,
  DumpItem,
  SyncTask,
} from './db';

let realtimeChannel: RealtimeChannel | null = null;
let realtimeActiveEmail: string | null = null;

export const initializeRealtimeSync = async (): Promise<void> => {
  try {
    const userInfo = await getGoogleUserInfo();
    if (!userInfo || !userInfo.email) {
      closeRealtimeSync();
      return;
    }

    const email = userInfo.email.trim().toLowerCase();
    if (realtimeChannel && realtimeActiveEmail === email) {
      return;
    }

    if (realtimeChannel) {
      closeRealtimeSync();
    }

    realtimeActiveEmail = email;
    console.log('[Realtime Sync] Subscribing to Supabase changes for', email);

    realtimeChannel = supabase
      .channel(`public:items:email=eq.${email}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'items',
          filter: `email=eq.${email}`,
        },
        async (payload) => {
          console.log('[Realtime Sync] Received realtime change:', payload.eventType);
          pullChangesFromDrive().catch((err) => {
            console.error('[Realtime Sync] Pull failed:', err);
          });
        }
      )
      .subscribe((status) => {
        console.log('[Realtime Sync] Subscription status:', status);
      });
  } catch (err) {
    console.error('[Realtime Sync] Failed to initialize:', err);
  }
};

export const closeRealtimeSync = (): void => {
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }
  realtimeActiveEmail = null;
  console.log('[Realtime Sync] Closed connection.');
};

export const notifyRemoteDevicesOfChange = async (): Promise<void> => {
  // No-op since Supabase Postgres changes automatically notify all subscribers in real-time
};

const LAST_SYNC_KEY = '@boothub_last_sync_time';

export interface SyncStatus {
  isSyncing: boolean;
  error: string | null;
  lastSynced: string | null;
}

let syncStatusListeners: ((status: SyncStatus) => void)[] = [];
let currentSyncStatus: SyncStatus = {
  isSyncing: false,
  error: null,
  lastSynced: null,
};

// Load initial last synced time on load
getSetting<string>(LAST_SYNC_KEY).then((val) => {
  if (val) {
    currentSyncStatus.lastSynced = val;
    notifyListeners();
  }
});

function notifyListeners() {
  syncStatusListeners.forEach((l) => l({ ...currentSyncStatus }));
}

export const subscribeToSyncStatus = (listener: (status: SyncStatus) => void) => {
  syncStatusListeners.push(listener);
  listener({ ...currentSyncStatus }); // Emit current state immediately
  return () => {
    syncStatusListeners = syncStatusListeners.filter((l) => l !== listener);
  };
};

export const clearSyncError = () => {
  updateSyncStatus({ error: null });
};

export const updateSyncStatus = (updates: Partial<SyncStatus>) => {
  currentSyncStatus = { ...currentSyncStatus, ...updates };
  if (updates.lastSynced) {
    saveSetting(LAST_SYNC_KEY, updates.lastSynced).catch(() => {});
  }
  notifyListeners();
};

export interface EnqueueTaskInput {
  action: 'UPLOAD' | 'DELETE' | 'UPDATE';
  itemId: string;
  itemType: DumpItem['type'];
  extras?: Partial<SyncTask>;
}

// Registry of active in-flight request controllers, keyed by task.itemId
const activeSyncTasks = new Map<string, { abort: () => void }>();

// Promise chain lock to prevent IndexedDB write-collision race conditions on the queue
let queueLockPromise: Promise<any> = Promise.resolve();

const runLockedQueueOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  const nextPromise = queueLockPromise.then(async () => {
    return await operation();
  });
  queueLockPromise = nextPromise.catch(() => {});
  return nextPromise;
};

export type ProgressListener = (itemId: string, progress: number) => void;
let progressListeners: ProgressListener[] = [];

export const subscribeToUploadProgress = (listener: ProgressListener) => {
  progressListeners.push(listener);
  return () => {
    progressListeners = progressListeners.filter((l) => l !== listener);
  };
};

export const enqueueSyncTasks = async (tasks: EnqueueTaskInput[]): Promise<void> => {
  if (tasks.length === 0) return;

  await runLockedQueueOperation(async () => {
    const queue = await getSyncQueue();
    let updatedQueue = [...queue];
    let counter = 0;

    for (const taskInput of tasks) {
      const { action, itemId, itemType, extras } = taskInput;
      const uniqueId = `${Date.now()}_${counter++}_${Math.random().toString(36).substring(2, 7)}`;

      if (action === 'DELETE') {
        const activeTask = activeSyncTasks.get(itemId);
        if (activeTask) {
          try {
            activeTask.abort();
          } catch {}
          activeSyncTasks.delete(itemId);
        }

        updatedQueue = updatedQueue.filter((t) => t.itemId !== itemId);
        const newTask: SyncTask = {
          id: uniqueId,
          action,
          itemId,
          itemType,
        };
        updatedQueue.push(newTask);
      } else if (action === 'UPDATE') {
        const hasPendingUpload = updatedQueue.some((t) => t.itemId === itemId && t.action === 'UPLOAD');
        if (hasPendingUpload) {
          continue;
        }
        updatedQueue = updatedQueue.filter((t) => !(t.itemId === itemId && t.action === 'UPDATE'));
        const newTask: SyncTask = {
          id: uniqueId,
          action,
          itemId,
          itemType,
        };
        updatedQueue.push(newTask);
      } else {
        const newTask: SyncTask = {
          id: uniqueId,
          action,
          itemId,
          itemType,
          fileUri: extras?.fileUri,
        };
        updatedQueue.push(newTask);
      }
    }

    await saveSyncQueue(updatedQueue);
  });
};

export const enqueueSyncTask = async (
  action: 'UPLOAD' | 'DELETE' | 'UPDATE',
  itemId: string,
  itemType: DumpItem['type'],
  extras?: Partial<SyncTask>
): Promise<void> => {
  await enqueueSyncTasks([{ action, itemId, itemType, extras }]);
};

export const enqueueUnsyncedLocalItems = async (): Promise<void> => {
  const userInfo = await getGoogleUserInfo();
  if (!userInfo || !userInfo.email) return;

  await runLockedQueueOperation(async () => {
    const items = await getItems();
    const queue = await getSyncQueue();

    const unsyncedItems = items.filter((item) => {
      const isLegacyDriveItem = item.syncState === 'synced' && (!item.driveFileId || !item.driveFileId.includes('/'));
      const needsSync = item.syncState !== 'synced' || isLegacyDriveItem;
      const isAlreadyQueued = queue.some((t) => t.itemId === item.id && (t.action === 'UPLOAD' || t.action === 'UPDATE'));
      return needsSync && !isAlreadyQueued;
    });

    if (unsyncedItems.length === 0) return;

    const updatedItems = items.map((item) => {
      const isUnsynced = unsyncedItems.some((u) => u.id === item.id);
      if (isUnsynced) {
        return { ...item, syncState: 'pending' as const };
      }
      return item;
    });
    await saveItems(updatedItems);

    const tasksToEnqueue = unsyncedItems.map((item) => ({
      action: 'UPLOAD' as const,
      itemId: item.id,
      itemType: item.type,
      extras: { fileUri: item.type === 'photo' || item.type === 'file' ? item.value : undefined },
    }));

    let updatedQueue = [...queue];
    let counter = 0;
    for (const taskInput of tasksToEnqueue) {
      const uniqueId = `${Date.now()}_${counter++}_${Math.random().toString(36).substring(2, 7)}`;
      updatedQueue.push({
        id: uniqueId,
        action: taskInput.action,
        itemId: taskInput.itemId,
        itemType: taskInput.itemType,
        fileUri: taskInput.extras?.fileUri,
      });
    }

    await saveSyncQueue(updatedQueue);
  });
};

// Conflict resolver stub for compatibility
let conflictResolver: any = null;
export const setConflictResolver = (resolver: any) => {
  conflictResolver = resolver;
  if (conflictResolver) {
    // Reference it to avoid unused warning
    void conflictResolver;
  }
};

let isProcessingQueue = false;

export const processSyncQueue = async (): Promise<void> => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  updateSyncStatus({ isSyncing: true, error: null });

  try {
    const userInfo = await getGoogleUserInfo();
    if (!userInfo || !userInfo.email) {
      updateSyncStatus({ isSyncing: false, error: 'Sign-in required to synchronize.' });
      isProcessingQueue = false;
      return;
    }

    const email = userInfo.email.trim().toLowerCase();

    while (true) {
      const queue = await getSyncQueue();
      if (queue.length === 0) {
        break;
      }

      for (const task of [...queue]) {
        let isAborted = false;
        activeSyncTasks.set(task.itemId, { abort: () => { isAborted = true; } });

        try {
          const localItems = await getItems();
          const localItem = localItems.find((item) => item.id === task.itemId);

          if (!localItem && task.action !== 'DELETE') {
            await dequeueTask(task.id);
            continue;
          }

          if (task.action === 'UPLOAD' || task.action === 'UPDATE') {
            if (!localItem) continue;

            let storagePath = localItem.driveFileId || '';

            if ((localItem.type === 'photo' || localItem.type === 'file') && !storagePath) {
              const fileBlob = await getItemFile(localItem.id);
              if (!fileBlob) {
                throw new Error(`Local file binary not found for item: ${localItem.id}`);
              }

              if (isAborted) throw new Error('Aborted');

              const path = `${email}/${localItem.id}`;
              const { error: uploadErr } = await supabase.storage
                .from('files')
                .upload(path, fileBlob, {
                  contentType: fileBlob.type || 'application/octet-stream',
                  upsert: true,
                });

              if (uploadErr) {
                throw new Error(`Storage upload failed: ${uploadErr.message}`);
              }

              storagePath = path;
            }

            if (isAborted) throw new Error('Aborted');

            const { error: upsertErr } = await supabase
              .from('items')
              .upsert({
                id: localItem.id,
                email,
                type: localItem.type,
                label: localItem.label,
                value: localItem.value,
                folder_id: localItem.folderId || null,
                storage_path: storagePath || null,
                updated_at: new Date().toISOString(),
              });

            if (upsertErr) {
              throw new Error(`Database upsert failed: ${upsertErr.message}`);
            }

            const latestItems = await getItems();
            const updatedLocalList = latestItems.map((item) => {
              if (item.id === localItem.id) {
                return {
                  ...item,
                  syncState: 'synced' as const,
                  driveFileId: storagePath,
                };
              }
              return item;
            });
            await saveItems(updatedLocalList);

          } else if (task.action === 'DELETE') {
            const { error: deleteDbErr } = await supabase
              .from('items')
              .delete()
              .eq('id', task.itemId)
              .eq('email', email);

            if (deleteDbErr) {
              throw new Error(`Database delete failed: ${deleteDbErr.message}`);
            }

            const path = `${email}/${task.itemId}`;
            await supabase.storage.from('files').remove([path]);
          }

          await dequeueTask(task.id);
        } catch (err: any) {
          if (err.message === 'Aborted') {
            console.log(`[Sync Engine] Task ${task.id} was aborted.`);
            await dequeueTask(task.id);
            continue;
          }
          console.error('[Sync Engine] Error syncing task:', err);
          updateSyncStatus({ isSyncing: false, error: 'Sync error: ' + err.message });
          isProcessingQueue = false;
          return;
        } finally {
          activeSyncTasks.delete(task.itemId);
        }
      }
    }

    const lastSyncedLabel = new Date().toLocaleString();
    updateSyncStatus({ isSyncing: false, error: null, lastSynced: lastSyncedLabel });
  } catch (err: any) {
    console.error('[Sync Engine] Queue processor error:', err);
    updateSyncStatus({ isSyncing: false, error: 'Sync processor failed: ' + err.message });
  } finally {
    isProcessingQueue = false;
  }
};

const dequeueTask = async (taskId: string) => {
  await runLockedQueueOperation(async () => {
    const queue = await getSyncQueue();
    const filtered = queue.filter((t) => t.id !== taskId);
    await saveSyncQueue(filtered);
  });
};

export const pullChangesFromDrive = async (): Promise<void> => {
  const userInfo = await getGoogleUserInfo();
  if (!userInfo || !userInfo.email) {
    console.warn('Cannot pull changes: User not signed in.');
    return;
  }

  const email = userInfo.email.trim().toLowerCase();

  try {
    const { data: remoteItems, error } = await supabase
      .from('items')
      .select('*')
      .eq('email', email);

    if (error) {
      throw new Error(error.message);
    }

    const localItems = await getItems();
    const remoteItemIds = new Set((remoteItems || []).map((x) => x.id));

    const itemsDeletedRemotely = localItems.filter((item) => {
      const isSupabaseSynced = item.syncState === 'synced' && item.driveFileId && item.driveFileId.includes('/');
      return isSupabaseSynced && !remoteItemIds.has(item.id);
    });

    const updatedLocalItems: DumpItem[] = [];

    // Delete locally if deleted on remote
    for (const localItem of localItems) {
      const isDeletedRemotely = itemsDeletedRemotely.some((x) => x.id === localItem.id);
      if (isDeletedRemotely) {
        if (localItem.type === 'photo' || localItem.type === 'file') {
          await deleteItemFile(localItem.id).catch(() => {});
        }
        continue;
      }
      updatedLocalItems.push(localItem);
    }

    // Add or update local records from remote
    for (const remote of remoteItems || []) {
      const localIndex = updatedLocalItems.findIndex((x) => x.id === remote.id);
      const mappedItem: DumpItem = {
        id: remote.id,
        type: remote.type as DumpItem['type'],
        label: remote.label,
        value: remote.value,
        folderId: remote.folder_id || undefined,
        syncState: 'synced',
        driveMetaFileId: remote.id, // map to driveMetaFileId for compatibility
        driveFileId: remote.storage_path || undefined,
      };

      if (localIndex >= 0) {
        const localItem = updatedLocalItems[localIndex];
        if (localItem.syncState === 'pending') {
          continue;
        }
        updatedLocalItems[localIndex] = {
          ...localItem,
          ...mappedItem,
        };
      } else {
        // New remote item - download file if it has storage_path
        if ((remote.type === 'photo' || remote.type === 'file') && remote.storage_path) {
          try {
            const { data: blobData, error: downloadErr } = await supabase.storage
              .from('files')
              .download(remote.storage_path);

            if (downloadErr) {
              throw new Error(downloadErr.message);
            }

            if (blobData) {
              await saveItemFile(remote.id, blobData);
            }
          } catch (downloadErr) {
            console.error(`Failed to download asset for item ${remote.id}:`, downloadErr);
          }
        }

        updatedLocalItems.push(mappedItem);
      }
    }

    await saveItems(updatedLocalItems);
  } catch (err) {
    console.error('[Sync Engine] Pull changes failed:', err);
    throw err;
  }
};
