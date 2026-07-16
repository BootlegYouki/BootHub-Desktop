const memStorage = {};
const AsyncStorage = {
  getItem: async (key) => memStorage[key] || null,
  setItem: async (key, val) => { memStorage[key] = val; },
  removeItem: async (key) => { delete memStorage[key]; },
  getAllKeys: async () => Object.keys(memStorage)
};

export interface DumpItem {
  id: string;
  type: 'link' | 'text' | 'photo' | 'file' | 'folder';
  label: string;
  value: string;
  folderId?: string;
  driveFileId?: string;
  storagePath?: string;
  syncState: 'synced' | 'pending' | 'syncing';
}

export interface SyncTask {
  id: string;
  action: 'UPLOAD' | 'DELETE' | 'UPDATE';
  itemId: string;
  itemType: DumpItem['type'];
  fileUri?: string;
  storagePath?: string;
}

const ITEMS_KEY = '@boothub_items';
const FILES_KEY_PREFIX = '@boothub_files:';
const SYNC_QUEUE_KEY = '@boothub_syncQueue';
const SETTINGS_KEY_PREFIX = '@boothub_settings:';

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

export const getItems = async (): Promise<DumpItem[]> => {
  try {
    const data = await AsyncStorage.getItem(ITEMS_KEY);
    if (!data) return [];
    return JSON.parse(data) as DumpItem[];
  } catch (e) {
    console.error('Error getting items', e);
    return [];
  }
};

export const saveItems = async (items: DumpItem[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items));
    notifyStorageListeners();
  } catch (e) {
    console.error('Error saving items', e);
  }
};

export const addItem = async (item: DumpItem): Promise<void> => {
  const items = await getItems();
  const index = items.findIndex((i) => i.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
  await saveItems(items);
};

// For React Native we can't store Blob in AsyncStorage directly, 
// usually we store the local file URI as string or base64. 
// For now we will type file as any (string base64 or URI)
export const getItemFile = async (itemId: string): Promise<any | null> => {
  try {
    const data = await AsyncStorage.getItem(FILES_KEY_PREFIX + itemId);
    if (!data) return null;
    return data; // returning the base64 or URI string
  } catch (e) {
    return null;
  }
};

export const saveItemFile = async (itemId: string, blobData: any): Promise<void> => {
  try {
    await AsyncStorage.setItem(FILES_KEY_PREFIX + itemId, blobData);
  } catch (e) {
    console.error('Error saving item file', e);
  }
};

export const deleteItemFile = async (itemId: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(FILES_KEY_PREFIX + itemId);
  } catch (e) {
    console.error('Error deleting item file', e);
  }
};

export const getSyncQueue = async (): Promise<SyncTask[]> => {
  try {
    const data = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
    if (!data) return [];
    return JSON.parse(data) as SyncTask[];
  } catch (e) {
    return [];
  }
};

export const saveSyncQueue = async (queue: SyncTask[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Error saving sync queue', e);
  }
};

export const getSetting = async <T>(key: string): Promise<T | null> => {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY_PREFIX + key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (e) {
    return null;
  }
};

export const saveSetting = async <T>(key: string, val: T): Promise<void> => {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY_PREFIX + key, JSON.stringify(val));
  } catch (e) {
    console.error('Error saving setting', e);
  }
};

export const deleteSetting = async (key: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(SETTINGS_KEY_PREFIX + key);
  } catch (e) {
    console.error('Error deleting setting', e);
  }
};

export const clearAllData = async (): Promise<void> => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const keysToRemove = keys.filter(k => 
      k === ITEMS_KEY || 
      k === SYNC_QUEUE_KEY || 
      k.startsWith(FILES_KEY_PREFIX) || 
      k.startsWith(SETTINGS_KEY_PREFIX)
    );
    for (const k of keysToRemove) { await AsyncStorage.removeItem(k); }
    notifyStorageListeners();
  } catch (e) {
    console.error('Error clearing data', e);
  }
};
