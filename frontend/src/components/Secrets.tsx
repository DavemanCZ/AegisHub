import React, { useState, useEffect } from 'react';
import { KeySquare, Plus, Lock, Globe, RefreshCw, Loader2, Eye, EyeOff, Trash2, Edit2, Dice5, Copy } from 'lucide-react';
import { fetchObjects, saveObject, deleteObject, EncryptedObject } from '../lib/api';
import { encryptData, decryptData, importKey } from '../lib/crypto';

interface SecretData {
  title: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  tags?: string[];
}

interface DecryptedSecret {
  id: string;
  data: SecretData;
  updatedAt: string;
}

export function Secrets({ vaultKeyRaw, jwtToken }: { vaultKeyRaw: Uint8Array, jwtToken: string }) {
  const [secrets, setSecrets] = useState<DecryptedSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newSecret, setNewSecret] = useState<SecretData>({ title: '', username: '', password: '', url: '', tags: [] });
  const [showPassword, setShowPassword] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [genLength, setGenLength] = useState(20);
  const [genUpper, setGenUpper] = useState(true);
  const [genNumbers, setGenNumbers] = useState(true);
  const [genSymbols, setGenSymbols] = useState(true);

  const generatePassword = () => {
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    let charset = lower;
    if (genUpper) charset += upper;
    if (genNumbers) charset += numbers;
    if (genSymbols) charset += symbols;
    const arr = new Uint32Array(genLength);
    crypto.getRandomValues(arr);
    const pwd = Array.from(arr).map(x => charset[x % charset.length]).join('');
    setNewSecret(prev => ({ ...prev, password: pwd }));
    setShowPassword(true);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    if ((newSecret.tags || []).includes(tag)) { setTagInput(''); return; }
    setNewSecret(prev => ({ ...prev, tags: [...(prev.tags || []), tag] }));
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setNewSecret(prev => ({ ...prev, tags: (prev.tags || []).filter(t => t !== tag) }));
  };

  const allTags = Array.from(new Set(secrets.flatMap(s => s.data.tags || [])));

  const loadSecrets = async () => {
    setLoading(true);
    setError('');
    try {
      const vkCrypto = await importKey(vaultKeyRaw);
      const objects = await fetchObjects(jwtToken);
      const secretObjects = objects.filter(o => o.type === 'aegis.secret');
      
      const decryptedList: DecryptedSecret[] = [];
      for (const obj of secretObjects) {
        try {
          const plaintext = await decryptData(vkCrypto, obj.ciphertext, obj.nonce);
          const data = JSON.parse(plaintext) as SecretData;
          decryptedList.push({ id: obj.id!, data, updatedAt: obj.updated_at || '' });
        } catch (err) {
          console.error('Nelze dešifrovat objekt', obj.id);
        }
      }
      setSecrets(decryptedList);
    } catch (err: any) {
      setError('Nelze načíst hesla. Zkontrolujte připojení.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSecrets();
  }, []);

  const handleAddSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const vkCrypto = await importKey(vaultKeyRaw);
      const plaintext = JSON.stringify(newSecret);
      const { ciphertext, nonce } = await encryptData(vkCrypto, plaintext);
      
      const objToSave: EncryptedObject = {
        type: 'aegis.secret',
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
      setNewSecret({ title: '', username: '', password: '', url: '' });
      await loadSecrets();
    } catch (err: any) {
      alert('Chyba při ukládání: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Opravdu chcete smazat toto heslo?')) return;
    try {
      await deleteObject(jwtToken, id);
      setSecrets(secrets.filter(s => s.id !== id));
    } catch (err: any) {
      alert('Chyba při mazání: ' + err.message);
    }
  };

  const startEdit = (s: DecryptedSecret) => {
    setNewSecret({ ...s.data, tags: s.data.tags || [] });
    setEditingId(s.id);
    setShowAdd(true);
  };

  const filteredSecrets = activeTag
    ? secrets.filter(s => (s.data.tags || []).includes(activeTag))
    : secrets;

  return (
    <div className="secrets-container">
      <div className="secrets-header">
        <h2><KeySquare size={24} /> Moje Hesla</h2>
        <div className="actions">
          <button className="btn-secondary" onClick={loadSecrets} title="Obnovit">
            <RefreshCw size={18} className={loading ? "spinner" : ""} />
          </button>
          <button className="btn-primary" onClick={() => { setShowAdd(true); setEditingId(null); setNewSecret({ title: '', username: '', password: '', url: '' }); }}>
            <Plus size={18} /> Přidat
          </button>
        </div>
      </div>

      {error && <div style={{color: '#ef4444', marginBottom: '1rem'}}>{error}</div>}

      {showAdd && (
        <div className="card add-secret-card">
          <h3>{editingId ? 'Upravit záznam' : 'Nový záznam'}</h3>
          <form onSubmit={handleAddSecret} className="auth-form">
            <input type="text" placeholder="Název služby (např. Google)" value={newSecret.title} onChange={e => setNewSecret({...newSecret, title: e.target.value})} required className="input-field" />
            <input type="text" placeholder="Uživatelské jméno / Email" value={newSecret.username} onChange={e => setNewSecret({...newSecret, username: e.target.value})} required className="input-field" />
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? "text" : "password"} placeholder="Heslo" value={newSecret.password} onChange={e => setNewSecret({...newSecret, password: e.target.value})} required className="input-field" style={{ width: '100%', paddingRight: '5rem', margin: 0 }} />
                <div style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: '0.25rem' }}>
                  <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.2rem' }} title={showPassword ? 'Skrýt' : 'Zobrazit'}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button type="button" onClick={() => setShowGenerator(!showGenerator)} style={{ background: 'none', border: 'none', color: showGenerator ? '#6366f1' : '#94a3b8', cursor: 'pointer', padding: '0.2rem' }} title="Generátor hesel">
                    <Dice5 size={16} />
                  </button>
                </div>
              </div>
              {showGenerator && (
                <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '0.5rem', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>GENERÁTOR HESEL</span>
                    <button type="button" className="btn-primary" onClick={generatePassword} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Dice5 size={14} /> Generovat
                    </button>
                  </div>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Délka hesla</label>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#6366f1' }}>{genLength}</span>
                    </div>
                    <input type="range" min={8} max={64} value={genLength} onChange={e => setGenLength(Number(e.target.value))} style={{ width: '100%', accentColor: '#6366f1' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {[['A–Z', genUpper, setGenUpper], ['0–9', genNumbers, setGenNumbers], ['!@#', genSymbols, setGenSymbols]].map(([label, val, setter]: any) => (
                      <label key={label as string} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', cursor: 'pointer', color: val ? '#c4b5fd' : 'var(--text-muted)' }}>
                        <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} style={{ accentColor: '#6366f1' }} />
                        {label as string}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <input type="text" placeholder="URL (volitelné)" value={newSecret.url} onChange={e => setNewSecret({...newSecret, url: e.target.value})} className="input-field" />
            
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
              {(newSecret.tags || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {(newSecret.tags || []).map(tag => (
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

      {!loading && secrets.length === 0 && !showAdd && (
        <div className="empty-state">
          <Lock size={48} />
          <p>Trezor je zatím prázdný.</p>
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

      <div className="secrets-grid">
        {filteredSecrets.map(s => (
          <div key={s.id} className="secret-card">
            <div className="secret-card-header">
              <Globe className="secret-icon" />
              <h4>{s.data.title}</h4>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                <button className="btn-link" style={{ padding: '0.25rem' }} onClick={() => startEdit(s)} title="Upravit"><Edit2 size={16} /></button>
                <button className="btn-link" style={{ padding: '0.25rem', color: '#ef4444' }} onClick={() => handleDelete(s.id)} title="Smazat"><Trash2 size={16} /></button>
              </div>
            </div>
            <div className="secret-details">
              <span>{s.data.username}</span>
              {(s.data.tags || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
                  {(s.data.tags || []).map(tag => (
                    <span key={tag} style={{ background: 'rgba(99,102,241,0.15)', borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.7rem', color: '#818cf8' }}>#{tag}</span>
                  ))}
                </div>
              )}
              <button className="btn-link" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.4rem' }} onClick={() => { navigator.clipboard.writeText(s.data.password); }}>
                <Copy size={14} /> Kopírovat heslo
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
