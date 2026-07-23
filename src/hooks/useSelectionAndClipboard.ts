import { useState, useEffect } from 'react';
import {
  DumpItem,
  getItems,
  saveItems,
  deleteItemFile,
} from '../utils/db';

export function useSelectionAndClipboard(
  modals: any,
  itemsState: any
) {
  const { setContextMenu, showConfirm, showAlert, setPreviewPhotoId } = modals;
  const { setItems, activeFolderId, setActiveFolderId, filteredList } = itemsState;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{ type: 'copy' | 'cut'; itemIds: Set<string> } | null>(null);

  const handleCardContextMenu = (e: React.MouseEvent, item: DumpItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]));
    }
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, item });
  };

  const handleCardClick = (e: React.MouseEvent, item: DumpItem) => {
    if (e.ctrlKey || e.metaKey) {
      const newSelected = new Set(selectedIds);
      if (newSelected.has(item.id)) newSelected.delete(item.id);
      else newSelected.add(item.id);
      setSelectedIds(newSelected);
    } else if (e.shiftKey && selectedIds.size > 0) {
      const lastSelectedId = Array.from(selectedIds).pop();
      if (!lastSelectedId) return;
      const flatList = filteredList;
      const startIdx = flatList.findIndex((x: any) => x.id === lastSelectedId);
      const endIdx = flatList.findIndex((x: any) => x.id === item.id);
      if (startIdx !== -1 && endIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        const newSelected = new Set(selectedIds);
        for (let i = min; i <= max; i++) {
          newSelected.add(flatList[i].id);
        }
        setSelectedIds(newSelected);
      }
    } else {
      setSelectedIds(new Set([item.id]));
    }
  };

  const handleCardDoubleClick = (_e: React.MouseEvent, item: DumpItem) => {
    if (item.type === 'folder') {
      setActiveFolderId(item.id);
      setSelectedIds(new Set());
    } else if (item.type === 'photo') {
      setPreviewPhotoId(item.id);
    }
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleCopyItem = (id: string) => {
    setClipboard({ type: 'copy', itemIds: new Set([id]) });
  };

  const handleCutItem = (id: string) => {
    setClipboard({ type: 'cut', itemIds: new Set([id]) });
  };

  const handleCopySelected = () => {
    if (selectedIds.size > 0) {
      setClipboard({ type: 'copy', itemIds: new Set(selectedIds) });
    }
  };

  const handleCutSelected = () => {
    if (selectedIds.size > 0) {
      setClipboard({ type: 'cut', itemIds: new Set(selectedIds) });
    }
  };

  const handlePasteSelected = async (targetFolderId: string | null = activeFolderId) => {
    if (!clipboard || clipboard.itemIds.size === 0) return;
    const currentItems = await getItems();

    const pastedItems = currentItems.filter((i) => clipboard.itemIds.has(i.id));

    if (clipboard.type === 'cut') {
      let isMovingFolderIntoItself = false;
      for (const pItem of pastedItems) {
        if (pItem.type === 'folder' && pItem.id === targetFolderId) {
          isMovingFolderIntoItself = true;
          break;
        }
      }

      if (isMovingFolderIntoItself) {
        showAlert('Invalid Move', 'You cannot move a folder into itself.');
        return;
      }

      const updated = currentItems.map((item) => {
        if (clipboard.itemIds.has(item.id)) {
          return { ...item, folderId: targetFolderId || undefined, syncState: 'pending' as const };
        }
        return item;
      });
      await saveItems(updated);
      setItems(updated);

      setClipboard(null);
    } else if (clipboard.type === 'copy') {
      showAlert('Notice', 'Copying files is not yet fully supported (coming soon).');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await showConfirm(
      'Confirm Deletion',
      `Delete all ${selectedIds.size} selected items?`,
      { confirmText: 'Delete All', isDestructive: true }
    );
    if (!confirmed) return;

    const currentItems = await getItems();
    const remaining = currentItems.filter((x) => !selectedIds.has(x.id));
    const deletedItems = currentItems.filter((x) => selectedIds.has(x.id));

    await saveItems(remaining);
    setItems(remaining);
    setSelectedIds(new Set());
    for (const delItem of deletedItems) {
      if (delItem.type === 'photo' || delItem.type === 'file') {
        await deleteItemFile(delItem.id);
      }
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is inside an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Select All (Ctrl+A / Cmd+A)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const allIds = filteredList.map((x: any) => x.id);
        setSelectedIds(new Set(allIds));
      }

      // Delete (Delete or Backspace)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }

      // Copy (Ctrl+C / Cmd+C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleCopySelected();
        }
      }

      // Cut (Ctrl+X / Cmd+X)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleCutSelected();
        }
      }

      // Paste (Ctrl+V / Cmd+V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboard && clipboard.itemIds.size > 0) {
          e.preventDefault();
          handlePasteSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedIds, clipboard, filteredList, activeFolderId]);

  return {
    selectedIds, setSelectedIds,
    clipboard, setClipboard,
    handleCardContextMenu, handleCardClick, handleCardDoubleClick,
    handleCopyText, handleCopyItem, handleCutItem,
    handleCopySelected, handleCutSelected, handlePasteSelected, handleDeleteSelected,
  };
}
