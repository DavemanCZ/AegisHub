import { bufferToBase64, base64ToBuffer } from './utils';

const API_BASE = '/api';

export interface EncryptedObject {
  id?: string;
  type: string;
  version: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  updated_at?: string;
}

export async function registerUser(username: string, authToken: string, salt: Uint8Array, encVaultKey: Uint8Array) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      auth_token: authToken,
      salt: bufferToBase64(salt),
      encrypted_vault_key: bufferToBase64(encVaultKey)
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSalt(username: string): Promise<Uint8Array> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return base64ToBuffer(data.salt);
}

export async function verifyLogin(username: string, authToken: string): Promise<{ token: string; encrypted_vault_key: Uint8Array; is_admin: boolean; must_change_password: boolean }> {
  const res = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, auth_token: authToken })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return {
    token: data.token,
    encrypted_vault_key: base64ToBuffer(data.encrypted_vault_key),
    is_admin: data.is_admin || false,
    must_change_password: data.must_change_password || false
  };
}

export async function fetchObjects(token: string): Promise<EncryptedObject[]> {
  const res = await fetch(`${API_BASE}/objects`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  if (!data) return [];
  return data.map((item: any) => ({
    ...item,
    ciphertext: base64ToBuffer(item.ciphertext),
    nonce: base64ToBuffer(item.nonce)
  }));
}

export async function saveObject(token: string, obj: EncryptedObject): Promise<EncryptedObject> {
  const payload = {
    ...obj,
    ciphertext: bufferToBase64(obj.ciphertext),
    nonce: bufferToBase64(obj.nonce)
  };
  
  const res = await fetch(`${API_BASE}/objects`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return {
    ...data,
    ciphertext: base64ToBuffer(data.ciphertext),
    nonce: base64ToBuffer(data.nonce)
  };
}

export async function deleteObject(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/objects?id=${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
}

// Admin API
export interface UserInfo {
  id: string;
  username: string;
  is_admin: boolean;
  created_at: string;
}

export async function fetchUsers(token: string): Promise<UserInfo[]> {
  const res = await fetch(`${API_BASE}/admin/users`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteUser(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/users?id=${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getRegistrationSettings(token: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/admin/settings`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.registration_enabled;
}

export async function toggleRegistration(token: string, enabled: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/settings`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ registration_enabled: enabled })
  });
  if (!res.ok) throw new Error(await res.text());
}

// ---- Files (Cloud) API ----
export interface FileInfo {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  nonce: string;
  created_at: string;
}

export async function verifyToken(token: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/auth/verify`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.ok;
}

export async function fetchPublicSettings(): Promise<{ max_upload_mb: string; registration: string; chat_enabled: string; files_enabled: string; instance_name: string; motd: string }> {
  try {
    const res = await fetch(`${API_BASE}/settings/public`);
    if (!res.ok) return { max_upload_mb: '100', registration: 'true', chat_enabled: 'true', files_enabled: 'true', instance_name: 'Aegis Hub', motd: '' };
    return res.json();
  } catch {
    return { max_upload_mb: '100', registration: 'true', chat_enabled: 'true', files_enabled: 'true', instance_name: 'Aegis Hub', motd: '' };
  }
}

export async function listFiles(token: string): Promise<FileInfo[]> {
  const res = await fetch(`${API_BASE}/files`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadFile(token: string, encBlob: Blob, originalName: string, mimeType: string, nonceHex: string, recipientId?: string, onProgress?: (pct: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('data', encBlob, originalName + '.enc');
    form.append('name', originalName);
    form.append('mime', mimeType);
    form.append('nonce', nonceHex);
    form.append('size', String(encBlob.size));
    if (recipientId) form.append('recipient_id', recipientId);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/files`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error('Network error or interrupted'));
    xhr.send(form);
  });
}

export async function downloadFile(token: string, id: string, onProgress?: (pct: number) => void): Promise<{ blob: Blob; nonce: string; name: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${API_BASE}/files?id=${id}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'blob';

    xhr.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const nonce = xhr.getResponseHeader('X-File-Nonce') || '';
        const name = decodeURIComponent(xhr.getResponseHeader('X-Original-Name') || 'file');
        resolve({ blob: xhr.response, nonce, name });
      } else {
        const reader = new FileReader();
        reader.onload = () => reject(new Error(reader.result as string));
        reader.onerror = () => reject(new Error('Chyba při čtení chybové hlášky'));
        if (xhr.response) {
          reader.readAsText(xhr.response);
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => reject(new Error('Network error or interrupted'));
    xhr.send();
  });
}

