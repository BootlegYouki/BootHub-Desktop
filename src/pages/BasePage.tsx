import React from 'react';
import { TuiContainer } from '../components/TuiContainer';
import { ItemCard } from '../components/ItemCard';
import { DumpItem, fileProgressMap, subscribeToFileProgress } from '../utils/db';

export type TabType = 'link' | 'text' | 'photo' | 'file';

export interface ClipboardState {
  type: 'copy' | 'cut';
  itemIds: Set<string>;
}

export interface DragBoxState {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface BasePageProps {
  activeTab: TabType;
  items: DumpItem[];
  folders: DumpItem[];
  normalItems: DumpItem[];
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  clipboard: ClipboardState | null;
  contextMenuVisible: boolean;
  dragActive: boolean;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleCardContextMenu: (e: React.MouseEvent, item: DumpItem) => void;
  handleCardClick: (e: React.MouseEvent, item: DumpItem) => void;
  handleCardDoubleClick: (e: React.MouseEvent, item: DumpItem) => void;
  getFolderName: (item: DumpItem) => string;
}

export const BasePage: React.FC<BasePageProps> = ({
  activeTab,
  folders,
  normalItems,
  selectedIds,
  setSelectedIds,
  clipboard,
  contextMenuVisible,
  dragActive,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleCardContextMenu,
  handleCardClick,
  handleCardDoubleClick,
}) => {
  const [dragBox, setDragBox] = React.useState<DragBoxState>({
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  React.useEffect(() => {
    const handleGlobalMouseUp = () => {
      setDragBox((prev) => {
        if (prev.active) return { ...prev, active: false };
        return prev;
      });
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const [, setProgressTick] = React.useState(0);

  React.useEffect(() => {
    return subscribeToFileProgress(() => {
      setProgressTick((v) => v + 1);
    });
  }, []);

  return (
    <TuiContainer
      label="Main"
      accentBorder={dragActive}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}
      contentStyle={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, padding: '12px' }}
    >
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const target = e.target as HTMLElement;
          if (target.closest('.item-card') || target.closest('button') || target.closest('input') || target.closest('textarea')) {
            return;
          }
          if (!e.ctrlKey && !e.shiftKey) {
            setSelectedIds(new Set());
          }
          setDragBox({
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
          });
        }}
        onMouseMove={(e) => {
          if (!dragBox.active) return;
          const currentX = e.clientX;
          const currentY = e.clientY;
          setDragBox(prev => ({ ...prev, currentX, currentY }));

          const left = Math.min(dragBox.startX, currentX);
          const top = Math.min(dragBox.startY, currentY);
          const right = Math.max(dragBox.startX, currentX);
          const bottom = Math.max(dragBox.startY, currentY);

          const cardElements = document.querySelectorAll('.item-card');
          const newSelected = new Set<string>();

          cardElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            const id = el.getAttribute('data-id');
            if (!id) return;
            const intersect = !(
              rect.right < left ||
              rect.left > right ||
              rect.bottom < top ||
              rect.top > bottom
            );
            if (intersect) {
              newSelected.add(id);
            }
          });
          setSelectedIds(newSelected);
        }}
        onMouseUp={() => {
          setDragBox(prev => ({ ...prev, active: false }));
        }}
        className={`flex-1 flex flex-col p-4 min-h-0 min-w-0 ${contextMenuVisible ? 'overflow-hidden' : 'overflow-y-auto'}`}
      >
        <div className="flex-1 min-h-0">
          {folders.length === 0 && normalItems.length === 0 && activeTab !== 'file' ? (
            <div className="h-full flex items-center justify-center text-muted text-sm select-none">
              No {activeTab}s dumped yet.
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {/* Folders Section */}
              {folders.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {folders.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      isSyncing={item.syncState === 'syncing' || fileProgressMap.has(item.id)}
                      progress={fileProgressMap.get(item.id) || 0}
                      isSelected={selectedIds.has(item.id)}
                      isCut={clipboard?.type === 'cut' && clipboard.itemIds.has(item.id)}
                      onContextMenu={handleCardContextMenu}
                      onClick={handleCardClick}
                      onDoubleClick={handleCardDoubleClick}
                    />
                  ))}
                </div>
              )}

              {/* Items Section */}
              {normalItems.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {normalItems.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      isSyncing={item.syncState === 'syncing' || fileProgressMap.has(item.id)}
                      progress={fileProgressMap.get(item.id) || 0}
                      isSelected={selectedIds.has(item.id)}
                      isCut={clipboard?.type === 'cut' && clipboard.itemIds.has(item.id)}
                      onContextMenu={handleCardContextMenu}
                      onClick={handleCardClick}
                      onDoubleClick={handleCardDoubleClick}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* DRAG SELECTION BOUNDING BOX */}
      {dragBox.active && (
        <div
          style={{
            position: 'fixed',
            left: `${Math.min(dragBox.startX, dragBox.currentX)}px`,
            top: `${Math.min(dragBox.startY, dragBox.currentY)}px`,
            width: `${Math.abs(dragBox.startX - dragBox.currentX)}px`,
            height: `${Math.abs(dragBox.startY - dragBox.currentY)}px`,
            zIndex: 999999,
          }}
          className="border-[1.5px] border-primary bg-primary/10 pointer-events-none"
        />
      )}
    </TuiContainer>
  );
};
