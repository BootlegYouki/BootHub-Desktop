import { useState, useEffect } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  DumpItem,
  getItems,
  saveItems,
  addItem,
  getItemFile,
  saveItemFile,
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
    } else if (item.type === 'link') {
      let targetUrl = item.value.startsWith('http') ? item.value : `https://${item.value}`;
      openUrl(targetUrl).catch(() => {
        window.open(targetUrl, '_blank');
      });
    }
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const writeItemToSystemClipboard = async (target: DumpItem) => {
    try {
      if (
        target.type === 'photo' ||
        (target.type === 'file' && /\.(png|jpe?g|webp|gif|bmp)$/i.test(target.label || target.value))
      ) {
        const blob = await getItemFile(target.id);
        if (blob) {
          let mimeType = blob.type;
          if (!mimeType || !mimeType.startsWith('image/')) {
            const ext = (target.label || target.value).split('.').pop()?.toLowerCase();
            if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
            else if (ext === 'png') mimeType = 'image/png';
            else if (ext === 'webp') mimeType = 'image/webp';
            else if (ext === 'gif') mimeType = 'image/gif';
            else mimeType = 'image/png';
          }
          const buffer = await blob.arrayBuffer();
          const imageBlob = new Blob([buffer], { type: mimeType });
          if (typeof ClipboardItem !== 'undefined') {
            const clipboardItem = new ClipboardItem({ [mimeType]: imageBlob });
            await navigator.clipboard.write([clipboardItem]);
            return;
          }
        }
      }

      if (target.type === 'link' || target.type === 'text') {
        if (target.value) {
          await navigator.clipboard.writeText(target.value);
          return;
        }
      }

      if (target.type === 'file') {
        const fileUrl = `http://127.0.0.1:14201/files/${target.id}`;
        await navigator.clipboard.writeText(fileUrl);
        return;
      }
    } catch (err) {
      console.error('Failed to write to system clipboard:', err);
      if (target.value && !target.value.startsWith('ph://')) {
        await navigator.clipboard.writeText(target.value).catch(() => {});
      }
    }
  };

  const handleCopyItem = async (id: string) => {
    setClipboard({ type: 'copy', itemIds: new Set([id]) });
    const currentItems = await getItems();
    const target = currentItems.find((i) => i.id === id);
    if (target) {
      await writeItemToSystemClipboard(target);
    }
  };

  const handleCutItem = (id: string) => {
    setClipboard({ type: 'cut', itemIds: new Set([id]) });
  };

  const handleCopySelected = async () => {
    if (selectedIds.size > 0) {
      setClipboard({ type: 'copy', itemIds: new Set(selectedIds) });
      const currentItems = await getItems();
      const targets = currentItems.filter((i) => selectedIds.has(i.id));
      if (targets.length === 1) {
        await writeItemToSystemClipboard(targets[0]);
      } else {
        const texts = targets
          .map((t) => t.value)
          .filter((v) => v && !v.startsWith('ph://'))
          .join('\n');
        if (texts) {
          await navigator.clipboard.writeText(texts).catch(() => {});
        }
      }
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
      const createdItems: DumpItem[] = [];
      for (const pItem of pastedItems) {
        if (pItem.type === 'folder') continue; // folder duplication can be added if needed
        const newId = `${pItem.type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const copyLabel = pItem.label ? `${pItem.label} (Copy)` : undefined;

        if (pItem.type === 'photo' || pItem.type === 'file') {
          const fileBlob = await getItemFile(pItem.id);
          if (fileBlob) {
            await saveItemFile(newId, fileBlob);
          }
        }

        const newItem: DumpItem = {
          id: newId,
          type: pItem.type,
          label: copyLabel || pItem.label || pItem.value,
          value: pItem.value,
          folderId: targetFolderId || undefined,
          syncState: 'pending',
        };
        await addItem(newItem);
        createdItems.push(newItem);
      }
      const updated = [...currentItems, ...createdItems];
      setItems(updated);
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

      // Escape key (Cancel Move / Clear Clipboard / Clear Selection)
      if (e.key === 'Escape') {
        if (clipboard || selectedIds.size > 0) {
          e.preventDefault();
          setClipboard(null);
          setSelectedIds(new Set());
        }
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
