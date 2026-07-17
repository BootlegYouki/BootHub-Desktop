import React from 'react';
import { Folder, ArrowUpRight } from 'lucide-react';
import { TuiContainer } from './TuiContainer';
import { LinkPreview } from './LinkPreview';
import { PhotoThumbnail } from './PhotoThumbnail';
import { DumpItem } from '../utils/db';

interface ItemCardProps {
  item: DumpItem;
  isSyncing: boolean;
  progress: number;
  isSelected: boolean;
  isCut: boolean;
  onContextMenu: (e: React.MouseEvent, item: DumpItem) => void;
  onClick: (e: React.MouseEvent, item: DumpItem) => void;
  onDoubleClick: (e: React.MouseEvent, item: DumpItem) => void;
}

export const ItemCard: React.FC<ItemCardProps> = React.memo(({
  item,
  isSyncing,
  progress,
  isSelected,
  isCut,
  onContextMenu,
  onClick,
  onDoubleClick,
}) => {
  return (
    <div
      data-id={item.id}
      className={`item-card relative animate-in fade-in duration-200 select-none transition-all ${
        isSelected ? 'bg-primary/5' : ''
      } ${isCut ? 'opacity-40 border-dashed border-primary/50' : ''}`}
      onContextMenu={(e) => onContextMenu(e, item)}
      onClick={(e) => onClick(e, item)}
      onDoubleClick={(e) => onDoubleClick(e, item)}
    >
      {item.type === 'photo' ? (
        <div
          className={`w-full h-full relative border-[1.5px] bg-card transition-all ${
            isSelected
              ? 'border-primary shadow-[0_0_8px_rgba(168,85,247,0.3)]'
              : 'border-border hover:border-foreground'
          }`}
          title="Double click to view full preview"
        >
          {/* Sync Progress Bar */}
          {isSyncing && (
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary/20 z-20">
              <div
                className="h-full bg-primary transition-all duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          <PhotoThumbnail itemId={item.id} />
        </div>
      ) : (
        <TuiContainer
          label={item.type === 'folder' ? '' : item.label}
          accentBorder={isSyncing || isSelected}
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          contentStyle={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
        >
          {/* Sync Progress Bar */}
          {isSyncing && (
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary/20">
              <div
                className="h-full bg-primary transition-all duration-150"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          <div className="flex flex-col gap-3 h-full justify-between flex-1">
            {/* Content area */}
            {item.type === 'folder' ? (
              <div className="flex items-center gap-3 text-left w-full hover:text-primary group">
                <Folder size={16} className="text-primary fill-primary/10 group-hover:scale-110 transition-transform duration-150" />
                <span className="font-bold text-sm leading-tight">{item.label || 'New Folder'}</span>
              </div>
            ) : item.type === 'link' ? (
              <div className="flex flex-col gap-1">
                <a
                  href={item.value.startsWith('http') ? item.value : `https://${item.value}`}
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-sm font-bold flex items-center justify-between gap-1.5 w-full min-w-0"
                >
                  <span className="truncate flex-1 min-w-0">{item.value}</span>
                  <ArrowUpRight size={14} className="shrink-0" />
                </a>
                <LinkPreview url={item.value.startsWith('http') ? item.value : `https://${item.value}`} />
              </div>
            ) : item.type === 'text' ? (
              <p className="text-xs leading-relaxed text-foreground break-all whitespace-pre-wrap select-text">
                {item.value}
              </p>
            ) : (
              // File
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-bold leading-tight truncate">
                  {JSON.parse(item.value).name}
                </p>
                <p className="text-[10px] text-muted">
                  {(JSON.parse(item.value).size / 1024).toFixed(1)} KB
                </p>
              </div>
            )}
          </div>
        </TuiContainer>
      )}
    </div>
  );
});

ItemCard.displayName = 'ItemCard';
