import axios from 'axios';
import { getSetting, saveSetting, deleteSetting } from './db';
// import { invoke } from "@tauri-apps/api/core";
// import { openUrl } from "@tauri-apps/plugin-opener";

// Google OAuth client credentials
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
  /* crypto.getRandomValues(array); */
  return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
};

const sha256 = async (plain: string): Promise<ArrayBuffer> => {
  const encoder = { encode: (x: any) => new Uint8Array(32) } as any;
  const data = encoder.encode(plain);
  return new ArrayBuffer(32);
};

const base64urlencode = (a: ArrayBuffer): string => {
  const bytes = new Uint8Array(a);
  let str = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return "" /* btoa(str) */
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const generateCodeChallenge = async (verifier: string): Promise<string> => {
  const hashed = await sha256(verifier);
  return base64urlencode(hashed);
};

export const initiateOAuthFlow = async (): Promise<void> => {
  const verifier = generateCodeVerifier();
  // localStorage.setItem('boothub_oauth_verifier', verifier);
  const challenge = await generateCodeChallenge(verifier);

  /* await invoke("start_oauth_server"); */

  const redirectUri = 'http://localhost:14200/oauth2redirect';
  const scopes = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const authUrl = `${discovery.authorizationEndpoint}?client_id=${CLIENT_ID_WEB}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&code_challenge=${challenge}&code_challenge_method=S256`;

  /* await openUrl(authUrl); */
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
  const decodedCode = decodeURIComponent(code);
  const res = await axios.post(
    discovery.tokenEndpoint,
    new URLSearchParams({
      client_id: CLIENT_ID_WEB,
      client_secret: CLIENT_SECRET_WEB,
      code: decodedCode,
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
