import React, { useState } from 'react';
import { DumpItem } from '../utils/db';

interface PhotoPreviewModalProps {
  item: DumpItem;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent, item: DumpItem) => void;
  isContextMenuVisible: boolean;
}

export const PhotoPreviewModal: React.FC<PhotoPreviewModalProps> = ({
  item,
  onClose,
  onContextMenu,
  isContextMenuVisible,
}) => {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const imgUrl = `http://127.0.0.1:14201/files/${item.id}`;

  return (
    <div
      onClick={() => {
        if (!isContextMenuVisible) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 select-none animate-in fade-in duration-150"
    >
      {loading && !error && (
        <span className="text-sm text-muted font-bold animate-pulse font-mono absolute z-[-1]">[ Loading Image... ]</span>
      )}
      
      {!error ? (
        <img
          src={imgUrl}
          alt="preview"
          className={`max-w-[80vw] max-h-[80vh] object-contain select-none shadow-2xl animate-in zoom-in-95 duration-150 ${loading ? 'opacity-0' : 'opacity-100'}`}
          onContextMenu={(e) => onContextMenu(e, item)}
          onLoad={() => setLoading(false)}
          onError={() => {
            setError(true);
            setLoading(false);
          }}
        />
      ) : (
        <span className="text-sm text-destructive font-bold font-mono bg-[#18181b] border-[1.5px] border-border p-4 shadow-xl">
          Failed to load preview image.
        </span>
      )}
    </div>
  );
};
