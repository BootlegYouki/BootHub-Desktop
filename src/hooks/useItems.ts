import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  DumpItem,
  getItems,
  saveItems,
  deleteItemFile,
  getItemFile,
  subscribeToStorage,
} from '../utils/db';

import { TabType } from '../types';
import { previewCache } from '../components/LinkPreview';

export function useItems(modals: any) {
  const { setFolderPrompt, showAlert } = modals;

  const [items, setItems] = useState<DumpItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    return (localStorage.getItem('@boothub_active_tab') as TabType) || 'link';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(() => {
    return localStorage.getItem('@boothub_active_folder') || null;
  });

  useEffect(() => {
    localStorage.setItem('@boothub_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (activeFolderId) {
      localStorage.setItem('@boothub_active_folder', activeFolderId);
    } else {
      localStorage.removeItem('@boothub_active_folder');
    }
  }, [activeFolderId]);

  // Auto-subscribe to local storage changes (including from other windows)
  useEffect(() => {
    let mounted = true;
    const loadItems = async () => {
      try {
        const data = await getItems();
        if (mounted) setItems(data);
      } catch (err) {
        console.error(err);
      }
    };
    loadItems();
    const unsubscribe = subscribeToStorage(loadItems);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const getFolderTab = useCallback(
    (folderInput: string | DumpItem): TabType | null => {
      const folderId = typeof folderInput === 'string' ? folderInput : folderInput.id;
      const folder = items.find((f) => f.id === folderId && f.type === 'folder');
      if (folder && folder.value) {
        try {
          const val = JSON.parse(folder.value);
          return val.tab || null;
        } catch (e) {
          return null;
        }
      }
      return null;
    },
    [items]
  );

  const getFolderName = useCallback(
    (folderInput: string | DumpItem): string => {
      const folderId = typeof folderInput === 'string' ? folderInput : folderInput.id;
      const folder = items.find((f) => f.id === folderId && f.type === 'folder');
      if (folder && folder.value) {
        try {
          const val = JSON.parse(folder.value);
          return val.name || folder.label;
        } catch (e) {
          return folder.label;
        }
      }
      return 'Unknown Folder';
    },
    [items]
  );

  const createFolderWithName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const currentItems = await getItems();
    if (
      currentItems.some((x) => {
        if (x.type !== 'folder') return false;
        try {
          const val = JSON.parse(x.value);
          return val.name === trimmed && val.tab === activeTab;
        } catch {
          return false;
        }
      })
    ) {
      showAlert('Duplicate Folder', 'A folder with this name already exists in this tab.');
      return;
    }

    const newFolder: DumpItem = {
      id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      type: 'folder',
      label: trimmed,
      value: JSON.stringify({ name: trimmed, tab: activeTab }),
      syncState: 'pending',
    };

    const updated = [newFolder, ...currentItems];
    await saveItems(updated);
    setItems(updated);


  };

  const handleCreateFolder = () => {
    setFolderPrompt({ visible: true, name: '' });
  };

  const handleSaveEdit = async (
    id: string,
    newLabel: string,
    newValue: string,
    type: DumpItem['type']
  ) => {
    const currentItems = await getItems();
    const itemIndex = currentItems.findIndex((x) => x.id === id);
    if (itemIndex > -1) {
      currentItems[itemIndex] = {
        ...currentItems[itemIndex],
        label: newLabel,
        value: newValue,
        syncState: 'pending',
      };
      await saveItems(currentItems);
      setItems(currentItems);



      const syncPayload: any = {};
      if (type === 'link' || type === 'text') {
        syncPayload.label = newLabel;
        syncPayload.value = newValue;
      } else if (type === 'folder') {
        syncPayload.label = newLabel;
        syncPayload.value = newValue;
      } else if (type === 'photo' || type === 'file') {
        syncPayload.label = newLabel;
      }

    }
  };

  const handleDeleteItem = async (id: string, type: string) => {
    const currentItems = await getItems();

    if (type === 'folder') {
      const itemsInFolder = currentItems.filter((i) => i.folderId === id);
      const remainingItems = currentItems.filter((i) => i.folderId !== id && i.id !== id);

      await saveItems(remainingItems);
      setItems(remainingItems);

      for (const item of itemsInFolder) {
        if (item.type === 'photo' || item.type === 'file') {
          await deleteItemFile(item.id);
        }
      }
    } else {
      const remaining = currentItems.filter((i) => i.id !== id);
      await saveItems(remaining);
      setItems(remaining);

      if (type === 'photo' || type === 'file') {
        await deleteItemFile(id);
      }
    }
  };

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

  const activeTabItems = useMemo(() => {
    return items.filter((item) => {
      if (item.type === 'folder') {
        const tab = getFolderTab(item.id);
        return tab === activeTab;
      }
      return item.type === activeTab;
    });
  }, [items, activeTab, getFolderTab]);

  const getCachedPreviewText = (url: string): string => {
    try {
      if (previewCache.has(url)) {
        const p = previewCache.get(url);
        if (p) return `${p.title || ''} ${p.description || ''}`;
      }
      const key = `@boothub_preview_cache:${encodeURIComponent(url)}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed) {
          const title = parsed.title || (parsed.data && parsed.data.title) || '';
          const description = parsed.description || (parsed.data && parsed.data.description) || '';
          return `${title} ${description}`;
        }
      }
    } catch (e) {}
    return '';
  };

  const filteredList = useMemo(() => {
    let result = activeTabItems;

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        if (item.type === 'folder') {
          const name = getFolderName(item).toLowerCase();
          return name.includes(q);
        }

        const labelMatch = item.label ? item.label.toLowerCase().includes(q) : false;
        const valueMatch = item.value ? item.value.toLowerCase().includes(q) : false;

        let fileMatch = false;
        if (item.type === 'file' || item.type === 'photo') {
          try {
            const parsed = JSON.parse(item.value);
            if (parsed.name && parsed.name.toLowerCase().includes(q)) fileMatch = true;
          } catch (e) {}
        }

        let previewMatch = false;
        if (item.type === 'link' && item.value) {
          const previewText = getCachedPreviewText(item.value).toLowerCase();
          if (previewText.includes(q)) previewMatch = true;
        }

        return labelMatch || valueMatch || fileMatch || previewMatch;
      });
    } else {
      if (activeFolderId) {
        result = result.filter((item) => item.folderId === activeFolderId);
      } else {
        result = result.filter((item) => !item.folderId || item.type === 'folder');
      }
    }

    return result;
  }, [activeTabItems, activeFolderId, searchQuery, getFolderName]);

  const folders = useMemo(() => filteredList.filter((x) => x.type === 'folder'), [filteredList]);
  const normalItems = useMemo(() => filteredList.filter((x) => x.type !== 'folder'), [filteredList]);

  return {
    items, setItems,
    activeTab, setActiveTab,
    searchQuery, setSearchQuery,
    activeFolderId, setActiveFolderId,
    filteredList, folders, normalItems,
    getFolderName, getFolderTab,
    createFolderWithName, handleCreateFolder,
    handleSaveEdit, handleDeleteItem, handleDownloadFile,
  };
}