export async function deleteFile(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/files?id=${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
}

// ---- Chat API ----
export interface Channel {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
}

export async function fetchChannels(token: string): Promise<Channel[]> {
  const res = await fetch(`${API_BASE}/chat/channels`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createChannel(token: string, name: string, description: string): Promise<Channel> {
  const res = await fetch(`${API_BASE}/chat/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name, description })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChannel(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/channels?id=${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchMessages(token: string, channelId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/chat/messages?channel=${channelId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendMessage(token: string, channelId: string, content: string): Promise<ChatMessage> {
  const res = await fetch(`${API_BASE}/chat/messages?channel=${channelId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChatMessage(token: string, channelId: string, msgId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/messages?channel=${channelId}&id=${msgId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
}

// ---- Direct Messages (DM) API ----
export interface DMMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  sender_username: string;
  content: string;
  read_at: string | null;
  created_at: string;
}

export interface DMConversation {
  user_id: string;
  username: string;
  last_message: string;
  last_at: string;
  unread_count: number;
}

export async function fetchDMConversations(token: string): Promise<{ conversations: DMConversation[]; users: { id: string; username: string }[] }> {
  const res = await fetch('/api/dm/conversations', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchDMMessages(token: string, withUserId: string): Promise<DMMessage[]> {
  const res = await fetch('/api/dm/messages?with=' + withUserId, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendDMMessage(token: string, toUserId: string, content: string): Promise<DMMessage> {
  const res = await fetch('/api/dm/messages?with=' + toUserId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ content })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteDMMessage(token: string, withUserId: string, msgId: string): Promise<void> {
  const res = await fetch(`/api/dm/messages?with=${withUserId}&id=${msgId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await res.text());
}

// ---- Friends API ----
export interface FriendEntry {
  id: string;
  user_id: string;
  username: string;
  status: 'pending' | 'accepted';
  direction: 'sent' | 'received';
  created_at: string;
}

export async function fetchFriends(token: string): Promise<FriendEntry[]> {
  const res = await fetch('/api/friends', { headers: { 'Authorization': 'Bearer ' + token } });
  if (!res.ok) return [];
  return res.json();
}

export async function searchUsers(token: string, query: string): Promise<{ id: string; username: string }[]> {
  if (!query || query.length < 1) return [];
  const res = await fetch(`/api/users?search=${encodeURIComponent(query)}`, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!res.ok) return [];
  return res.json();
}

export async function sendFriendRequest(token: string, userId: string): Promise<void> {
  const res = await fetch('/api/friends', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function respondFriendRequest(token: string, id: string, action: 'accept' | 'decline'): Promise<void> {
  const res = await fetch(`/api/friends?id=${id}&action=${action}`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function removeFriend(token: string, userId: string): Promise<void> {
  await fetch(`/api/friends?user_id=${userId}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token }
  });
}

// ---- Blocks API ----
export async function blockUser(token: string, userId: string): Promise<void> {
  await fetch('/api/blocks', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId })
  });
}

export async function unblockUser(token: string, userId: string): Promise<void> {
  await fetch(`/api/blocks?user_id=${userId}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token }
  });
}

export async function fetchBlockedUsers(token: string): Promise<{ id: string; username: string }[]> {
  const res = await fetch('/api/blocks', { headers: { 'Authorization': 'Bearer ' + token } });
  if (!res.ok) return [];
  return res.json();
}

// ---- Change Password API ----
export async function changePassword(
  token: string,
  oldAuthToken: string,
  newAuthToken: string,
  newEncryptedVaultKey: Uint8Array,
  newSalt: Uint8Array
): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      old_auth_token: oldAuthToken,
      new_auth_token: newAuthToken,
      new_encrypted_vault_key: bufferToBase64(newEncryptedVaultKey),
      new_salt: bufferToBase64(newSalt)
    })
  });
  if (!res.ok) throw new Error(await res.text());
}

// ---- Admin: Force password change ----
export async function forcePasswordChange(token: string, userId: string): Promise<void> {
  await fetch(`/api/admin/users?action=force_change&id=${userId}`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token }
  });
}
