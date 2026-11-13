const NICKNAME_KEY = 'pool8_nickname';
const NICKNAME_EVENT = 'pool8-nickname-change';
const SESSION_TOKEN_KEY = 'pool8_tab_session_token';

export function getOrCreateTabSessionToken(): string {
  if (typeof window === 'undefined') return 'ssr-placeholder-token';
  let tok = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (!tok || tok.length < 8) {
    tok =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, tok);
  }
  return tok;
}

export function getSavedNickname(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(NICKNAME_KEY) ?? '';
}

export function saveNickname(name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = name.trim();
  if (trimmed.length >= 2) {
    window.localStorage.setItem(NICKNAME_KEY, trimmed.slice(0, 24));
    window.dispatchEvent(new Event(NICKNAME_EVENT));
  }
}

export function subscribeSavedNickname(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === null || ev.key === NICKNAME_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(NICKNAME_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(NICKNAME_EVENT, onStoreChange);
  };
}

export function getWebSocketUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
