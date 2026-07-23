import React from 'react';
import { useModals } from '../hooks/useModals';
import { useSync } from '../hooks/useSync';
import { useItems } from '../hooks/useItems';
import { useSelectionAndClipboard } from '../hooks/useSelectionAndClipboard';
import { useDragAndDrop } from '../hooks/useDragAndDrop';

// Re-export types so we don't break existing imports
export { ACCENT_COLORS } from '../types';
export type { AccentTheme, TabType } from '../types';

export function useProvideWorkspace() {
  const modals = useModals();
  const sync = useSync(modals);
  const itemsState = useItems(modals);
  const selection = useSelectionAndClipboard(modals, itemsState);
  const dragAndDrop = useDragAndDrop(itemsState);

  return {
    ...modals,
    ...sync,
    ...itemsState,
    ...selection,
    ...dragAndDrop,
  };
}

export const WorkspaceContext = React.createContext<ReturnType<typeof useProvideWorkspace> | null>(null);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const workspace = useProvideWorkspace();
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = React.useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return context;
};
