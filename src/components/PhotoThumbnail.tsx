import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { getLocalBlobUrl, subscribeToLocalBlobUrls } from '../utils/db';

interface PhotoThumbnailProps {
  itemId: string;
}

export const PhotoThumbnail: React.FC<PhotoThumbnailProps> = ({ itemId }) => {
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Subscribe to local blob URL cache for instant previews
  const localBlobUrl = useSyncExternalStore(
    subscribeToLocalBlobUrls,
    () => getLocalBlobUrl(itemId)
  );

  useEffect(() => {
    setError(false);
  }, [itemId]);

  const serverUrl = `http://127.0.0.1:14201/files/${itemId}?retry=${retryKey}`;
  // Use local blob URL if available (instant), otherwise fall back to server
  const imgUrl = localBlobUrl || serverUrl;

  if (error && !localBlobUrl) {
    return (
      <div 
        className="w-full h-full aspect-video bg-black flex items-center justify-center select-none cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          setError(false);
          setRetryKey((k) => k + 1);
        }}
        title="Failed to load thumbnail. Click to retry."
      >
        <ImageIcon size={24} className="text-zinc-700" />
      </div>
    );
  }

  return (
    <div className="w-full h-full aspect-video bg-black flex items-center justify-center overflow-hidden select-none">
      <img
        key={imgUrl}
        src={imgUrl}
        alt="thumbnail"
        className="w-full h-full object-cover bg-black"
        onError={() => {
          // Only set error if we don't have a local blob to show
          if (!localBlobUrl) {
            setError(true);
          }
        }}
      />
    </div>
  );
};
