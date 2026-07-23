import { useState, useEffect } from 'react';
import { DumpItem } from '../utils/db';

export function useModals() {
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);

  const [folderPrompt, setFolderPrompt] = useState({
    visible: false,
    name: '',
  });

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
    onConfirm: () => {},
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

  return {
    previewPhotoId, setPreviewPhotoId,
    folderPrompt, setFolderPrompt,
    dialog, setDialog,
    showAlert, showConfirm,
    conflictAlert, setConflictAlert,
    contextMenu, setContextMenu,
    editPrompt, setEditPrompt,
  };
}
