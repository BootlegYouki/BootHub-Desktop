import React from 'react';
import { Folder, ArrowUpRight, Link2 } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
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
  viewMode?: 'grid' | 'list';
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
  viewMode = 'grid',
}) => {
  const handleOpenUrl = (url: string) => {
    let targetUrl = url.startsWith('http') ? url : `https://${url}`;
    openUrl(targetUrl).catch(() => {
      window.open(targetUrl, '_blank');
    });
  };

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
      {viewMode === 'list' && (item.type === 'link' || item.type === 'folder') ? (
        <div className={`relative grid grid-cols-[1fr_1fr_140px] gap-4 items-center px-3 py-3 border-[1.5px] bg-card w-full min-w-0 transition-colors ${isSelected ? 'border-primary shadow-[0_0_8px_rgba(168,85,247,0.3)]' : 'border-border hover:border-foreground'} group`}>
           {isSyncing && (
             <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary/20 z-20 overflow-hidden col-span-3">
               <div
                 className="h-full bg-primary transition-all duration-150"
                 style={{ width: `${progress * 100}%` }}
               />
             </div>
           )}
           
           {/* Column 1: Value / URL */}
           <div className="flex items-center gap-3 min-w-0">
             {item.type === 'folder' && <Folder size={16} className="text-primary fill-primary/10 shrink-0 group-hover:scale-110 transition-transform duration-150" />}
             {item.type === 'link' && <Link2 size={16} className="text-primary shrink-0" />}
             
             {item.type === 'folder' && (
                <span className="font-bold text-sm leading-tight group-hover:text-primary truncate block w-full">{item.label || 'New Folder'}</span>
             )}
             
             {item.type === 'link' && (
               <a
                 href={item.value.startsWith('http') ? item.value : `https://${item.value}`}
                 onClick={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   handleOpenUrl(item.value);
                 }}
                 target="_blank"
                 rel="noopener noreferrer"
                 className="text-primary hover:underline text-sm font-bold truncate block w-full"
               >
                 {item.value}
               </a>
             )}
           </div>
           
           {(() => {
             let dateStr = '';
             const tsStr = item.id.split('_')[0];
             const ts = parseInt(tsStr, 10);
             if (!isNaN(ts) && ts > 1000000000000) {
               const d = new Date(ts);
               const pad = (n: number) => n.toString().padStart(2, '0');
               dateStr = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()} @ ${pad(d.getHours())}:${pad(d.getMinutes())}`;
             }
             
             const displayLabel = item.label === dateStr ? '-' : item.label;

             return (
               <>
                 {/* Column 2: Label / Title */}
                 {item.type !== 'folder' ? (
                   <div className="min-w-0">
                     {item.type === 'link' ? (
                       <LinkPreview url={item.value.startsWith('http') ? item.value : `https://${item.value}`} mode="inline" />
                     ) : (
                       <span className="text-[11px] text-muted font-mono font-bold truncate block">{displayLabel}</span>
                     )}
                   </div>
                 ) : <div />}
                 
                 {/* Column 3: Date */}
                 {item.type !== 'folder' ? (
                   <div className="min-w-0 text-right">
                     <span className="text-[11px] text-muted font-mono font-bold truncate block">{dateStr || item.label}</span>
                   </div>
                 ) : <div />}
               </>
             );
           })()}
        </div>
      ) : item.type === 'photo' ? (
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
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary/20 z-20 overflow-hidden">
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
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary/20 overflow-hidden">
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
                    e.stopPropagation();
                    handleOpenUrl(item.value);
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
                  {(() => {
                    try { return JSON.parse(item.value).name; } catch { return item.value; }
                  })()}
                </p>
                <p className="text-[10px] text-muted flex items-center justify-between">
                  <span>
                    {(() => {
                      try {
                        const bytes = JSON.parse(item.value).size || 0;
                        if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
                        if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
                        return (bytes / 1024).toFixed(1) + ' KB';
                      } catch {
                        return '';
                      }
                    })()}
                  </span>
                  {isSyncing && (
                    <span className="font-mono text-primary font-bold">
                      {Math.round(progress * 100)}%
                    </span>
                  )}
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
