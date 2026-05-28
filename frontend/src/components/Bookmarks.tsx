import React, { useState, useEffect } from 'react';
import { Bookmark, Plus, RefreshCw, Loader2, Trash2, Edit2, ExternalLink, Link } from 'lucide-react';
import { fetchObjects, saveObject, deleteObject, EncryptedObject } from '../lib/api';
import { encryptData, decryptData, importKey } from '../lib/crypto';

interface BookmarkData {
  title: string;
  url: string;
  description?: string;
  tags?: string[];
}

interface DecryptedBookmark {
  id: string;
  data: BookmarkData;
  updatedAt: string;
}

export function Bookmarks({ vaultKeyRaw, jwtToken }: { vaultKeyRaw: Uint8Array, jwtToken: string }) {
  const [bookmarks, setBookmarks] = useState<DecryptedBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newBookmark, setNewBookmark] = useState<BookmarkData>({ title: '', url: '', description: '', tags: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const loadBookmarks = async () => {
    setLoading(true);
    setError('');
    try {
      const vkCrypto = await importKey(vaultKeyRaw);
      const objects = await fetchObjects(jwtToken);
      const bmObjects = objects.filter(o => o.type === 'aegis.bookmark');

      const decryptedList: DecryptedBookmark[] = [];
      for (const obj of bmObjects) {
        try {
          const plaintext = await decryptData(vkCrypto, obj.ciphertext, obj.nonce);
          const data = JSON.parse(plaintext) as BookmarkData;
          decryptedList.push({ id: obj.id!, data, updatedAt: obj.updated_at || '' });
        } catch (err) {
          console.error('Nelze dešifrovat záložku', obj.id);
        }
      }
      decryptedList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setBookmarks(decryptedList);
    } catch (err: any) {
      setError('Nelze načíst záložky. Zkontrolujte připojení.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBookmarks(); }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Ensure URL has a protocol
      let url = newBookmark.url.trim();
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const bookmarkToSave = { ...newBookmark, url };

      const vkCrypto = await importKey(vaultKeyRaw);
      const plaintext = JSON.stringify(bookmarkToSave);
      const { ciphertext, nonce } = await encryptData(vkCrypto, plaintext);

      const objToSave: EncryptedObject = {
        type: 'aegis.bookmark',
        version: 1,
        ciphertext,
        nonce
      };
      if (editingId) objToSave.id = editingId;

      await saveObject(jwtToken, objToSave);
      setShowAdd(false);
      setEditingId(null);
      setNewBookmark({ title: '', url: '', description: '', tags: [] });
      setTagInput('');
      await loadBookmarks();
    } catch (err: any) {
      alert('Chyba při ukládání: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Opravdu chcete smazat tuto záložku?')) return;
    try {
      await deleteObject(jwtToken, id);
      setBookmarks(bookmarks.filter(b => b.id !== id));
    } catch (err: any) {
      alert('Chyba při mazání: ' + err.message);
    }
  };

  const startEdit = (b: DecryptedBookmark) => {
    setNewBookmark({ ...b.data, tags: b.data.tags || [] });
    setEditingId(b.id);
    setShowAdd(true);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    if ((newBookmark.tags || []).includes(tag)) { setTagInput(''); return; }
    setNewBookmark(prev => ({ ...prev, tags: [...(prev.tags || []), tag] }));
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setNewBookmark(prev => ({ ...prev, tags: (prev.tags || []).filter(t => t !== tag) }));
  };

  const allTags = Array.from(new Set(bookmarks.flatMap(b => b.data.tags || [])));
  const filteredBookmarks = activeTag
    ? bookmarks.filter(b => (b.data.tags || []).includes(activeTag))
    : bookmarks;

  const getFavicon = (url: string) => {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch { return null; }
  };

  return (
    <div className="secrets-container">
      <div className="secrets-header">
        <h2><Bookmark size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem' }} /> Moje Záložky</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={loadBookmarks} title="Obnovit">
            <RefreshCw size={18} className={loading ? 'spinner' : ''} />
          </button>
          <button className="btn-primary" onClick={() => { setShowAdd(true); setEditingId(null); setNewBookmark({ title: '', url: '', description: '', tags: [] }); }}>
            <Plus size={18} /> Přidat
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      {showAdd && (
        <div className="card add-secret-card">
          <h3>{editingId ? 'Upravit záložku' : 'Nová záložka'}</h3>
          <form onSubmit={handleSave} className="auth-form">
            <input type="text" placeholder="Název záložky (např. GitHub)" value={newBookmark.title} onChange={e => setNewBookmark({ ...newBookmark, title: e.target.value })} required className="input-field" autoFocus />
            <input type="text" placeholder="URL (např. github.com)" value={newBookmark.url} onChange={e => setNewBookmark({ ...newBookmark, url: e.target.value })} required className="input-field" />
            <textarea
              placeholder="Popis (volitelný)..."
              value={newBookmark.description}
              onChange={e => setNewBookmark({ ...newBookmark, description: e.target.value })}
              className="input-field"
              style={{ minHeight: '80px', resize: 'vertical' }}
            />
            {/* Tag input */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Přidat štítek (Enter)"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  className="input-field"
                  style={{ margin: 0, flex: 1 }}
                />
                <button type="button" className="btn-secondary" onClick={addTag} style={{ whiteSpace: 'nowrap' }}>Přidat</button>
              </div>
              {(newBookmark.tags || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {(newBookmark.tags || []).map(tag => (
                    <span key={tag} onClick={() => removeTag(tag)} style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '999px', padding: '0.15rem 0.6rem', fontSize: '0.75rem', color: '#a5b4fc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      #{tag} ×
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>{editingId ? 'Uložit změny' : 'Zašifrovat a Uložit'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setShowAdd(false); setEditingId(null); setTagInput(''); }}>Zrušit</button>
            </div>
          </form>
        </div>
      )}

      {loading && !showAdd && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}><Loader2 className="spinner" size={32} /></div>}

      {!loading && bookmarks.length === 0 && !showAdd && (
        <div className="empty-state">
          <Bookmark size={48} />
          <p>Zatím zde nemáte žádné záložky.</p>
        </div>
      )}

      {/* Tag filter chips */}
      {allTags.length > 0 && !showAdd && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center', marginRight: '0.25rem' }}>Filtr:</span>
          {allTags.map(tag => (
            <button key={tag} type="button"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              style={{ background: activeTag === tag ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.1)', border: `1px solid ${activeTag === tag ? 'rgba(99,102,241,0.7)' : 'rgba(99,102,241,0.3)'}`, borderRadius: '999px', padding: '0.15rem 0.65rem', fontSize: '0.75rem', color: activeTag === tag ? '#c4b5fd' : '#818cf8', cursor: 'pointer' }}>
              #{tag}
            </button>
          ))}
          {activeTag && <button type="button" onClick={() => setActiveTag(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}>✕ Zrušit filtr</button>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filteredBookmarks.map(b => {
          const favicon = getFavicon(b.data.url);
          return (
            <div key={b.id} className="card secret-card" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '1rem', height: 'auto' }}>
              {/* Favicon */}
              <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '8px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '0.1rem' }}>
                {favicon
                  ? <img src={favicon} alt="" width={20} height={20} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <Link size={16} style={{ color: 'var(--text-muted)' }} />
                }
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.data.title}</h4>
                  <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                    <a href={b.data.url} target="_blank" rel="noopener noreferrer" className="btn-link" style={{ padding: '0.25rem' }} title="Otevřít"><ExternalLink size={15} /></a>
                    <button className="btn-link" style={{ padding: '0.25rem' }} onClick={() => startEdit(b)} title="Upravit"><Edit2 size={15} /></button>
                    <button className="btn-link" style={{ padding: '0.25rem', color: '#ef4444' }} onClick={() => handleDelete(b.id)} title="Smazat"><Trash2 size={15} /></button>
                  </div>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#6366f1', marginBottom: '0.3rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.data.url}</div>
                {b.data.description && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem', lineHeight: '1.4' }}>{b.data.description}</div>}
                {(b.data.tags || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {(b.data.tags || []).map(tag => (
                      <span key={tag} style={{ background: 'rgba(99,102,241,0.15)', borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.7rem', color: '#818cf8' }}>#{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
