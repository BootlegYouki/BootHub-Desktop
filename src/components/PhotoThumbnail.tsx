import React, { useState, useEffect } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { getItemFile } from '../utils/db';

interface PhotoThumbnailProps {
  itemId: string;
}

// Memory cache for object URLs of photo/file items to avoid flicker & load instantly
export const objectUrlCache = new Map<string, string>();

export const getCachedObjectUrl = (itemId: string, blob: Blob): string => {
  let cached = objectUrlCache.get(itemId);
  if (!cached) {
    cached = URL.createObjectURL(blob);
    objectUrlCache.set(itemId, cached);
  }
  return cached;
};

export const revokeCachedObjectUrl = (itemId: string) => {
  const cached = objectUrlCache.get(itemId);
  if (cached) {
    URL.revokeObjectURL(cached);
    objectUrlCache.delete(itemId);
  }
};

export const PhotoThumbnail: React.FC<PhotoThumbnailProps> = ({ itemId }) => {
  const cached = objectUrlCache.get(itemId);
  const [imgUrl, setImgUrl] = useState<string | null>(cached || null);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (cached) return;

    let active = true;

    const loadImg = async () => {
      try {
        const blob = await getItemFile(itemId);
        if (blob && active) {
          const url = getCachedObjectUrl(itemId, blob);
          setImgUrl(url);
        }
      } catch (err) {
        console.error('Failed to load thumbnail:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadImg();

    return () => {
      active = false;
    };
  }, [itemId, cached]);

  if (loading) {
    return (
      <div className="w-full h-full aspect-video bg-card flex items-center justify-center select-none">
        <span className="text-[10px] text-muted font-bold animate-pulse">[ Loading... ]</span>
      </div>
    );
  }

  if (!imgUrl) {
    return (
      <div className="w-full h-full aspect-video bg-black flex items-center justify-center select-none">
        <ImageIcon size={24} className="text-zinc-700" />
      </div>
    );
  }

  return (
    <div className="w-full h-full aspect-video bg-black flex items-center justify-center overflow-hidden select-none">
      <img
        src={imgUrl}
        alt="thumbnail"
        className="w-full h-full object-cover"
      />
    </div>
  );
};
