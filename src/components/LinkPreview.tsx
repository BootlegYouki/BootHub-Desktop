import React, { useState, useEffect } from 'react';
import axios from 'axios';

export interface PreviewData {
  image: string | null;
  title: string | null;
  description: string | null;
}

interface LinkPreviewProps {
  url: string;
}

export const previewCache = new Map<string, PreviewData | null>();

const getStorageKeyForUrl = (url: string) => {
  return `@boothub_preview_cache:${encodeURIComponent(url)}`;
};

const decodeHtmlEntities = (str: string) => {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#064;/g, '@')
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
};

const extractMetaTags = (html: string): { [key: string]: string } => {
  const metaTags: { [key: string]: string } = {};
  const metaRegex = /<meta\s+([^>]+)>/gi;
  let match;
  
  while ((match = metaRegex.exec(html)) !== null) {
    const content = match[1];
    const propertyMatch = content.match(/(?:property|name)=["']([^"']+)["']/i);
    const contentMatch = content.match(/content=["']([^"']+)["']/i);
    
    if (propertyMatch && contentMatch) {
      const key = propertyMatch[1].toLowerCase();
      const val = contentMatch[1];
      metaTags[key] = val;
    }
  }
  
  return metaTags;
};

const isDirectImageUrl = (url: string) => {
  return (
    /\.(?:jpg|jpeg|png|webp|gif)(?:\?.*)?$/i.test(url) ||
    url.includes('images.unsplash.com')
  );
};

export const LinkPreview: React.FC<LinkPreviewProps> = ({ url }) => {
  const [loading, setLoading] = useState<boolean>(() => !previewCache.has(url));
  const [data, setData] = useState<PreviewData | null>(() => previewCache.get(url) || null);

  useEffect(() => {
    let active = true;
    let timeoutId: any = null;
    const controller = new AbortController();

    const fetchMetadata = async () => {
      if (previewCache.has(url)) {
        if (active) {
          setData(previewCache.get(url) || null);
          setLoading(false);
        }
        return;
      }

      if (isDirectImageUrl(url)) {
        const filename = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
        const directData: PreviewData = {
          image: url,
          title: filename || 'Direct Image',
          description: 'Direct Image Link',
        };
        previewCache.set(url, directData);
        if (active) {
          setData(directData);
          setLoading(false);
        }
        return;
      }

      // Check localStorage cache
      const cacheKey = getStorageKeyForUrl(url);
      try {
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw) as PreviewData;
          previewCache.set(url, parsed);
          if (active) {
            setData(parsed);
            setLoading(false);
          }
          return;
        }
      } catch (e) {
        console.warn('Failed to read persistent preview cache:', e);
      }

      // Scrape Webpage (CORS-free due to Tauri fetch adapter bound to axios)
      try {
        setLoading(true);

        timeoutId = setTimeout(() => {
          if (active) {
            controller.abort();
            setLoading(false);
            setData(null);
          }
        }, 3000);

        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          responseType: 'text',
          signal: controller.signal
        });

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const html = response.data;

        const metaTags = extractMetaTags(html);
        
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const htmlTitle = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null;
        const ogTitle = metaTags['og:title'] || metaTags['twitter:title'];
        const title = ogTitle ? decodeHtmlEntities(ogTitle) : htmlTitle;
        
        const ogDesc = metaTags['og:description'] || metaTags['twitter:description'] || metaTags['description'];
        const description = ogDesc ? decodeHtmlEntities(ogDesc) : null;
        
        const ogImage = metaTags['og:image'] || metaTags['twitter:image'];
        const image = ogImage ? decodeHtmlEntities(ogImage) : null;

        const parsedData: PreviewData = {
          image,
          title,
          description,
        };

        const isValidData = !!(parsedData.image || parsedData.title);
        const finalData = isValidData ? parsedData : null;

        previewCache.set(url, finalData);

        if (finalData) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(finalData));
          } catch (e) {
            console.warn('Failed to save to persistent preview cache:', e);
          }
        }
        
        if (active) {
          setData(finalData);
        }
      } catch (err) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        console.warn('Failed to load link preview for:', url, err);
        previewCache.set(url, null);
        if (active) setData(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchMetadata();

    return () => {
      active = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      controller.abort();
    };
  }, [url]);

  if (loading) {
    return (
      <div className="mt-2 border-t-[1.5px] border-border/40 pt-2 flex flex-col gap-2 animate-pulse select-none">
        <div className="w-full aspect-[21/9] bg-zinc-800/40 border-[1.5px] border-border/40" />
        <div className="bg-[#18181b]/35 dark:bg-[#18181b]/10 p-2 border-[1.5px] border-border/30 flex flex-col gap-2">
          <div className="h-3 bg-zinc-800/50 w-2/3" />
          <div className="h-2 bg-zinc-800/40 w-6/6" />
          <div className="h-2 bg-zinc-800/40 w-6/6" />
          <div className="h-2 bg-zinc-800/40 w-5/6" />
        </div>
      </div>
    );
  }

  const previewData = data || { image: null, title: null, description: null };

  return (
    <div className="mt-2 border-t-[1.5px] border-border/40 pt-2 flex flex-col gap-2 select-none">
      {previewData.image ? (
        <div className="w-full aspect-[21/9] border-[1.5px] border-border bg-black overflow-hidden flex items-center justify-center">
          <img
            src={previewData.image}
            alt="Link Preview"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      ) : (
        <div className="w-full aspect-[21/9] border-[1.5px] border-border/30 bg-[#27272a]/30" />
      )}
      <div className="dark:bg-[#18181b]/5 p-2 border-[1.5px] border-border/30 flex flex-col gap-2 min-h-[58px] justify-between">
        {previewData.title ? (
          <h5 className="font-bold text-[13px] text-primary truncate leading-normal">
            {previewData.title}
          </h5>
        ) : (
          <div className="h-3 bg-[#27272a]/40 w-2/3 my-0.5" />
        )}
        {previewData.description ? (
          <p className="text-[12px] text-primary line-clamp-2 leading-relaxed">
            {previewData.description}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5 py-0.5">
            <div className="h-2 bg-[#27272a]/30 w-6/6" />
            <div className="h-2 bg-[#27272a]/30 w-6/6" />
            <div className="h-2 bg-[#27272a]/20 w-2/3" />
          </div>
        )}
      </div>
    </div>
  );
};
