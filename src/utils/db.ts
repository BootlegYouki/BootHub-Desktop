import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface DumpItem {
  id: string;
  type: 'link' | 'text' | 'photo' | 'file' | 'folder';
  label: string;
  value: string;
  folderId?: string;
  syncState: 'synced' | 'pending' | 'syncing';
}

const DB_NAME = 'boothub_files';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
let storageListeners: (() => void)[] = [];

// Initialize Tauri listeners
listen('storage-updated', () => {
  notifyStorageListeners();
}).catch(console.error);

listen<string>('mobile-message', (event) => {
  try {
    const data = JSON.parse(event.payload);
    if (data.type === 'FILE_PROGRESS') {
      const { itemId, progress } = data;
      if (progress >= 1) {
        clearProgress(itemId);
      } else {
        setProgressWithTimeout(itemId, 0.50 + (progress * 0.50));
      }
    }
  } catch (e) {}
});

export const subscribeToStorage = (listener: () => void) => {
  storageListeners.push(listener);
  return () => {
    storageListeners = storageListeners.filter((l) => l !== listener);
  };
};

const notifyStorageListeners = () => {
  storageListeners.forEach((l) => l());
};

export const initDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const getStore = async (storeName: string, mode: IDBTransactionMode = 'readonly') => {
  const db = await initDb();
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
};

export const dbGet = async <T>(storeName: string, key: string): Promise<T | null> => {
  const store = await getStore(storeName);
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const dbPut = async <T>(storeName: string, key: string, value: T): Promise<void> => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const dbDelete = async (storeName: string, key: string): Promise<void> => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// --- App-specific API mappings ---

export const getItems = async (): Promise<DumpItem[]> => {
  try {
    return await invoke<DumpItem[]>('get_items');
  } catch (e) {
    console.error('Failed to get items via Tauri:', e);
    return [];
  }
};

export const saveItems = async (newItems: DumpItem[]): Promise<void> => {
  const currentItems = await getItems();
  const currentMap = new Map(currentItems.map(i => [i.id, i]));
  const newMap = new Map(newItems.map(i => [i.id, i]));

  for (const id of currentMap.keys()) {
    if (!newMap.has(id)) {
      await invoke('delete_item', { id });
    }
  }

  for (const [id, newItem] of newMap.entries()) {
    if (!currentMap.has(id)) {
      await invoke('add_item', { 
        id: newItem.id, 
        type: newItem.type, 
        value: newItem.value, 
        label: newItem.label,
        folderId: newItem.folderId || null 
      });
    } else {
      const currentItem = currentMap.get(id)!;
      if (currentItem.value !== newItem.value || currentItem.label !== newItem.label) {
        await invoke('update_item', { id, value: newItem.value, label: newItem.label });
      }
      if (currentItem.folderId !== newItem.folderId) {
        await invoke('set_item_folder', { id, folderId: newItem.folderId || null });
      }
    }
  }
  notifyStorageListeners();
};

export const addItem = async (item: DumpItem): Promise<void> => {
  await invoke('add_item', { 
    id: item.id,
    type: item.type, 
    value: item.value, 
    label: item.label,
    folderId: item.folderId || null 
  });
  notifyStorageListeners();
};

export const deleteItem = async (id: string): Promise<void> => {
  await invoke('delete_item', { id });
  notifyStorageListeners();
};

export const updateItem = async (id: string, value?: string, label?: string): Promise<void> => {
  await invoke('update_item', { id, value: value || null, label: label || null });
  notifyStorageListeners();
};

export const setItemFolder = async (id: string, folderId: string | undefined): Promise<void> => {
  await invoke('set_item_folder', { id, folderId: folderId || null });
  notifyStorageListeners();
};

export const getItemFile = async (itemId: string): Promise<Blob | null> => {
  try {
    const data = await invoke<Uint8Array | number[]>('read_file', { id: itemId });
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    return new Blob([u8 as any]);
  } catch (err) {
    return null;
  }
};

export const fileProgressMap = new Map<string, number>();
const fileProgressListeners = new Set<() => void>();
const progressTimeouts = new Map<string, any>();

export const notifyFileProgressListeners = () => {
  fileProgressListeners.forEach((fn) => fn());
};

const setProgressWithTimeout = (itemId: string, pct: number) => {
  fileProgressMap.set(itemId, pct);
  notifyFileProgressListeners();
  if (progressTimeouts.has(itemId)) {
    clearTimeout(progressTimeouts.get(itemId));
  }
  progressTimeouts.set(itemId, setTimeout(() => {
    fileProgressMap.delete(itemId);
    notifyFileProgressListeners();
    progressTimeouts.delete(itemId);
  }, 30000));
};

const clearProgress = (itemId: string) => {
  fileProgressMap.delete(itemId);
  notifyFileProgressListeners();
  if (progressTimeouts.has(itemId)) {
    clearTimeout(progressTimeouts.get(itemId));
    progressTimeouts.delete(itemId);
  }
};

export const subscribeToFileProgress = (fn: () => void) => {
  fileProgressListeners.add(fn);
  return () => {
    fileProgressListeners.delete(fn);
  };
};

export const saveItemFile = (itemId: string, blob: Blob): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    setProgressWithTimeout(itemId, 0.01);

    const xhr = new XMLHttpRequest();
    let isMobileConnected = false;
    try {
      isMobileConnected = await invoke('is_mobile_connected');
    } catch (e) {}

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const loadedPct = event.loaded / event.total;
          const pct = isMobileConnected 
            ? Math.min(0.50, Math.max(0.01, loadedPct * 0.50))
            : Math.min(0.99, Math.max(0.01, loadedPct));
          setProgressWithTimeout(itemId, pct);
        }
      };
    }
    xhr.open('POST', `http://127.0.0.1:14201/files/${itemId}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (!isMobileConnected) {
          clearProgress(itemId);
        } else {
          setProgressWithTimeout(itemId, 0.50);
        }
        resolve();
      } else {
        clearProgress(itemId);
        reject(new Error('HTTP status ' + xhr.status));
      }
    };
    xhr.onerror = (err) => {
      clearProgress(itemId);
      console.error('XHR file save failed:', err);
      reject(err);
    };
    xhr.send(blob);
  });
};

export const deleteItemFile = async (itemId: string): Promise<void> => {
  await invoke('delete_file', { id: itemId }).catch(() => {});
};

export const getSetting = async <T>(key: string): Promise<T | null> => {
  return await dbGet<T>('settings', key);
};

export const saveSetting = async <T>(key: string, val: T): Promise<void> => {
  await dbPut('settings', key, val);
};

export const deleteSetting = async (key: string): Promise<void> => {
  await dbDelete('settings', key);
};

export const clearAllData = async (): Promise<void> => {
  const store = await getStore('files', 'readwrite');
  store.clear();
  // Items clearing logic is omitted because P2P ledger handles this now.
  notifyStorageListeners();
};
