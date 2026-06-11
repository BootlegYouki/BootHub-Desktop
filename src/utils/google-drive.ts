import axios from 'axios';
import { getSetting, saveSetting, deleteSetting } from './db';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

// Google OAuth client credentials loaded from environment variables
export const CLIENT_ID_WEB = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
export const CLIENT_SECRET_WEB = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';

const SECURE_KEYS = {
  ACCESS_TOKEN: 'boothub_google_access_token',
  REFRESH_TOKEN: 'boothub_google_refresh_token',
  EXPIRES_AT: 'boothub_google_token_expires_at',
  USER_INFO: 'boothub_google_user_info',
};

export const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

export interface GoogleUserInfo {
  email: string;
  name: string;
  picture?: string;
}

// PKCE Cryptographic Helpers
export const generateCodeVerifier = (): string => {
  const array = new Uint32Array(56);
  crypto.getRandomValues(array);
  return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
};

const sha256 = async (plain: string): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return await crypto.subtle.digest('SHA-256', data);
};

const base64urlencode = (a: ArrayBuffer): string => {
  const bytes = new Uint8Array(a);
  let str = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const generateCodeChallenge = async (verifier: string): Promise<string> => {
  const hashed = await sha256(verifier);
  return base64urlencode(hashed);
};

export const initiateOAuthFlow = async (): Promise<void> => {
  // 1. Generate PKCE values
  const verifier = generateCodeVerifier();
  localStorage.setItem('boothub_oauth_verifier', verifier);
  const challenge = await generateCodeChallenge(verifier);

  // 2. Start local Rust loopback server
  await invoke('start_oauth_server');

  // 3. Open system web browser
  const redirectUri = 'http://localhost:14200/oauth2redirect';
  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const authUrl = `${discovery.authorizationEndpoint}?client_id=${CLIENT_ID_WEB}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&code_challenge=${challenge}&code_challenge_method=S256`;

  await openUrl(authUrl);
};

export const saveAuthSession = async (
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number,
  userInfo: GoogleUserInfo | null
): Promise<void> => {
  const expiresAt = Date.now() + expiresIn * 1000;
  await saveSetting(SECURE_KEYS.ACCESS_TOKEN, accessToken);
  if (refreshToken) {
    await saveSetting(SECURE_KEYS.REFRESH_TOKEN, refreshToken);
  }
  await saveSetting(SECURE_KEYS.EXPIRES_AT, String(expiresAt));
  if (userInfo) {
    await saveSetting(SECURE_KEYS.USER_INFO, JSON.stringify(userInfo));
  }
};

export const clearAuthSession = async (): Promise<void> => {
  await deleteSetting(SECURE_KEYS.ACCESS_TOKEN);
  await deleteSetting(SECURE_KEYS.REFRESH_TOKEN);
  await deleteSetting(SECURE_KEYS.EXPIRES_AT);
  await deleteSetting(SECURE_KEYS.USER_INFO);
  cachedSyncFolderId = null;
  subFolderIdCache.clear();
};

export const getGoogleUserInfo = async (): Promise<GoogleUserInfo | null> => {
  try {
    const info = await getSetting<string>(SECURE_KEYS.USER_INFO);
    return info ? JSON.parse(info) : null;
  } catch {
    return null;
  }
};

export const isUserSignedIn = async (): Promise<boolean> => {
  try {
    const token = await getSetting<string>(SECURE_KEYS.REFRESH_TOKEN);
    return !!token;
  } catch {
    return false;
  }
};

export const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  try {
    const res = await axios.post(
      discovery.tokenEndpoint,
      new URLSearchParams({
        client_id: CLIENT_ID_WEB,
        client_secret: CLIENT_SECRET_WEB,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const accessToken = res.data.access_token;
    const expiresIn = res.data.expires_in || 3600;
    await saveSetting(SECURE_KEYS.ACCESS_TOKEN, accessToken);
    const expiresAt = Date.now() + expiresIn * 1000;
    await saveSetting(SECURE_KEYS.EXPIRES_AT, String(expiresAt));

    return accessToken;
  } catch (err) {
    console.error('Failed to refresh Google access token:', err);
    throw err;
  }
};

export const getValidAccessToken = async (): Promise<string | null> => {
  try {
    const refreshToken = await getSetting<string>(SECURE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;

    const accessToken = await getSetting<string>(SECURE_KEYS.ACCESS_TOKEN);
    const expiresAtStr = await getSetting<string>(SECURE_KEYS.EXPIRES_AT);
    const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;

    // Refresh if token is missing or expiring in less than 5 minutes
    if (!accessToken || expiresAt - Date.now() < 5 * 60 * 1000) {
      return await refreshAccessToken(refreshToken);
    }

    return accessToken;
  } catch (err) {
    console.error('Failed to retrieve valid access token:', err);
    return null;
  }
};

export const fetchUserInfo = async (accessToken: string): Promise<GoogleUserInfo> => {
  const res = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    email: res.data.email,
    name: res.data.name,
    picture: res.data.picture,
  };
};

export const exchangeCodeForTokens = async (
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<any> => {
  const res = await axios.post(
    discovery.tokenEndpoint,
    new URLSearchParams({
      client_id: CLIENT_ID_WEB,
      client_secret: CLIENT_SECRET_WEB,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  return {
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || undefined,
    expires_in: res.data.expires_in,
  };
};

// --- Google Drive File Operations ---

let cachedSyncFolderId: string | null = null;
const subFolderIdCache = new Map<string, string>();

export const getOrCreateSyncFolder = async (accessToken: string): Promise<string> => {
  if (cachedSyncFolderId) return cachedSyncFolderId;
  const folderName = 'BootHub_Sync';

  // 1. Search for existing folder
  const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await axios.get(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const files = searchRes.data.files || [];
  if (files.length > 0) {
    cachedSyncFolderId = files[0].id;
    return files[0].id;
  }

  // 2. Create folder if not found
  const createRes = await axios.post(
    'https://www.googleapis.com/drive/v3/files',
    {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  cachedSyncFolderId = createRes.data.id;
  return createRes.data.id;
};

export const getOrCreateSubFolder = async (
  accessToken: string,
  parentFolderId: string,
  folderName: string
): Promise<string> => {
  const cacheKey = `${parentFolderId}:${folderName}`;
  if (subFolderIdCache.has(cacheKey)) {
    return subFolderIdCache.get(cacheKey)!;
  }

  const escapedName = folderName.replace(/'/g, "\\'");
  const query = `name='${escapedName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await axios.get(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const files = searchRes.data.files || [];
  if (files.length > 0) {
    subFolderIdCache.set(cacheKey, files[0].id);
    return files[0].id;
  }

  const createRes = await axios.post(
    'https://www.googleapis.com/drive/v3/files',
    {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  subFolderIdCache.set(cacheKey, createRes.data.id);
  return createRes.data.id;
};

export const uploadJsonToDrive = async (
  accessToken: string,
  parentFolderId: string,
  filename: string,
  content: string,
  existingDriveFileId?: string,
  signal?: AbortSignal
): Promise<string> => {
  let fileId = existingDriveFileId;

  if (!fileId) {
    const metaRes = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      {
        name: filename,
        parents: [parentFolderId],
        mimeType: 'application/json',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal,
      }
    );
    fileId = metaRes.data.id;
  }

  if (!fileId) {
    throw new Error('Failed to create Google Drive file ID.');
  }

  await axios.patch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    content,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal,
    }
  );

  return fileId;
};

export const uploadBinaryToDrive = async (
  accessToken: string,
  parentFolderId: string,
  filename: string,
  fileBlob: Blob,
  mimeType: string,
  existingDriveFileId?: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void
): Promise<string> => {
  let fileId = existingDriveFileId;

  if (!fileId) {
    const metaRes = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      {
        name: filename,
        parents: [parentFolderId],
        mimeType: mimeType || 'application/octet-stream',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal,
      }
    );
    fileId = metaRes.data.id;
  }

  if (!fileId) {
    throw new Error('Failed to resolve Google Drive file ID.');
  }

  await axios.patch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    fileBlob,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType || 'application/octet-stream',
      },
      signal,
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress(progressEvent.loaded / progressEvent.total);
        }
      },
    }
  );

  return fileId;
};

export const deleteFileFromDrive = async (accessToken: string, driveFileId: string): Promise<void> => {
  await axios.delete(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
};

export const ensureFileParent = async (
  accessToken: string,
  fileId: string,
  targetParentId: string
): Promise<void> => {
  const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const parents = res.data.parents || [];
  if (!parents.includes(targetParentId)) {
    const removeParents = parents.join(',');
    await axios.patch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${targetParentId}&removeParents=${removeParents}`,
      {},
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
  }
};

export const fetchAllMetadataFromDrive = async (accessToken: string): Promise<any[]> => {
  const query = `mimeType='application/json' and name contains 'item_' and trashed=false`;
  let allFiles: any[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const requestUrl: string = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&fields=nextPageToken,files(id,name,parents,modifiedTime)&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''
      }`;

    const response: any = await axios.get(requestUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const files = response.data.files || [];
    allFiles = [...allFiles, ...files];
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return allFiles;
};

export const downloadJsonContent = async (accessToken: string, fileId: string): Promise<any> => {
  const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
};

export const downloadBinaryFromDrive = async (accessToken: string, fileId: string): Promise<Blob> => {
  const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: 'blob',
  });
  return res.data;
};
