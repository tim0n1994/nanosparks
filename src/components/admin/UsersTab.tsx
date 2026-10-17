'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  BadgeCheck,
  Ban,
  Circle,
  KeyRound,
  Lock,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unlock,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonStyles } from '@/components/ui/Button';

interface UserView {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  username: string | null;
  role: 'admin' | 'user';
  banned: boolean;
  locked: boolean;
  passwordEnabled: boolean;
  twoFactorEnabled: boolean;
  hasImage: boolean;
  imageUrl: string;
  createdAt: number;
  lastSignInAt: number | null;
  oauthProviders: string[];
}

type Action =
  | { type: 'set_role'; role: 'admin' | 'user' }
  | { type: 'ban' }
  | { type: 'unban' }
  | { type: 'lock' }
  | { type: 'unlock' }
  | { type: 'delete' }
  | { type: 'reset_password' }
  | { type: 'disable_mfa' }
  | { type: 'set_verified' };

function fmtDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function UsersTab() {
  const [users, setUsers] = useState<UserView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<{ user: UserView; action: Action } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pwModal, setPwModal] = useState<UserView | null>(null);
  const [pwInput, setPwInput] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/users?limit=100')
      .then(async (r) => {
        if (!r.ok) {
          const hint = r.status === 401 ? '登录状态已过期，请退出后重新登录刷新管理员权限。' : r.status === 403 ? '当前账号不是管理员。' : '加载失败';
          throw new Error(hint);
        }
        return r.json() as Promise<{ users: UserView[] }>;
      })
      .then((d) => { if (alive) setUsers(d.users); })
      .catch((e) => { if (alive) setError(String((e as Error).message)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function runSearch(q: string) {
    setQuery(q);
    if (q.trim()) {
      setLoading(true);
      const res = await fetch(`/api/admin/users?limit=100&q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        const d = (await res.json()) as { users: UserView[] };
        setUsers(d.users);
      }
      setLoading(false);
    }
  }

  async function performAction(userId: string, action: Action) {
    setBusyId(userId);
    setError(null);
    try {
      const payload: Record<string, unknown> = { userId };
      switch (action.type) {
        case 'set_role': payload.action = 'set_role'; payload.role = action.role; break;
        case 'reset_password': payload.action = 'reset_password'; payload.password = pwInput; break;
        default: payload.action = action.type;
      }
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; user?: UserView; deleted?: boolean; userId?: string };
      if (!res.ok) throw new Error(d.error || '操作失败');
      if (d.deleted) {
        setUsers((prev) => prev.filter((u) => u.id !== d.userId));
      } else if (d.user) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? d.user! : u)));
      }
      setConfirm(null);
      setPwModal(null);
      setPwInput('');
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  const filtered = query.trim()
    ? users
    : users;
  const adminCount = filtered.filter((u) => u.role === 'admin').length;

  if (loading) return <p className="text-sm text-ink-muted">加载中…</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-100 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            size={16}
            strokeWidth={1.5}
          />
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="搜索邮箱 / 姓名…"
            className="h-9 w-full rounded-md border border-line bg-surface py-0 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted/50 focus:border-accent-600 focus:outline-none"
          />
        </div>
        <span className="text-sm text-ink-muted">共 {filtered.length} 人 · 管理员 {adminCount}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-muted">暂无用户。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/50 text-left text-xs text-ink-muted">
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">登录方式</th>
                <th className="px-4 py-3 font-medium">注册时间</th>
                <th className="px-4 py-3 font-medium">最近登录</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const busy = busyId === u.id;
                const statusLabel = u.banned ? '已封禁' : u.locked ? '已锁定' : '正常';
                const statusClass = u.banned || u.locked ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700';
                return (
                  <tr key={u.id} className="border-b border-line transition-colors last:border-0 hover:bg-surface-sunken/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {u.hasImage ? (
                          <Image src={u.imageUrl} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full bg-surface-sunken object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-medium text-ink-muted">
                            {(u.name || u.email || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                            {u.name || u.email || u.id}
                            {!u.emailVerified && u.email && (
                              <span className="rounded bg-amber-100 px-1 text-2xs font-medium text-amber-700">未验证</span>
                            )}
                          </p>
                          {u.email && <p className="truncate text-xs text-ink-muted">{u.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-md px-2 py-0.5 text-xs font-medium', u.role === 'admin' ? 'bg-accent-600/10 text-accent-600' : 'bg-surface-sunken text-ink-muted')}>
                        {u.role === 'admin' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-md px-2 py-0.5 text-xs font-medium', statusClass)}>{statusLabel}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {u.oauthProviders.length > 0 ? u.oauthProviders.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') : u.passwordEnabled ? '密码' : '—'}
                      {u.twoFactorEnabled && <span className="ml-1"> · 2FA</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{fmtDate(u.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{fmtDate(u.lastSignInAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {u.role === 'user' ? (
                            <ActBtn icon={ShieldCheck} label="设为管理员" disabled={busy} onClick={() => performAction(u.id, { type: 'set_role', role: 'admin' })} />
                          ) : (
                            <ActBtn icon={ShieldOff} label="取消管理员" disabled={busy} onClick={() => setConfirm({ user: u, action: { type: 'set_role', role: 'user' } })} />
                          )}
                        </div>

                        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />

                        <div className="flex items-center gap-1">
                          {u.banned ? (
                            <ActBtn icon={Circle} label="解封" variant="ghost" disabled={busy} onClick={() => performAction(u.id, { type: 'unban' })} />
                          ) : (
                            <ActBtn icon={Ban} label="封禁" variant="ghost" disabled={busy} onClick={() => setConfirm({ user: u, action: { type: 'ban' } })} />
                          )}
                          {u.locked ? (
                            <ActBtn icon={Unlock} label="解锁" variant="ghost" disabled={busy} onClick={() => performAction(u.id, { type: 'unlock' })} />
                          ) : (
                            <ActBtn icon={Lock} label="锁定" variant="ghost" disabled={busy} onClick={() => setConfirm({ user: u, action: { type: 'lock' } })} />
                          )}
                        </div>

                        {(u.email && !u.emailVerified) || u.twoFactorEnabled || u.passwordEnabled ? (
                          <>
                            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
                            <div className="flex items-center gap-1">
                              {u.email && !u.emailVerified && (
                                <ActBtn icon={BadgeCheck} label="验证" variant="ghost" disabled={busy} onClick={() => performAction(u.id, { type: 'set_verified' })} />
                              )}
                              {u.twoFactorEnabled && (
                                <ActBtn icon={ShieldOff} label="关 2FA" variant="ghost" disabled={busy} onClick={() => setConfirm({ user: u, action: { type: 'disable_mfa' } })} />
                              )}
                              {u.passwordEnabled && (
                                <ActBtn icon={KeyRound} label="重置" variant="ghost" disabled={busy} onClick={() => setPwModal(u)} />
                              )}
                            </div>
                          </>
                        ) : null}

                        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />
                        <ActBtn icon={Trash2} label="删除" variant="danger" disabled={busy} onClick={() => setConfirm({ user: u, action: { type: 'delete' } })} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm modal for destructive actions */}
      {confirm && (
        <Modal title={confirmTitle(confirm.action)} onClose={() => setConfirm(null)}>
          <p className="text-sm text-ink-muted">
            确定要对 <span className="font-medium text-ink">{confirm.user.name || confirm.user.email}</span> 执行此操作吗？
            {confirm.action.type === 'delete' && ' 此操作不可撤销，用户数据将被永久删除。'}
            {confirm.action.type === 'set_role' && ' 该用户将不再拥有管理员权限。'}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className={buttonStyles('ghost', 'sm')} onClick={() => setConfirm(null)}>取消</button>
            <button
              className={buttonStyles(confirm.action.type === 'delete' || confirm.action.type === 'ban' || confirm.action.type === 'lock' ? 'danger' : 'primary', 'sm')}
              disabled={busyId === confirm.user.id}
              onClick={() => performAction(confirm.user.id, confirm.action)}
            >
              <ConfirmActionIcon action={confirm.action} />
              {busyId === confirm.user.id ? '处理中…' : '确认'}
            </button>
          </div>
        </Modal>
      )}

      {/* Reset password modal */}
      {pwModal && (
        <Modal title="重置密码" onClose={() => { setPwModal(null); setPwInput(''); }}>
          <p className="text-sm text-ink-muted">
            为 <span className="font-medium text-ink">{pwModal.name || pwModal.email}</span> 设置新密码（至少 8 位）。
            设置后该用户的其他设备会自动登出。
          </p>
          <input
            type="text"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder="新密码"
            className="mt-3 h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-accent-600 focus:outline-none"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button className={buttonStyles('ghost', 'sm')} onClick={() => { setPwModal(null); setPwInput(''); }}>取消</button>
            <button
              className={buttonStyles('primary', 'sm')}
              disabled={pwInput.length < 8 || busyId === pwModal.id}
              onClick={() => performAction(pwModal.id, { type: 'reset_password' })}
            >
              <KeyRound aria-hidden="true" size={16} strokeWidth={1.5} />
              {busyId === pwModal.id ? '处理中…' : '确认重置'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function confirmTitle(a: Action): string {
  switch (a.type) {
    case 'delete': return '删除用户';
    case 'ban': return '封禁用户';
    case 'lock': return '锁定用户';
    case 'set_role': return '取消管理员';
    case 'disable_mfa': return '关闭双因素认证';
    default: return '确认操作';
  }
}

function ConfirmActionIcon({ action }: { action: Action }) {
  const iconProps = { 'aria-hidden': true, size: 16, strokeWidth: 1.5 } as const;
  switch (action.type) {
    case 'delete': return <Trash2 {...iconProps} />;
    case 'ban': return <Ban {...iconProps} />;
    case 'lock': return <Lock {...iconProps} />;
    case 'set_role': return <ShieldOff {...iconProps} />;
    case 'disable_mfa': return <ShieldOff {...iconProps} />;
    default: return <BadgeCheck {...iconProps} />;
  }
}

function ActBtn({ icon: Icon, label, onClick, disabled, variant }: { icon: LucideIcon; label: string; onClick: () => void; disabled: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={buttonStyles(variant || 'secondary', 'sm')}>
      <Icon aria-hidden="true" size={16} strokeWidth={1.5} />
      {label}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-lg border border-line bg-surface-raised p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles('ghost', 'sm', 'h-8 w-8 px-0')}
            aria-label="关闭"
            title="关闭"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
