import React, { useState, useEffect } from 'react';
import { Plus, StickyNote, RefreshCw, Loader2, Trash2, Edit2 } from 'lucide-react';
import { fetchObjects, saveObject, deleteObject, EncryptedObject } from '../lib/api';
import { encryptData, decryptData, importKey } from '../lib/crypto';

interface NoteData {
  title: string;
  content: string;
  tags?: string[];
}

interface DecryptedNote {
  id: string;
  data: NoteData;
  updatedAt: string;
}

export function Notes({ vaultKeyRaw, jwtToken }: { vaultKeyRaw: Uint8Array, jwtToken: string }) {
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newNote, setNewNote] = useState<NoteData>({ title: '', content: '', tags: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const loadNotes = async () => {
    setLoading(true);
    setError('');
    try {
      const vkCrypto = await importKey(vaultKeyRaw);
      const objects = await fetchObjects(jwtToken);
      const noteObjects = objects.filter(o => o.type === 'aegis.note');
      
      const decryptedList: DecryptedNote[] = [];
      for (const obj of noteObjects) {
        try {
          const plaintext = await decryptData(vkCrypto, obj.ciphertext, obj.nonce);
          const data = JSON.parse(plaintext) as NoteData;
          decryptedList.push({ id: obj.id!, data, updatedAt: obj.updated_at || '' });
        } catch (err) {
          console.error('Nelze dešifrovat poznámku', obj.id);
        }
      }
      
      decryptedList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setNotes(decryptedList);
    } catch (err: any) {
      setError('Nelze načíst poznámky. Zkontrolujte připojení.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, []);

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const vkCrypto = await importKey(vaultKeyRaw);
      const plaintext = JSON.stringify(newNote);
      const { ciphertext, nonce } = await encryptData(vkCrypto, plaintext);
      
      const objToSave: EncryptedObject = {
        type: 'aegis.note',
        version: 1,
        ciphertext,
        nonce
      };
      
      if (editingId) {
        objToSave.id = editingId;
      }
      
      await saveObject(jwtToken, objToSave);
      setShowAdd(false);
      setEditingId(null);
      setNewNote({ title: '', content: '' });
      await loadNotes();
    } catch (err: any) {
      alert('Chyba při ukládání: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Opravdu chcete smazat tuto poznámku?')) return;
    try {
      await deleteObject(jwtToken, id);
      setNotes(notes.filter(n => n.id !== id));
    } catch (err: any) {
      alert('Chyba při mazání: ' + err.message);
    }
  };

  const startEdit = (n: DecryptedNote) => {
    setNewNote({ ...n.data, tags: n.data.tags || [] });
    setEditingId(n.id);
    setShowAdd(true);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    if ((newNote.tags || []).includes(tag)) { setTagInput(''); return; }
    setNewNote(prev => ({ ...prev, tags: [...(prev.tags || []), tag] }));
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setNewNote(prev => ({ ...prev, tags: (prev.tags || []).filter(t => t !== tag) }));
  };

  const allTags = Array.from(new Set(notes.flatMap(n => n.data.tags || [])));

  const filteredNotes = activeTag
    ? notes.filter(n => (n.data.tags || []).includes(activeTag))
    : notes;

  return (
    <div className="secrets-container">
      <div className="secrets-header">
        <h2><StickyNote size={24} style={{display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem'}}/> Moje Poznámky</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={loadNotes} title="Obnovit">
            <RefreshCw size={18} className={loading ? "spinner" : ""} />
          </button>
          <button className="btn-primary" onClick={() => { setShowAdd(true); setEditingId(null); setNewNote({ title: '', content: '', tags: [] }); }}>
            <Plus size={18} /> Přidat
          </button>
        </div>
      </div>

      {error && <p style={{color: '#ef4444'}}>{error}</p>}

      {showAdd && (
        <div className="card add-secret-card">
          <h3>{editingId ? 'Upravit poznámku' : 'Nová poznámka'}</h3>
          <form onSubmit={handleSaveNote} className="auth-form">
            <input 
              type="text" 
              placeholder="Nadpis poznámky" 
              value={newNote.title} 
              onChange={e => setNewNote({...newNote, title: e.target.value})} 
              required 
              className="input-field" 
              autoFocus
            />
            <textarea 
              placeholder="Obsah poznámky..." 
              value={newNote.content} 
              onChange={e => setNewNote({...newNote, content: e.target.value})} 
              required 
              className="input-field"
              style={{ minHeight: '150px', resize: 'vertical' }}
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
              {(newNote.tags || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {(newNote.tags || []).map(tag => (
                    <span key={tag} style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '999px', padding: '0.15rem 0.6rem', fontSize: '0.75rem', color: '#a5b4fc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                      onClick={() => removeTag(tag)}>#{tag} ×</span>
                  ))}
                </div>
              )}
            </div>
            
            <div style={{display: 'flex', gap: '1rem', marginTop: '1rem'}}>
              <button type="submit" className="btn-primary" style={{flex: 1}}>{editingId ? 'Uložit změny' : 'Zašifrovat a Uložit'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setShowAdd(false); setEditingId(null); setTagInput(''); }}>Zrušit</button>
            </div>
          </form>
        </div>
      )}

      {loading && !showAdd && <div style={{textAlign: 'center', padding: '2rem', color: 'var(--text-muted)'}}><Loader2 className="spinner" size={32} /></div>}

      {!loading && notes.length === 0 && !showAdd && (
        <div className="empty-state">
          <StickyNote size={48} />
          <p>Zatím zde nemáte žádné poznámky.</p>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {filteredNotes.map(n => (
          <div key={n.id} className="card secret-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', height: 'auto' }}>
            <div className="secret-card-header" style={{ marginBottom: '1rem' }}>
              <StickyNote className="secret-icon" />
              <h4 style={{ margin: 0, fontSize: '1.2rem' }}>{n.data.title}</h4>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                <button className="btn-link" style={{ padding: '0.25rem' }} onClick={() => startEdit(n)} title="Upravit"><Edit2 size={16} /></button>
                <button className="btn-link" style={{ padding: '0.25rem', color: '#ef4444' }} onClick={() => handleDelete(n.id)} title="Smazat"><Trash2 size={16} /></button>
              </div>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              Naposledy upraveno: {new Date(n.updatedAt).toLocaleString()}
            </div>
            {(n.data.tags || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.75rem' }}>
                {(n.data.tags || []).map(tag => (
                  <span key={tag} style={{ background: 'rgba(99,102,241,0.15)', borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.7rem', color: '#818cf8' }}>#{tag}</span>
                ))}
              </div>
            )}
            <div style={{ 
              whiteSpace: 'pre-wrap', 
              wordBreak: 'break-word', 
              background: 'rgba(0,0,0,0.2)', 
              padding: '1rem', 
              borderRadius: '0.5rem',
              lineHeight: '1.5'
            }}>
              {n.data.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
