import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HardDrive, Upload, Loader2, Trash2, Download, File, Image, FileText, Film, Music } from 'lucide-react';
import { listFiles, uploadFile, downloadFile, deleteFile, FileInfo, fetchPublicSettings } from '../lib/api';
import { importKey } from '../lib/crypto';

// Encrypt raw file bytes with AES-256-GCM using the vault key
async function encryptFile(vkCrypto: CryptoKey, data: ArrayBuffer): Promise<{ encrypted: ArrayBuffer; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer.slice(0) as ArrayBuffer }, vkCrypto, data);
  return { encrypted, nonce };
}

async function decryptFile(vkCrypto: CryptoKey, data: ArrayBuffer, nonce: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce.buffer.slice(0) as ArrayBuffer }, vkCrypto, data);
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function FileIcon({ mime }: { mime: string }) {
  const cls = { color: 'var(--text-muted)', flexShrink: 0 };
  if (mime.startsWith('image/')) return <Image size={20} style={{ ...cls, color: '#818cf8' }} />;
  if (mime.startsWith('video/')) return <Film size={20} style={{ ...cls, color: '#f59e0b' }} />;
  if (mime.startsWith('audio/')) return <Music size={20} style={{ ...cls, color: '#10b981' }} />;
  if (mime.includes('pdf') || mime.includes('text')) return <FileText size={20} style={{ ...cls, color: '#60a5fa' }} />;
  return <File size={20} style={cls} />;
}

export function Files({ vaultKeyRaw, jwtToken }: { vaultKeyRaw: Uint8Array; jwtToken: string }) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [maxUploadMb, setMaxUploadMb] = useState(100);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { 
      setFiles(await listFiles(jwtToken)); 
      const pub = await fetchPublicSettings();
      setMaxUploadMb(parseInt(pub.max_upload_mb || '100', 10));
    }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [jwtToken]);

  useEffect(() => { load(); }, [load]);

  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const vk = await importKey(vaultKeyRaw);
      for (const file of Array.from(fileList)) {
        if (file.size > maxUploadMb * 1024 * 1024) {
          throw new Error(`Soubor ${file.name} přesahuje limit ${maxUploadMb} MB.`);
        }
        setUploadProgress(`Šifrování: ${file.name}…`);
        const raw = await file.arrayBuffer();
        const { encrypted, nonce } = await encryptFile(vk, raw);
        const nonceHex = bytesToHex(nonce);
        const blob = new Blob([encrypted], { type: 'application/octet-stream' });
        await uploadFile(jwtToken, blob, file.name, file.type || 'application/octet-stream', nonceHex, undefined, (pct) => {
          setUploadProgress(`Nahrávání: ${file.name} (${pct}%)`);
        });
      }
    } catch (e: any) {
      setError('Chyba při nahrávání: ' + e.message);
    } finally {
      setUploadProgress('');
      setUploading(false);
      await load();
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (f: FileInfo) => {
    try {
      setUploadProgress(`Stahování: ${f.original_name}...`);
      const vk = await importKey(vaultKeyRaw);
      const { blob, nonce, name } = await downloadFile(jwtToken, f.id, (pct) => {
        setUploadProgress(`Stahování: ${f.original_name} (${pct}%)`);
      });
      setUploadProgress(`Dešifrování: ${f.original_name} (může chvíli trvat)...`);
      const encBuf = await blob.arrayBuffer();
      const nonceBytes = hexToBytes(nonce);
      const decrypted = await decryptFile(vk, encBuf, nonceBytes);
      const url = URL.createObjectURL(new Blob([decrypted], { type: f.mime_type }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Chyba při stahování: ' + e.message);
    } finally {
      setUploadProgress('');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Smazat soubor „${name}"?`)) return;
    await deleteFile(jwtToken, id);
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  return (
    <div className="secrets-container">
      <div className="secrets-header">
        <h2><HardDrive size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem' }} /> Moje Soubory</h2>
        <button className="btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {uploading ? <Loader2 size={18} className="spinner" /> : <Upload size={18} />}
          {uploading ? uploadProgress || 'Nahrávám…' : 'Nahrát'}
        </button>
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => handleFileSelect(e.target.files)} />
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: '0.75rem',
          padding: '2rem',
          textAlign: 'center',
          color: dragging ? '#a5b4fc' : 'var(--text-muted)',
          cursor: 'pointer',
          transition: 'all 0.2s',
          marginBottom: '1.5rem',
          background: dragging ? 'rgba(99,102,241,0.05)' : 'transparent'
        }}
      >
        <Upload size={28} style={{ margin: '0 auto 0.5rem', display: 'block', opacity: 0.5 }} />
        <p style={{ margin: 0, fontSize: '0.9rem' }}>Přetáhněte soubory sem nebo klikněte pro výběr</p>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', opacity: 0.6 }}>Max {maxUploadMb} MB na soubor · Vše šifrováno lokálně</p>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '2rem' }}><Loader2 className="spinner" size={32} /></div>}

      {!loading && files.length === 0 && (
        <div className="empty-state"><HardDrive size={48} /><p>Žádné soubory zatím.</p></div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {files.map(f => (
          <div key={f.id} className="card secret-card" style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', height: 'auto' }}>
            <FileIcon mime={f.mime_type} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.original_name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {formatSize(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString('cs-CZ')}
              </div>
            </div>
            <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.75rem', fontSize: '0.82rem' }}
              onClick={() => handleDownload(f)}>
              <Download size={15} /> Stáhnout
            </button>
            <button className="btn-link" style={{ color: '#ef4444', padding: '0.35rem' }} onClick={() => handleDelete(f.id, f.original_name)}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
