import React, { useState, useEffect } from 'react';

interface ImagePreviewProps {
  file: File;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ file }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!url) return null;
  return <img src={url} alt="preview" className="w-full h-full object-cover" />;
};
