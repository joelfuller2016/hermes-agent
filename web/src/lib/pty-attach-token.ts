const STORAGE_KEY = "hermes.pty.token.chat.tab";

interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type ClaimToken = (token: string) => Promise<(() => void) | null>;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// sessionStorage survives reloads, but browsers copy it when duplicating a tab.
// An exclusive document-lifetime claim distinguishes that copy from a reload.
export function createPtyAttachToken(
  storage: () => TokenStorage,
  claim: ClaimToken,
): (rotate?: boolean) => Promise<string> {
  let token = "";
  let release: (() => void) | null = null;
  let pending = Promise.resolve("");

  const acquire = async (rotate: boolean): Promise<string> => {
    if (token && !rotate) return token;
    let candidate = "";
    if (!rotate) {
      try {
        candidate = storage().getItem(STORAGE_KEY) ?? "";
      } catch {
        // Storage-disabled browsers still reconnect using the in-memory token.
      }
    }
    let acquired: (() => void) | null = null;
    while (!acquired) {
      candidate ||= randomToken();
      acquired = await claim(candidate);
      if (!acquired) candidate = "";
    }
    release?.();
    release = acquired;
    token = candidate;
    try {
      storage().setItem(STORAGE_KEY, token);
    } catch {
      // Keep the document's identity even when persistence is unavailable.
    }
    return token;
  };

  return (rotate = false) => {
    pending = pending.then(() => acquire(rotate), () => acquire(rotate));
    return pending;
  };
}

function claimBrowserToken(token: string): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    void navigator.locks.request(
      `hermes.pty.attach.${token}`,
      { ifAvailable: true },
      (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        // The browser releases this lock when the document is destroyed.
        return new Promise<void>((release) => resolve(release));
      },
    ).catch(reject);
  });
}

let getToken: ReturnType<typeof createPtyAttachToken> | undefined;

export function ptyAttachToken(rotate = false): Promise<string> {
  if (!getToken) {
    // Older browsers without Web Locks use a document-local identity: never
    // adopt a copied token that could disconnect a different tab.
    const hasLocks = Boolean(navigator.locks);
    getToken = createPtyAttachToken(
      () => hasLocks ? window.sessionStorage : {
        getItem: () => null,
        setItem: () => {},
      },
      hasLocks ? claimBrowserToken : async () => () => {},
    );
  }
  return getToken(rotate);
}
