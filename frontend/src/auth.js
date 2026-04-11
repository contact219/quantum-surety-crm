export const getToken = () => localStorage.getItem('crm_token');
export const getUser = () => { try { return JSON.parse(localStorage.getItem('crm_user')||'null'); } catch(e){ return null; } };
export const setAuth = (token, user) => { localStorage.setItem('crm_token', token); localStorage.setItem('crm_user', JSON.stringify(user)); };
export const clearAuth = () => { localStorage.removeItem('crm_token'); localStorage.removeItem('crm_user'); };
export const isAdmin = () => getUser()?.role === 'admin';
export const isReadOnly = () => getUser()?.role === 'readonly';

export const apiFetch = async (url, options = {}) => {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers||{}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401) { clearAuth(); window.location.href = '/login'; }
  return r;
};
