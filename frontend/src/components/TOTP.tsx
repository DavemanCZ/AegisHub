import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Plus, RefreshCw, Loader2, Trash2, Edit2, Copy, Check } from 'lucide-react';
import { fetchObjects, saveObject, deleteObject, EncryptedObject } from '../lib/api';
import { encryptData, decryptData, importKey } from '../lib/crypto';
import { generateTOTP, secondsRemaining } from '../lib/totp';

interface TOTPData {
  name: string;
  secret: string;
  issuer?: string;
  tags?: string[];
}

interface DecryptedTOTP {
  id: string;
  data: TOTPData;
  updatedAt: string;
}

interface TOTPState {
  code: string;
  copied: boolean;
}

/** Circular SVG countdown ring */
function CountdownRing({ seconds, period = 30 }: { seconds: number; period?: number }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const progress = (seconds / period) * circ;
  const color = seconds <= 7 ? '#ef4444' : seconds <= 15 ? '#f59e0b' : '#10b981';
  return (
    <svg width={36} height={36} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={18} cy={18} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={3} />
      <circle cx={18} cy={18} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${progress} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s linear, stroke 0.3s' }} />
      <text x={18} y={18} textAnchor="middle" dominantBaseline="central"
        style={{ fill: color, fontSize: '10px', fontWeight: 700, transform: 'rotate(90deg)', transformOrigin: '18px 18px' }}>
        {seconds}
      </text>
    </svg>
  );
}

