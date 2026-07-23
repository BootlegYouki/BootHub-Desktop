import React, { useState, useEffect } from 'react';
import { DumpItem, getItemFile } from '../utils/db';
import { objectUrlCache, getCachedObjectUrl } from './PhotoThumbnail';

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
  const cached = objectUrlCache.get(item.id);
  const [imgUrl, setImgUrl] = useState<string | null>(cached || null);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (cached) return;

    let active = true;

    const loadImg = async () => {
      try {
        const rawBlob = await getItemFile(item.id);
        if (rawBlob && active) {
          const blob = new Blob([rawBlob], { type: 'image/jpeg' });
          const url = getCachedObjectUrl(item.id, blob);
          setImgUrl(url);
        }
      } catch (err) {
        console.error('Failed to load preview:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadImg();

    return () => {
      active = false;
    };
  }, [item.id, cached]);

  return (
    <div
      onClick={() => {
        if (!isContextMenuVisible) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 select-none animate-in fade-in duration-150"
    >
      {loading ? (
        <span className="text-sm text-muted font-bold animate-pulse font-mono">[ Loading Image... ]</span>
      ) : imgUrl ? (
        <img
          src={imgUrl}
          alt="preview"
          className="max-w-[80vw] max-h-[80vh] object-contain select-none shadow-2xl animate-in zoom-in-95 duration-150"
          onContextMenu={(e) => onContextMenu(e, item)}
        />
      ) : (
        <span className="text-sm text-destructive font-bold font-mono bg-[#18181b] border-[1.5px] border-border p-4 shadow-xl">
          Failed to load preview image.
        </span>
      )}
    </div>
  );
};
