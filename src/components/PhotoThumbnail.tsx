import React, { useState, useEffect } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface PhotoThumbnailProps {
  itemId: string;
}

export const PhotoThumbnail: React.FC<PhotoThumbnailProps> = ({ itemId }) => {
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(false);
  }, [itemId]);

  const imgUrl = `http://127.0.0.1:14201/files/${itemId}?retry=${retryKey}`;

  if (error) {
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
        onError={() => setError(true)}
      />
    </div>
  );
};