export function TOTP({ vaultKeyRaw, jwtToken }: { vaultKeyRaw: Uint8Array; jwtToken: string }) {
  const [entries, setEntries] = useState<DecryptedTOTP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState<TOTPData>({ name: '', secret: '', issuer: '', tags: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, TOTPState>>({});
  const [seconds, setSeconds] = useState(secondsRemaining());

  const loadEntries = async () => {
    setLoading(true);
    setError('');
    try {
      const vkCrypto = await importKey(vaultKeyRaw);
      const objects = await fetchObjects(jwtToken);
      const totpObjects = objects.filter(o => o.type === 'aegis.totp');
      const decrypted: DecryptedTOTP[] = [];
      for (const obj of totpObjects) {
        try {
          const plaintext = await decryptData(vkCrypto, obj.ciphertext, obj.nonce);
          decrypted.push({ id: obj.id!, data: JSON.parse(plaintext) as TOTPData, updatedAt: obj.updated_at || '' });
        } catch { /* skip */ }
      }
      setEntries(decrypted);
    } catch {
      setError('Nelze načíst TOTP záznamy.');
    } finally {
      setLoading(false);
    }
  };

  // Generate codes for all entries
  const refreshCodes = useCallback(async () => {
    const next: Record<string, TOTPState> = {};
    for (const e of entries) {
      try {
        const code = await generateTOTP(e.data.secret);
        next[e.id] = { code, copied: codes[e.id]?.copied ?? false };
      } catch {
        next[e.id] = { code: '------', copied: false };
      }
    }
    setCodes(next);
  }, [entries]);

  // Tick every second
  useEffect(() => {
    const interval = setInterval(() => {
      const s = secondsRemaining();
      setSeconds(s);
      // Refresh codes when a new period starts
      if (s === 30) refreshCodes();
    }, 1000);
    return () => clearInterval(interval);
  }, [refreshCodes]);

  useEffect(() => { loadEntries(); }, []);
  useEffect(() => { refreshCodes(); }, [entries]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cleaned = { ...newEntry, secret: newEntry.secret.replace(/\s/g, '').toUpperCase() };
      // Quick validation
      await generateTOTP(cleaned.secret);
      const vkCrypto = await importKey(vaultKeyRaw);
      const { ciphertext, nonce } = await encryptData(vkCrypto, JSON.stringify(cleaned));
      const obj: EncryptedObject = { type: 'aegis.totp', version: 1, ciphertext, nonce };
      if (editingId) obj.id = editingId;
      await saveObject(jwtToken, obj);
      setShowAdd(false);
      setEditingId(null);
      setNewEntry({ name: '', secret: '', issuer: '', tags: [] });
      setTagInput('');
      await loadEntries();
    } catch {
      alert('Neplatný TOTP secret. Zkontrolujte Base32 klíč.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Smazat tento TOTP záznam?')) return;
    await deleteObject(jwtToken, id);
    setEntries(entries.filter(e => e.id !== id));
  };

  const startEdit = (e: DecryptedTOTP) => {
    setNewEntry({ ...e.data, tags: e.data.tags || [] });
    setEditingId(e.id);
    setShowAdd(true);
  };

  const copyCode = async (id: string, code: string) => {
    await navigator.clipboard.writeText(code);
    setCodes(prev => ({ ...prev, [id]: { ...prev[id], copied: true } }));
    setTimeout(() => setCodes(prev => ({ ...prev, [id]: { ...prev[id], copied: false } })), 2000);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || (newEntry.tags || []).includes(tag)) { setTagInput(''); return; }
    setNewEntry(prev => ({ ...prev, tags: [...(prev.tags || []), tag] }));
    setTagInput('');
  };
  const removeTag = (tag: string) => setNewEntry(prev => ({ ...prev, tags: (prev.tags || []).filter(t => t !== tag) }));

  const allTags = Array.from(new Set(entries.flatMap(e => e.data.tags || [])));
  const filtered = activeTag ? entries.filter(e => (e.data.tags || []).includes(activeTag)) : entries;

  return (
    <div className="secrets-container">
      <div className="secrets-header">
        <h2><ShieldCheck size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem' }} /> 2FA Autentikátor</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={loadEntries} title="Obnovit">
            <RefreshCw size={18} className={loading ? 'spinner' : ''} />
          </button>
          <button className="btn-primary" onClick={() => { setShowAdd(true); setEditingId(null); setNewEntry({ name: '', secret: '', issuer: '', tags: [] }); }}>
            <Plus size={18} /> Přidat
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#ef4444' }}>{error}</p>}

      {showAdd && (
        <div className="card add-secret-card">
          <h3>{editingId ? 'Upravit TOTP' : 'Nový TOTP kód'}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Zadej údaje ze záchranného kódu nebo QR kódu od dvoufaktorové ochrany účtu.
          </p>
          <form onSubmit={handleSave} className="auth-form">
            <input type="text" placeholder="Název (např. GitHub – user@example.com)" value={newEntry.name} onChange={e => setNewEntry({ ...newEntry, name: e.target.value })} required className="input-field" autoFocus />
            <input type="text" placeholder="Vydavatel (volitelné, např. GitHub)" value={newEntry.issuer} onChange={e => setNewEntry({ ...newEntry, issuer: e.target.value })} className="input-field" />
            <input
              type="text"
              placeholder="TOTP Secret (Base32, např. JBSWY3DPEHPK3PXP)"
              value={newEntry.secret}
              onChange={e => setNewEntry({ ...newEntry, secret: e.target.value })}
              required
              className="input-field"
              style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
            />
            {/* Tags */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input type="text" placeholder="Přidat štítek (Enter)" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} className="input-field" style={{ margin: 0, flex: 1 }} />
                <button type="button" className="btn-secondary" onClick={addTag} style={{ whiteSpace: 'nowrap' }}>Přidat</button>
              </div>
              {(newEntry.tags || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {(newEntry.tags || []).map(tag => (
                    <span key={tag} onClick={() => removeTag(tag)} style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '999px', padding: '0.15rem 0.6rem', fontSize: '0.75rem', color: '#a5b4fc', cursor: 'pointer' }}>
                      #{tag} ×
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>{editingId ? 'Uložit' : 'Zašifrovat a Uložit'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setShowAdd(false); setTagInput(''); }}>Zrušit</button>
            </div>
          </form>
        </div>
      )}

      {loading && !showAdd && <div style={{ textAlign: 'center', padding: '2rem' }}><Loader2 className="spinner" size={32} /></div>}

      {!loading && entries.length === 0 && !showAdd && (
        <div className="empty-state">
          <ShieldCheck size={48} />
          <p>Zatím zde nemáte žádné 2FA kódy.</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Přidejte TOTP secret z nastavení dvoufaktorového ověření (Google, GitHub, apod.)</p>
        </div>
      )}

      {/* Tag filter */}
      {allTags.length > 0 && !showAdd && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center', marginRight: '0.25rem' }}>Filtr:</span>
          {allTags.map(tag => (
            <button key={tag} type="button" onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              style={{ background: activeTag === tag ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.1)', border: `1px solid ${activeTag === tag ? 'rgba(99,102,241,0.7)' : 'rgba(99,102,241,0.3)'}`, borderRadius: '999px', padding: '0.15rem 0.65rem', fontSize: '0.75rem', color: activeTag === tag ? '#c4b5fd' : '#818cf8', cursor: 'pointer' }}>
              #{tag}
            </button>
          ))}
          {activeTag && <button type="button" onClick={() => setActiveTag(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}>✕ Zrušit filtr</button>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filtered.map(entry => {
          const state = codes[entry.id];
          const code = state?.code ?? '------';
          const copied = state?.copied ?? false;
          const codeA = code.slice(0, 3);
          const codeB = code.slice(3);
          return (
            <div key={entry.id} className="card secret-card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', height: 'auto' }}>
              {/* Countdown ring */}
              <CountdownRing seconds={seconds} />

              {/* Code + name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                  {entry.data.issuer && <span style={{ color: '#818cf8', marginRight: '0.4rem' }}>{entry.data.issuer}</span>}
                  {entry.data.name}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '1.8rem', fontWeight: 800, letterSpacing: '0.15em', color: seconds <= 7 ? '#ef4444' : 'white' }}>
                  {codeA} {codeB}
                </div>
                {(entry.data.tags || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.3rem' }}>
                    {(entry.data.tags || []).map(tag => (
                      <span key={tag} style={{ background: 'rgba(99,102,241,0.15)', borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.7rem', color: '#818cf8' }}>#{tag}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                <button className="btn-secondary" style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}
                  onClick={() => copyCode(entry.id, code)}>
                  {copied ? <Check size={15} style={{ color: '#10b981' }} /> : <Copy size={15} />}
                  {copied ? 'Zkopírováno' : 'Kopírovat'}
                </button>
                <button className="btn-link" style={{ padding: '0.4rem' }} onClick={() => startEdit(entry)} title="Upravit"><Edit2 size={15} /></button>
                <button className="btn-link" style={{ padding: '0.4rem', color: '#ef4444' }} onClick={() => handleDelete(entry.id)} title="Smazat"><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
