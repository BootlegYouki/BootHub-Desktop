export interface DumpItem {
  id: string;
  type: 'link' | 'text' | 'photo' | 'file' | 'folder';
  label: string;
  value: string; // URL, text content, JSON metadata for photos/files
  folderId?: string;
  driveMetaFileId?: string;
  driveFileId?: string;
  syncState: 'synced' | 'pending' | 'syncing';
}

export interface SyncTask {
  id: string; // unique task ID (timestamp based)
  action: 'UPLOAD' | 'DELETE' | 'UPDATE';
  itemId: string;
  itemType: DumpItem['type'];
  fileUri?: string; // Kept in memory for compatibility, maps to IndexedDB file store
  driveMetaFileId?: string;
  driveFileId?: string;
}

const DB_NAME = 'boothub_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

let storageListeners: (() => void)[] = [];

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
      if (!db.objectStoreNames.contains('items')) {
        db.createObjectStore('items', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files'); // Keyed by itemId
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings'); // Keyed by setting name
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

// --- Low-level helpers ---

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

export const dbPutWithKeyPath = async <T>(storeName: string, value: T): Promise<void> => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(value);
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

export const dbGetAll = async <T>(storeName: string): Promise<T[]> => {
  const store = await getStore(storeName);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const dbClearStore = async (storeName: string): Promise<void> => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// --- App-specific API mappings ---

export const getItems = async (): Promise<DumpItem[]> => {
  return await dbGetAll<DumpItem>('items');
};

export const saveItems = async (items: DumpItem[]): Promise<void> => {
  const store = await getStore('items', 'readwrite');
  // Overwrite database items
  return new Promise((resolve, reject) => {
    const clearRequest = store.clear();
    clearRequest.onsuccess = () => {
      let count = 0;
      if (items.length === 0) {
        notifyStorageListeners();
        return resolve();
      }
      for (const item of items) {
        const addReq = store.add(item);
        addReq.onsuccess = () => {
          count++;
          if (count === items.length) {
            notifyStorageListeners();
            resolve();
          }
        };
        addReq.onerror = () => reject(addReq.error);
      }
    };
    clearRequest.onerror = () => reject(clearRequest.error);
  });
};

export const addItem = async (item: DumpItem): Promise<void> => {
  await dbPutWithKeyPath('items', item);
  notifyStorageListeners();
};

export const getItemFile = async (itemId: string): Promise<Blob | null> => {
  return await dbGet<Blob>('files', itemId);
};

export const saveItemFile = async (itemId: string, blob: Blob): Promise<void> => {
  await dbPut('files', itemId, blob);
};

export const deleteItemFile = async (itemId: string): Promise<void> => {
  await dbDelete('files', itemId);
};

export const getSyncQueue = async (): Promise<SyncTask[]> => {
  return await dbGetAll<SyncTask>('syncQueue');
};

export const saveSyncQueue = async (queue: SyncTask[]): Promise<void> => {
  const store = await getStore('syncQueue', 'readwrite');
  return new Promise((resolve, reject) => {
    const clearRequest = store.clear();
    clearRequest.onsuccess = () => {
      let count = 0;
      if (queue.length === 0) return resolve();
      for (const task of queue) {
        const addReq = store.add(task);
        addReq.onsuccess = () => {
          count++;
          if (count === queue.length) resolve();
        };
        addReq.onerror = () => reject(addReq.error);
      }
    };
    clearRequest.onerror = () => reject(clearRequest.error);
  });
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
  await dbClearStore('items');
  await dbClearStore('files');
  await dbClearStore('syncQueue');
  await dbClearStore('settings');
  notifyStorageListeners();
};
