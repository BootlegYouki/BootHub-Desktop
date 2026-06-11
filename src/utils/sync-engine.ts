import axios from 'axios';
import {
  getValidAccessToken,
  getOrCreateSyncFolder,
  getOrCreateSubFolder,
  ensureFileParent,
  fetchAllMetadataFromDrive,
  downloadJsonContent,
  uploadJsonToDrive,
  uploadBinaryToDrive,
  deleteFileFromDrive,
  downloadBinaryFromDrive,
  getGoogleUserInfo,
} from './google-drive';

let realtimeWs: WebSocket | null = null;
let realtimeReconnectTimer: any = null;
let realtimeActiveEmail: string | null = null;
let isRealtimeClosed = false;

export const initializeRealtimeSync = async (): Promise<void> => {
  try {
    const userInfo = await getGoogleUserInfo();
    if (!userInfo || !userInfo.email) {
      closeRealtimeSync();
      return;
    }

    const email = userInfo.email.trim().toLowerCase();
    if (realtimeWs && realtimeActiveEmail === email) {
      return;
    }

    if (realtimeWs) {
      closeRealtimeSync();
    }

    isRealtimeClosed = false;
    realtimeActiveEmail = email;

    let hexEmail = '';
    for (let i = 0; i < email.length; i++) {
      hexEmail += email.charCodeAt(i).toString(16);
    }
    const topic = `boothub-sync-${hexEmail}`;
    const wsUrl = `wss://ntfy.sh/${topic}/ws`;

    const connect = () => {
      if (isRealtimeClosed || realtimeActiveEmail !== email) return;
      console.log('[Realtime Sync] Connecting to', wsUrl);
      realtimeWs = new WebSocket(wsUrl);

      realtimeWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'message' && data.message === 'sync') {
            console.log('[Realtime Sync] Received sync signal from remote device!');
            pullChangesFromDrive().catch((err) => {
              console.error('[Realtime Sync] Pull failed:', err);
            });
          }
        } catch (err) {
          console.error('[Realtime Sync] Error parsing WebSocket message:', err);
        }
      };

      realtimeWs.onclose = () => {
        console.log('[Realtime Sync] Connection closed.');
        if (!isRealtimeClosed && realtimeActiveEmail === email) {
          console.log('[Realtime Sync] Reconnecting in 5 seconds...');
          realtimeReconnectTimer = setTimeout(connect, 5000);
        }
      };

      realtimeWs.onerror = (err) => {
        console.error('[Realtime Sync] WebSocket error:', err);
      };
    };

    connect();
  } catch (err) {
    console.error('[Realtime Sync] Failed to initialize:', err);
  }
};

export const closeRealtimeSync = (): void => {
  isRealtimeClosed = true;
  realtimeActiveEmail = null;
  if (realtimeReconnectTimer) {
    clearTimeout(realtimeReconnectTimer);
    realtimeReconnectTimer = null;
  }
  if (realtimeWs) {
    realtimeWs.close();
    realtimeWs = null;
  }
  console.log('[Realtime Sync] Closed connection.');
};

