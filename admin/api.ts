import { createSignal } from "solid-js";

// Same-origin JSON API with the session's CSRF token on every write. A 401
// anywhere returns the Content Room to sign-in with an explanation.

let csrf = "";
export const [signedIn, setSignedIn] = createSignal<boolean | null>(null);
export const [signInNote, setSignInNote] = createSignal("");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function startSession(token: string) {
  csrf = token;
  setSignInNote("");
  setSignedIn(true);
}

export function endSession(note = "") {
  csrf = "";
  setSignInNote(note);
  setSignedIn(false);
}

export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (csrf && method !== "GET") headers["X-CSRF-Token"] = csrf;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/admin${path}`, {
    method, headers, credentials: "same-origin",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (response.status === 401 && path !== "/login") endSession("Session ended. Sign in again.");
  if (!response.ok) throw new ApiError(response.status, data.error || `Request failed (${response.status})`);
  return data as T;
}

/**
 * Upload one file as the raw request body, reporting progress. The server
 * streams it to disk, so videos never have to fit in memory.
 */
export function uploadFile(kind: "photos" | "videos", shootId: string, file: File, onProgress: (fraction: number) => void, onSent: () => void) {
  return new Promise<{ id: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const query = new URLSearchParams({ shootId, name: file.name });
    request.open("POST", `/api/admin/${kind}/upload?${query}`);
    request.setRequestHeader("X-CSRF-Token", csrf);
    request.setRequestHeader("Content-Type", file.type || (kind === "videos" ? "video/mp4" : "application/octet-stream"));
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.upload.onload = onSent;
    request.onload = () => {
      let data: { id?: string; error?: string } = {};
      try { data = JSON.parse(request.responseText); } catch { /* Not JSON. */ }
      if (request.status === 401) endSession("Session ended. Sign in again.");
      if (request.status >= 200 && request.status < 300 && data.id) resolve({ id: data.id });
      else reject(new ApiError(request.status, data.error || `Upload failed (${request.status})`));
    };
    request.onerror = () => reject(new ApiError(0, "Network error"));
    request.send(file);
  });
}
