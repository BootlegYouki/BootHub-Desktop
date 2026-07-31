import { useState, useEffect, useRef } from 'react';
import {
  DumpItem,
  saveItemFile,
  addItem,
  getItems,
  updateItem,
} from '../utils/db';

import { TabType } from '../types';

export function useDragAndDrop(itemsState: any) {
  const { activeTab, activeFolderId, setItems } = itemsState;

  const [inputText, setInputText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dragCounter = useRef(0);
  const isInternalDrag = useRef(false);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [inputText]);

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

  const traverseEntry = async (
    entry: any,
    parentFolderId?: string,
    newItemsList: DumpItem[] = [],
    tabType: TabType = activeTab
  ): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });

      const fileId = `${Date.now()}_file_${Math.random().toString(36).substring(2, 5)}`;
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

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const newFileItem: DumpItem = {
        id: fileId,
        type,
        label,
        value,
        syncState: 'pending',
        folderId: parentFolderId,
      };

      setItems((prev: DumpItem[]) => [newFileItem, ...prev]);
      await saveItemFile(fileId, file);
      await addItem(newFileItem);
      newItemsList.push(newFileItem);
    } else if (entry.isDirectory) {
      const folderId = `folder_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
      const value = JSON.stringify({
        name: entry.name,
        tab: tabType,
      });

      const newFolderItem: DumpItem = {
        id: folderId,
        type: 'folder',
        label: entry.name,
        value,
        syncState: 'pending',
        folderId: parentFolderId,
      };

      await addItem(newFolderItem);
      newItemsList.push(newFolderItem);

      const dirReader = entry.createReader();
      const entries = await new Promise<any[]>((resolve, reject) => {
        dirReader.readEntries(resolve, reject);
      });

      for (const child of entries) {
        await traverseEntry(child, folderId, newItemsList, tabType);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (isInternalDrag.current) return;
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    dragCounter.current = 0;

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const newItemsList: DumpItem[] = [];

      for (const item of Array.from(e.dataTransfer.items)) {
        if (item.kind === 'file') {
          const entry =
            (item as any).webkitGetAsEntry
              ? (item as any).webkitGetAsEntry()
              : (item as any).getAsEntry
              ? (item as any).getAsEntry()
              : null;

          if (entry) {
            await traverseEntry(entry, activeFolderId || undefined, newItemsList, activeTab);
          } else {
            const file = item.getAsFile();
            if (file) {
              const fileId = `${Date.now()}_file_${Math.random().toString(36).substring(2, 5)}`;
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

              const now = new Date();
              const pad = (n: number) => n.toString().padStart(2, '0');
              const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(now.getHours())}:${pad(now.getMinutes())}`;

              const currentItems = await getItems();
              const existingItem = currentItems.find(i => 
                i.type === type && 
                i.folderId === (activeFolderId || undefined) && 
                (isImage ? i.value === file.name : (
                  (() => {
                    try { return JSON.parse(i.value).name === file.name; } 
                    catch { return false; }
                  })()
                ))
              );

              if (existingItem) {
                await saveItemFile(existingItem.id, file);
                await updateItem(existingItem.id, value, label);
                setItems((prev: DumpItem[]) => prev.map(i => i.id === existingItem.id ? { ...existingItem, label, value, syncState: 'pending' } : i));
              } else {
                const newFileItem: DumpItem = {
                  id: fileId,
                  type,
                  label,
                  value,
                  syncState: 'pending',
                  folderId: activeFolderId || undefined,
                };

                setItems((prev: DumpItem[]) => [newFileItem, ...prev]);
                await saveItemFile(fileId, file);
                await addItem(newFileItem);
                newItemsList.push(newFileItem);
              }
            }
          }
        }
      }

      // State is updated automatically via subscribeToStorage in db.ts
    }
  };

  const handleDirectAddFiles = async (files: FileList) => {
    if (!files || files.length === 0) return;
    const newItemsList: DumpItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileId = `${Date.now()}_file_${Math.random().toString(36).substring(2, 5)}`;
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

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const currentItems = await getItems();
      const existingItem = currentItems.find(i => 
        i.type === type && 
        i.folderId === (activeFolderId || undefined) && 
        (isImage ? i.value === file.name : (
          (() => {
            try { return JSON.parse(i.value).name === file.name; } 
            catch { return false; }
          })()
        ))
      );

      if (existingItem) {
        await saveItemFile(existingItem.id, file);
        await updateItem(existingItem.id, value, label);
        setItems((prev: DumpItem[]) => prev.map(i => i.id === existingItem.id ? { ...existingItem, label, value, syncState: 'pending' } : i));
      } else {
        const newFileItem: DumpItem = {
          id: fileId,
          type,
          label,
          value,
          syncState: 'pending',
          folderId: activeFolderId || undefined,
        };

        setItems((prev: DumpItem[]) => [newFileItem, ...prev]);
        await saveItemFile(fileId, file);
        await addItem(newFileItem);
        newItemsList.push(newFileItem);
      }
    }

    // State is updated automatically via subscribeToStorage in db.ts
  };

  const handleSubmitItem = async (e?: any) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    if (inputText.trim() || attachedFiles.length > 0) {
      const newItemsList: DumpItem[] = [];

      if (inputText.trim()) {
        const text = inputText.trim();

        let type: TabType = 'text';
        if (text.startsWith('http://') || text.startsWith('https://')) {
          type = 'link';
        }

        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(
          now.getHours()
        )}:${pad(now.getMinutes())}`;

        const textId = `${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
        const newItem: DumpItem = {
          id: textId,
          type,
          label,
          value: text,
          syncState: 'pending',
          folderId: activeFolderId || undefined,
        };
        await addItem(newItem);
        newItemsList.push(newItem);
      }

      for (const file of attachedFiles) {
        const fileId = `${Date.now()}_file_${Math.random().toString(36).substring(2, 5)}`;
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

        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()} @ ${pad(
          now.getHours()
        )}:${pad(now.getMinutes())}`;

        const currentItems = await getItems();
        const existingItem = currentItems.find(i => 
          i.type === type && 
          i.folderId === (activeFolderId || undefined) && 
          (isImage ? i.value === file.name : (
            (() => {
              try { return JSON.parse(i.value).name === file.name; } 
              catch { return false; }
            })()
          ))
        );

        if (existingItem) {
          await saveItemFile(existingItem.id, file);
          await updateItem(existingItem.id, value, label);
          setItems((prev: DumpItem[]) => prev.map(i => i.id === existingItem.id ? { ...existingItem, label, value, syncState: 'pending' } : i));
        } else {
          const newFileItem: DumpItem = {
            id: fileId,
            type,
            label,
            value,
            syncState: 'pending',
            folderId: activeFolderId || undefined,
          };

          setItems((prev: DumpItem[]) => [newFileItem, ...prev]);
          await saveItemFile(fileId, file);
          await addItem(newFileItem);
          newItemsList.push(newFileItem);
        }
      }

      // State is updated automatically via subscribeToStorage in db.ts

      setInputText('');
      setAttachedFiles([]);
    }
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      const filesArray = Array.from(e.clipboardData.files);
      setAttachedFiles((prev) => [...prev, ...filesArray]);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitItem();
    }
  };

  return {
    inputText, setInputText,
    attachedFiles, setAttachedFiles,
    dragActive, setDragActive,
    textareaRef,
    handleDragEnter, handleDragLeave, handleDragOver, handleDrop,
    handleDirectAddFiles, handleSubmitItem, handleInputPaste, handleTextareaKeyDown,
  };
}