export const notifyRemoteDevicesOfChange = async (): Promise<void> => {
  try {
    const userInfo = await getGoogleUserInfo();
    if (!userInfo || !userInfo.email) return;

    const cleaned = userInfo.email.trim().toLowerCase();
    let hexEmail = '';
    for (let i = 0; i < cleaned.length; i++) {
      hexEmail += cleaned.charCodeAt(i).toString(16);
    }
    const topic = `boothub-sync-${hexEmail}`;

    console.log('[Realtime Sync] Notifying remote devices...');
    await axios.post(`https://ntfy.sh/${topic}`, 'sync', {
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (err) {
    console.warn('[Realtime Sync] Failed to send remote notification:', err);
  }
};
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

const CATEGORY_FOLDERS: Record<string, string> = {
  photo: 'Photos',
  file: 'Files',
  link: 'Links',
  text: 'Texts',
  folder: 'Folders',
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

const notifyUploadProgress = (itemId: string, progress: number) => {
  progressListeners.forEach((l) => l(itemId, progress));
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
          } catch (err) {
            console.warn(`[Sync Engine] Failed to abort in-flight task for item ${itemId}:`, err);
          }
          activeSyncTasks.delete(itemId);
        }

        updatedQueue = updatedQueue.filter((t) => t.itemId !== itemId);
        const newTask: SyncTask = {
          id: uniqueId,
          action,
          itemId,
          itemType,
          driveMetaFileId: extras?.driveMetaFileId,
          driveFileId: extras?.driveFileId,
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
        // UPLOAD
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
  const accessToken = await getValidAccessToken();
  if (!accessToken) return;

  await runLockedQueueOperation(async () => {
    const items = await getItems();
    const queue = await getSyncQueue();

    const unsyncedItems = items.filter((item) => {
      if (item.driveMetaFileId) return false;
      const isAlreadyQueued = queue.some((t) => t.itemId === item.id && t.action === 'UPLOAD');
      return !isAlreadyQueued;
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
        fileUri: taskInput.extras.fileUri,
      });
    }

    await saveSyncQueue(updatedQueue);
  });
};

const resolveUserFolderDriveId = async (
  accessToken: string,
  localFolderId: string,
  categoryFolderId: string,
  localItems: DumpItem[]
): Promise<string> => {
  const localFolder = localItems.find((item) => item.id === localFolderId && item.type === 'folder');
  if (!localFolder) {
    return categoryFolderId;
  }

  let parentDriveId = categoryFolderId;
  if (localFolder.folderId) {
    parentDriveId = await resolveUserFolderDriveId(
      accessToken,
      localFolder.folderId,
      categoryFolderId,
      localItems
    );
  }

  let folderName = 'New Folder';
  try {
    folderName = JSON.parse(localFolder.value).name || 'New Folder';
  } catch {}

  return await getOrCreateSubFolder(accessToken, parentDriveId, folderName);
};

let isProcessingQueue = false;

export const processSyncQueue = async (): Promise<void> => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  updateSyncStatus({ isSyncing: true, error: null });

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      updateSyncStatus({ isSyncing: false, error: 'Sign-in required to synchronize.' });
      isProcessingQueue = false;
      return;
    }

    let processedAnyTasks = false;
    const syncFolderId = await getOrCreateSyncFolder(accessToken);

    while (true) {
      const queue = await getSyncQueue();
      if (queue.length === 0) {
        break;
      }

      for (const task of [...queue]) {
        processedAnyTasks = true;
        let activeAbort = () => {};
        activeSyncTasks.set(task.itemId, { abort: () => activeAbort() });

        try {
          const localItems = await getItems();
          const localItem = localItems.find((item) => item.id === task.itemId);

          if (!localItem && task.action !== 'DELETE') {
            await dequeueTask(task.id);
            continue;
          }

          let parentFolderId = syncFolderId;
          if (localItem) {
            let categoryName = CATEGORY_FOLDERS[localItem.type] || 'Others';
            if (localItem.type === 'folder') {
              try {
                const folderObj = JSON.parse(localItem.value);
                if (folderObj && folderObj.tab) {
                  categoryName = CATEGORY_FOLDERS[folderObj.tab] || categoryName;
                }
              } catch {}
            }
            const categoryFolderId = await getOrCreateSubFolder(accessToken, syncFolderId, categoryName);
            parentFolderId = categoryFolderId;

            if (localItem.folderId) {
              parentFolderId = await resolveUserFolderDriveId(
                accessToken,
                localItem.folderId,
                categoryFolderId,
                localItems
              );
            }
          }

          if (task.action === 'UPLOAD') {
            if (!localItem) continue;

            if (localItem.driveMetaFileId) {
              await dequeueTask(task.id);
              continue;
            }

            let driveFileId = localItem.driveFileId;

            try {
              if ((localItem.type === 'photo' || localItem.type === 'file') && !driveFileId) {
                const fileBlob = await getItemFile(localItem.id);
                if (!fileBlob) {
                  console.warn(`Local binary file not found for item ${localItem.id}. Skipping upload.`);
                  await dequeueTask(task.id);
                  continue;
                }

                let fileName = '';
                let mimeType = 'application/octet-stream';

                if (localItem.type === 'photo') {
                  fileName = `photo_${localItem.id}.jpg`;
                  mimeType = 'image/jpeg';
                } else {
                  const fileObj = JSON.parse(localItem.value);
                  fileName = fileObj.name || `file_${localItem.id}`;
                  mimeType = fileObj.mimeType || 'application/octet-stream';
                }

                const abortController = new AbortController();
                activeAbort = () => abortController.abort();

                driveFileId = await uploadBinaryToDrive(
                  accessToken,
                  parentFolderId,
                  fileName,
                  fileBlob,
                  mimeType,
                  undefined,
                  abortController.signal,
                  (progress) => {
                    notifyUploadProgress(task.itemId, progress);
                  }
                );
              } else if (localItem.type === 'folder' && !driveFileId) {
                let folderName = 'New Folder';
                try {
                  folderName = JSON.parse(localItem.value).name || 'New Folder';
                } catch {}
                driveFileId = await getOrCreateSubFolder(accessToken, parentFolderId, folderName);
              }

              const metadataFileName = `item_${localItem.id}.json`;
              const updatedItem = {
                ...localItem,
                syncState: 'synced' as const,
                driveFileId,
              };

              const metadataAbortController = new AbortController();
              activeAbort = () => metadataAbortController.abort();

              const driveMetaFileId = await uploadJsonToDrive(
                accessToken,
                parentFolderId,
                metadataFileName,
                JSON.stringify(updatedItem),
                undefined,
                metadataAbortController.signal
              );

              const latestItems = await getItems();
              const itemStillExists = latestItems.some((item) => item.id === localItem.id);

              if (!itemStillExists) {
                if (driveFileId) await deleteFileFromDrive(accessToken, driveFileId).catch(() => {});
                if (driveMetaFileId) await deleteFileFromDrive(accessToken, driveMetaFileId).catch(() => {});
              } else {
                const updatedLocalList = latestItems.map((item) => {
                  if (item.id === localItem.id) {
                    return {
                      ...item,
                      syncState: 'synced' as const,
                      driveFileId,
                      driveMetaFileId,
                    };
                  }
                  return item;
                });
                await saveItems(updatedLocalList);
              }
            } catch (uploadErr) {
              const isCancel = axios.isCancel(uploadErr) || (uploadErr as any).message?.includes('cancel') || (uploadErr as any).message?.includes('abort');
              if (isCancel && driveFileId && !localItem.driveFileId) {
                await deleteFileFromDrive(accessToken, driveFileId).catch(() => {});
              }
              throw uploadErr;
            }

          } else if (task.action === 'UPDATE') {
            if (!localItem) continue;

            if (!localItem.driveMetaFileId) {
              task.action = 'UPLOAD';
              await processSyncQueue();
              return;
            }

            if (localItem.type === 'folder' && localItem.driveFileId) {
              let folderName = 'New Folder';
              try {
                folderName = JSON.parse(localItem.value).name || 'New Folder';
              } catch {}

              const folderUpdateAbortController = new AbortController();
              activeAbort = () => folderUpdateAbortController.abort();

              await axios.patch(
                `https://www.googleapis.com/drive/v3/files/${localItem.driveFileId}`,
                { name: folderName },
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                  },
                  signal: folderUpdateAbortController.signal,
                }
              );

              await ensureFileParent(accessToken, localItem.driveFileId, parentFolderId);
            }

            if ((localItem.type === 'photo' || localItem.type === 'file') && localItem.driveFileId) {
              await ensureFileParent(accessToken, localItem.driveFileId, parentFolderId);
            }

            await ensureFileParent(accessToken, localItem.driveMetaFileId, parentFolderId);

            const metadataFileName = `item_${localItem.id}.json`;
            const updatedItem = {
              ...localItem,
              syncState: 'synced' as const,
            };

            const metadataUpdateAbortController = new AbortController();
            activeAbort = () => metadataUpdateAbortController.abort();

            await uploadJsonToDrive(
              accessToken,
              parentFolderId,
              metadataFileName,
              JSON.stringify(updatedItem),
              localItem.driveMetaFileId,
              metadataUpdateAbortController.signal
            );

            const latestItems = await getItems();
            const updatedLocalList = latestItems.map((item) => {
              if (item.id === localItem.id) {
                return { ...item, syncState: 'synced' as const };
              }
              return item;
            });
            await saveItems(updatedLocalList);

          } else if (task.action === 'DELETE') {
            if (task.driveMetaFileId) {
              await deleteFileFromDrive(accessToken, task.driveMetaFileId).catch(() => {});
            }
            if (task.driveFileId) {
              await deleteFileFromDrive(accessToken, task.driveFileId).catch(() => {});
            }
            await deleteItemFilesFromDrive(accessToken, task.itemId);
          }

          await dequeueTask(task.id);
        } catch (err: any) {
          const isCancel = axios.isCancel(err) || err.message?.includes('cancel') || err.message?.includes('abort');
          if (isCancel) {
            await dequeueTask(task.id);
            continue;
          }

          const isNetworkError = axios.isAxiosError(err) && (!err.response || err.response.status >= 500);
          if (isNetworkError || err.message?.includes('Network Request Failed') || err.message?.includes('Network Error')) {
            updateSyncStatus({ isSyncing: false, error: 'Connection offline. Sync will resume when online.' });
            isProcessingQueue = false;
            return;
          }

          console.error('Error syncing individual task:', err);
          await dequeueTask(task.id);
        } finally {
          activeSyncTasks.delete(task.itemId);
        }
      }
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const lastSyncedLabel = `${dateStr} @ ${timeStr}`;

    updateSyncStatus({ isSyncing: false, error: null, lastSynced: lastSyncedLabel });
    
    if (processedAnyTasks) {
      notifyRemoteDevicesOfChange().catch(() => {});
    }
  } catch (err: any) {
    console.error('Failed to run sync queue:', err);
    const details = err.response?.data
      ? (typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data))
      : (err.message || String(err));
    updateSyncStatus({ isSyncing: false, error: 'Sync failed: ' + details });
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

