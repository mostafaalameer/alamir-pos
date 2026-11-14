import React, { useCallback, useEffect, useState } from 'react';
import {
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AdminUserRecord,
  createUserCloud,
  fetchUsersCloud,
  updateUserCloud,
} from '../../lib/cloud';
import { useAuth } from '../../context/AuthContext';

export function UsersPage() {
  const { session } = useAuth();
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Add User Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRole, setAddRole] = useState<'ADMIN' | 'CASHIER'>('CASHIER');
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit User Modal
  const [editingUser, setEditingUser] = useState<AdminUserRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editRole, setEditRole] = useState<'ADMIN' | 'CASHIER'>('CASHIER');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUsersCloud();
      setUsers(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحميل قائمة المستخدمين');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const openEditModal = (user: AdminUserRecord) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditUsername(user.username);
    setEditRole(user.role);
    setEditPassword('');
    setShowEditPassword(false);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addName.trim().length < 2) {
      toast.error('الاسم الكامل يجب أن يكون حرفين على الأقل');
      return;
    }
    if (addUsername.trim().length < 3) {
      toast.error('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
      return;
    }
    if (addPassword.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    setCreating(true);
    try {
      await createUserCloud({
        name: addName.trim(),
        username: addUsername.trim(),
        password: addPassword,
        role: addRole,
      });
      toast.success(`تم إنشاء المستخدم "${addUsername.trim()}" بنجاح`);
      setShowAddModal(false);
      setAddName('');
      setAddUsername('');
      setAddPassword('');
      setAddRole('CASHIER');
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إنشاء المستخدم');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const cleanName = editName.trim();
    const cleanUsername = editUsername.trim();

    if (cleanName.length < 2) {
      toast.error('الاسم الكامل يجب أن يكون حرفين على الأقل');
      return;
    }
    if (cleanUsername.length < 3) {
      toast.error('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
      return;
    }
    if (editPassword.length > 0 && editPassword.length < 6) {
      toast.error('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    const payload: {
      name?: string;
      username?: string;
      role?: 'ADMIN' | 'CASHIER';
      password?: string;
    } = {};

    if (cleanName !== editingUser.name) payload.name = cleanName;
    if (cleanUsername !== editingUser.username) payload.username = cleanUsername;
    if (editRole !== editingUser.role) payload.role = editRole;
    if (editPassword.length > 0) payload.password = editPassword;

    if (Object.keys(payload).length === 0) {
      toast.info('لم يتم إجراء أي تغييرات');
      setEditingUser(null);
      return;
    }

    setSavingEdit(true);
    try {
      await updateUserCloud(editingUser.id, payload);
      toast.success(`تم تحديث بيانات "${cleanUsername}" بنجاح`);
      setEditingUser(null);
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث بيانات المستخدم');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Users className="w-7 h-7 text-amber-400" />
            المستخدمون والصلاحيات
          </h1>
          <p className="text-sm text-slate-300 mt-1">
            إضافة مستخدمين جدد (مدير / كاشير)، تعديل اسم المستخدم والاسم الكامل، وتغيير كلمات المرور
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-medium disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition"
          >
            <UserPlus className="w-4 h-4" />
            إضافة مستخدم جديد
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-300 font-semibold">
              <tr>
                <th className="px-4 py-3.5">الاسم الكامل</th>
                <th className="px-4 py-3.5">اسم المستخدم (Username)</th>
                <th className="px-4 py-3.5">الصلاحية</th>
                <th className="px-4 py-3.5">تاريخ الإنشاء</th>
                <th className="px-4 py-3.5 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    جاري تحميل المستخدمين...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    لا يوجد مستخدمون مسجلون
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isCurrentUser =
                    session?.user?.username?.toLowerCase() === u.username.toLowerCase();
                  return (
                    <tr key={u.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3.5 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <span>{u.name}</span>
                          {isCurrentUser && (
                            <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-950 border border-amber-700 text-amber-300">
                              أنت
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-amber-300 font-semibold">
                        {u.username}
                      </td>
                      <td className="px-4 py-3.5">
                        {u.role === 'ADMIN' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-950/70 border border-purple-700 text-purple-300 text-xs font-semibold">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            مدير (ADMIN)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs font-semibold">
                            <UserCheck className="w-3.5 h-3.5" />
                            كاشير (CASHIER)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-slate-400 whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          type="button"
                          onClick={() => openEditModal(u)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                          تعديل / كلمة المرور
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-400" />
                إضافة مستخدم جديد
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateUser(e)} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  الاسم الكامل
                </label>
                <input
                  type="text"
                  required
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="مثال: أحمد محمد"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  اسم المستخدم (لتسجيل الدخول)
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value)}
                  placeholder="cashier2"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  كلمة المرور (6 أحرف على الأقل)
                </label>
                <div className="relative">
                  <input
                    type={showAddPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    dir="ltr"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3.5 py-2.5 pl-10 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddPassword((v) => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showAddPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  الصلاحية (الدور)
                </label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as 'ADMIN' | 'CASHIER')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="CASHIER">كاشير (CASHIER)</option>
                  <option value="ADMIN">مدير (ADMIN)</option>
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-sm hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {creating ? 'جاري الإنشاء...' : 'حفظ المستخدم'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User / Change Password & Username Modal */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setEditingUser(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                تعديل بيانات المستخدم
              </h2>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveEdit(e)} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  الاسم الكامل
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  اسم المستخدم (Username)
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  كلمة المرور الجديدة (اتركه فارغاً للإبقاء على الحالية)
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    dir="ltr"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="•••••• (اختياري)"
                    className="w-full px-3.5 py-2.5 pl-10 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword((v) => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  الصلاحية (الدور)
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as 'ADMIN' | 'CASHIER')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="CASHIER">كاشير (CASHIER)</option>
                  <option value="ADMIN">مدير (ADMIN)</option>
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-sm hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {savingEdit ? 'جاري الحفظ...' : 'حفظ التغييرات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
