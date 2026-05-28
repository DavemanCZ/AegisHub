import { useState, useEffect, useCallback } from 'react';
import {
  Users, Loader2, Trash2, ShieldAlert, BarChart3, Settings2,
  ScrollText, Shield, ToggleLeft, ToggleRight, RefreshCw, AlertTriangle, MessageSquare
} from 'lucide-react';

const API = '/api';
const h = (token: string) => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

interface UserInfo {
  id: string; username: string; is_admin: boolean; created_at: string;
}
interface Stats {
  total_users: number; total_messages: number; total_dms: number;
  total_files: number; total_size_mb: string; total_channels: number;
}
interface AuditEntry {
  id: string; username: string; action: string; details: string; created_at: string;
}
interface InstanceSettings {
  instance_name?: string; instance_desc?: string; max_upload_mb?: string;
  registration?: string; chat_enabled?: string; files_enabled?: string; motd?: string;
}

type Tab = 'dashboard' | 'users' | 'settings' | 'audit';

export function AdminPanel({ jwtToken, currentUsername }: { jwtToken: string; currentUsername: string }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [settings, setSettings] = useState<InstanceSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const notify = (msg: string, isError = false) => {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(''); setSuccess(''); }, 3000);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [u, s, a, cfg] = await Promise.all([
        fetch(`${API}/admin/users`, { headers: h(jwtToken) }).then(r => r.json()),
        fetch(`${API}/admin/stats`, { headers: h(jwtToken) }).then(r => r.json()),
        fetch(`${API}/admin/audit`, { headers: h(jwtToken) }).then(r => r.json()),
        fetch(`${API}/admin/settings`, { headers: h(jwtToken) }).then(r => r.json()),
      ]);
      setUsers(Array.isArray(u) ? u : []);
      setStats(s);
      setAudit(Array.isArray(a) ? a : []);
      setSettings(cfg);
    } catch (err: any) { setError('Chyba načítání: ' + err.message); }
    finally { setLoading(false); }
  }, [jwtToken]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleDeleteUser = async (id: string, username: string) => {
    if (!confirm(`Smazat uživatele ${username}? Tato akce je nevratná.`)) return;
    await fetch(`${API}/admin/users?id=${id}`, { method: 'DELETE', headers: h(jwtToken) });
    setUsers(prev => prev.filter(u => u.id !== id));
    notify(`Uživatel ${username} smazán.`);
  };

  const handlePromote = async (id: string, username: string) => {
    await fetch(`${API}/admin/users?action=promote&id=${id}`, { method: 'POST', headers: h(jwtToken) });
    setUsers(prev => prev.map(u => u.id === id ? { ...u, is_admin: !u.is_admin } : u));
    notify(`Role uživatele ${username} změněna.`);
  };

  const handleForceChange = async (id: string, username: string) => {
    if (!confirm(`Vynutit změnu hesla pro ${username}? Uživatel bude při příštím přihlášení nucen nastavit nové heslo.`)) return;
    const res = await fetch(`${API}/admin/users?action=force_change&id=${id}`, { method: 'POST', headers: h(jwtToken) });
    if (res.ok) notify(`Uživatel ${username} musí při přihlášení nastavit nové heslo.`);
    else notify('Chyba.', true);
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    const res = await fetch(`${API}/admin/settings`, {
      method: 'PUT', headers: h(jwtToken), body: JSON.stringify(settings)
    });
    setSaving(false);
    if (res.ok) notify('Nastavení uloženo.');
    else notify('Chyba při ukládání.', true);
  };

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '0.5rem 1rem', cursor: 'pointer', border: 'none', background: 'none',
    color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
    fontWeight: tab === t ? 700 : 400, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem'
  });

  const StatCard = ({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) => (
    <div className="card" style={{ textAlign: 'center', flex: 1, minWidth: '120px' }}>
      <div style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>{icon}</div>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.2rem' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );

  return (
    <div className="secrets-container">
      {/* Header */}
      <div className="secrets-header" style={{ marginBottom: '1.5rem' }}>
        <h2><ShieldAlert size={24} /> Administrace serveru</h2>
        <button className="btn-link" onClick={loadAll} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
          <RefreshCw size={14} /> Obnovit
        </button>
      </div>

      {/* Notifications */}
      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#ef4444' }}>{error}</div>}
      {success && <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#10b981' }}>{success}</div>}

      {/* Reset password modal - REMOVED: admins cannot set passwords */}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', gap: '0.25rem' }}>
        <button style={tabStyle('dashboard')} onClick={() => setTab('dashboard')}><BarChart3 size={16} />Dashboard</button>
        <button style={tabStyle('users')} onClick={() => setTab('users')}><Users size={16} />Uživatelé</button>
        <button style={tabStyle('settings')} onClick={() => setTab('settings')}><Settings2 size={16} />Nastavení</button>
        <button style={tabStyle('audit')} onClick={() => setTab('audit')}><ScrollText size={16} />Audit log</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}><Loader2 className="spinner" size={36} /></div>
      ) : (
        <>
          {/* ── DASHBOARD ── */}
          {tab === 'dashboard' && stats && (
            <div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                <StatCard label="Uživatelů" value={stats.total_users} icon={<Users size={24} />} />
                <StatCard label="Kanálů" value={stats.total_channels} icon={<Shield size={24} />} />
                <StatCard label="Zpráv v kanálech" value={stats.total_messages} icon={<ScrollText size={24} />} />
                <StatCard label="DM zpráv" value={stats.total_dms} icon={<MessageSquare size={24} />} />
                <StatCard label="Souborů" value={stats.total_files} icon={<BarChart3 size={24} />} />
                <StatCard label="Úložiště (MB)" value={stats.total_size_mb} icon={<Settings2 size={24} />} />
              </div>

              <div className="card">
                <h3 style={{ marginBottom: '1rem' }}>Rychlé informace</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <tbody>
                    {[
                      ['Název instance', settings.instance_name || 'Aegis Hub'],
                      ['Registrace', settings.registration === 'false' ? '🔒 Uzavřeno' : '✅ Otevřeno'],
                      ['Chat', settings.chat_enabled === 'false' ? '❌ Vypnut' : '✅ Povolen'],
                      ['Max. velikost souboru', (settings.max_upload_mb || '100') + ' MB'],
                    ].map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.6rem 0', color: 'var(--text-muted)', width: '50%' }}>{k}</td>
                        <td style={{ padding: '0.6rem 0', fontWeight: 600 }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── USERS ── */}
          {tab === 'users' && (
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}><Users size={18} style={{ display: 'inline', verticalAlign: 'middle' }} /> Uživatelé ({users.length})</h3>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.5rem 0' }}>Jméno</th>
                    <th>Role</th>
                    <th>Registrován</th>
                    <th style={{ textAlign: 'right' }}>Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 0', fontWeight: 600 }}>{u.username}</td>
                      <td>
                        <span style={{ background: u.is_admin ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)', color: u.is_admin ? '#818cf8' : 'var(--text-muted)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600 }}>
                          {u.is_admin ? 'Admin' : 'Uživatel'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{new Date(u.created_at).toLocaleDateString('cs-CZ')}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          {u.username !== currentUsername ? (
                            <button className="btn-link" style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                              onClick={() => handlePromote(u.id, u.username)} title={u.is_admin ? 'Odebrat admina' : 'Povýšit na admina'}>
                              <Shield size={13} />
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.2rem 0.5rem' }}>Vy</span>
                          )}
                          {!u.is_admin && u.username !== currentUsername && (
                            <button className="btn-link" style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', color: '#f59e0b' }}
                              onClick={() => handleForceChange(u.id, u.username)} title="Vynutit změnu hesla">
                              <AlertTriangle size={13} />
                            </button>
                          )}
                          {!u.is_admin && (
                            <button className="btn-link" style={{ color: '#ef4444', fontSize: '0.78rem', padding: '0.2rem 0.5rem', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px' }}
                              onClick={() => handleDeleteUser(u.id, u.username)}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── SETTINGS ── */}
          {tab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="card">
                <h3 style={{ marginBottom: '1rem' }}>Identita instance</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }}>Název platformy</label>
                    <input className="input-field" style={{ margin: 0 }} value={settings.instance_name || ''} onChange={e => setSettings(s => ({ ...s, instance_name: e.target.value }))} placeholder="Aegis Hub" />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }}>Popis instance</label>
                    <input className="input-field" style={{ margin: 0 }} value={settings.instance_desc || ''} onChange={e => setSettings(s => ({ ...s, instance_desc: e.target.value }))} placeholder="Secure self-hosted platform" />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }}>MOTD (zpráva po přihlášení, nepovinné)</label>
                    <textarea className="input-field" style={{ margin: 0, minHeight: '70px', resize: 'vertical' }} value={settings.motd || ''} onChange={e => setSettings(s => ({ ...s, motd: e.target.value }))} placeholder="Vítejte na serveru..." />
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 style={{ marginBottom: '1rem' }}>Funkce a limity</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[
                    { key: 'registration', label: 'Veřejné registrace', desc: 'Kdokoli si může vytvořit účet. Vypněte pro uzavřenou komunitu.' },
                    { key: 'chat_enabled', label: 'Chat', desc: 'Povolení chat modulu (kanály + přímé zprávy).' },
                    { key: 'files_enabled', label: 'Sdílení souborů', desc: 'Uživatelé mohou nahrávat šifrované soubory.' },
                  ].map(({ key, label, desc }) => {
                    const val = (settings as any)[key] !== 'false';
                    return (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{label}</div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{desc}</div>
                        </div>
                        <button className="btn-link" onClick={() => setSettings(s => ({ ...s, [key]: val ? 'false' : 'true' }))} style={{ flexShrink: 0 }}>
                          {val ? <ToggleRight size={32} style={{ color: '#10b981' }} /> : <ToggleLeft size={32} style={{ color: '#6b7280' }} />}
                        </button>
                      </div>
                    );
                  })}

                  <div>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }}>Max. velikost souboru (MB)</label>
                    <input type="number" className="input-field" style={{ margin: 0, maxWidth: '160px' }}
                      value={settings.max_upload_mb || '100'}
                      onChange={e => setSettings(s => ({ ...s, max_upload_mb: e.target.value }))}
                      min={1} max={2048} />
                  </div>
                </div>
              </div>

              <button className="btn-primary" onClick={handleSaveSettings} disabled={saving} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {saving ? <Loader2 size={16} className="spinner" /> : null}
                Uložit nastavení
              </button>
            </div>
          )}

          {/* ── AUDIT LOG ── */}
          {tab === 'audit' && (
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}><ScrollText size={18} style={{ display: 'inline', verticalAlign: 'middle' }} /> Audit log (posledních 50 akcí)</h3>
              {audit.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Zatím žádné záznamy.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.5rem 0', textAlign: 'left' }}>Čas</th>
                      <th style={{ textAlign: 'left' }}>Uživatel</th>
                      <th style={{ textAlign: 'left' }}>Akce</th>
                      <th style={{ textAlign: 'left' }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.6rem 0', color: 'var(--text-muted)', whiteSpace: 'nowrap', paddingRight: '1rem' }}>
                          {new Date(e.created_at).toLocaleString('cs-CZ')}
                        </td>
                        <td style={{ fontWeight: 600 }}>{e.username}</td>
                        <td>
                          <span style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.78rem' }}>
                            {e.action}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{e.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