export const deleteItemFilesFromDrive = async (accessToken: string, itemId: string): Promise<void> => {
  try {
    const query = `name contains '${itemId}' and trashed = false`;
    const searchRes = await axios.get(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const files = searchRes.data.files || [];
    let driveFileIdToClean: string | undefined = undefined;

    for (const file of files) {
      if (file.name.startsWith('item_') && file.name.endsWith('.json')) {
        try {
          const content = await downloadJsonContent(accessToken, file.id);
          if (content && content.driveFileId) {
            driveFileIdToClean = content.driveFileId;
          }
        } catch {}
      }
    }

    if (driveFileIdToClean) {
      await axios.delete(`https://www.googleapis.com/drive/v3/files/${driveFileIdToClean}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }

    for (const file of files) {
      await axios.delete(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  } catch (err) {
    console.error(`Failed to run 2nd checker deletion for item ${itemId}:`, err);
  }
};

export const setConflictResolver = (_resolver: (count: number) => Promise<any>) => {
  // Deprecated: conflict resolution is now automatically handled by propagating remote deletions.
};

export const pullChangesFromDrive = async (): Promise<void> => {
  updateSyncStatus({ isSyncing: true, error: null });
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    updateSyncStatus({ isSyncing: false, error: 'Sign-in required to synchronize.' });
    return;
  }

  try {
    await getOrCreateSyncFolder(accessToken);
    const remoteFiles = await fetchAllMetadataFromDrive(accessToken);

    const localItems = await getItems();
    const lastPullTimestamp = await getSetting<number>('@boothub_last_pull_timestamp') || 0;
    const currentPullTime = Date.now();

    const remoteItems: DumpItem[] = await Promise.all(
      remoteFiles.map(async (file) => {
        try {
          const localMatch = localItems.find((x) => x.driveMetaFileId === file.id);
          const remoteModTime = file.modifiedTime ? Date.parse(file.modifiedTime) : 0;

          if (localMatch && remoteModTime && remoteModTime <= lastPullTimestamp - 10000) {
            return {
              ...localMatch,
              driveMetaFileId: file.id,
            };
          }

          const data = await downloadJsonContent(accessToken, file.id);
          return {
            ...data,
            driveMetaFileId: file.id,
          };
        } catch (err) {
          console.error(`Failed to download content for file ${file.id}:`, err);
          return null;
        }
      })
    ).then((results) => results.filter((x): x is DumpItem => x !== null));

    await saveSetting('@boothub_last_pull_timestamp', currentPullTime);

    const remoteItemIds = new Set(remoteItems.map((x) => x.id));

    const itemsDeletedRemotely = localItems.filter(
      (item) => item.driveMetaFileId && !remoteItemIds.has(item.id)
    );

    let resolveAction: 'follow_drive' | 'follow_phone' = 'follow_drive';
    // Remote deletions (e.g., from phone) automatically propagate locally to keep sync seamless.

    const updatedLocalItems: DumpItem[] = [];

    for (const localItem of localItems) {
      const isDeletedRemotely = itemsDeletedRemotely.some((x) => x.id === localItem.id);

      if (isDeletedRemotely) {
        if (resolveAction === 'follow_drive') {
          if (localItem.type === 'file' || localItem.type === 'photo') {
            await deleteItemFile(localItem.id);
          }
          continue;
        } else {
          updatedLocalItems.push({
            ...localItem,
            syncState: 'pending' as const,
            driveMetaFileId: undefined,
            driveFileId: undefined,
          });
          continue;
        }
      }
      updatedLocalItems.push(localItem);
    }

    for (const remoteItem of remoteItems) {
      const localIndex = updatedLocalItems.findIndex((x) => x.id === remoteItem.id);

      if (localIndex >= 0) {
        const localItem = updatedLocalItems[localIndex];
        if (localItem.syncState === 'pending') {
          continue;
        }

        updatedLocalItems[localIndex] = {
          ...localItem,
          ...remoteItem,
          syncState: 'synced' as const,
        };
      } else {
        // New remote item
        let localValue = remoteItem.value;

        if ((remoteItem.type === 'photo' || remoteItem.type === 'file') && remoteItem.driveFileId) {
          try {
            const fileBlob = await downloadBinaryFromDrive(accessToken, remoteItem.driveFileId);
            await saveItemFile(remoteItem.id, fileBlob);
          } catch (downloadErr) {
            console.error(`Failed to download binary asset for item ${remoteItem.id}:`, downloadErr);
          }
        }

        updatedLocalItems.push({
          ...remoteItem,
          value: localValue,
          syncState: 'synced' as const,
        });
      }
    }

    await saveItems(updatedLocalItems);

    const queue = await getSyncQueue();
    const hasPendingDeletions = queue.some((t) => t.action === 'DELETE');
    if (!hasPendingDeletions) {
      await enqueueUnsyncedLocalItems();
      processSyncQueue();
    }
  } catch (err: any) {
    console.error('Failed to pull changes from Google Drive:', err);
    const details = err.response?.data
      ? (typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data))
      : (err.message || String(err));
    updateSyncStatus({ isSyncing: false, error: 'Sync failed: ' + details });
    throw err;
  }
};
