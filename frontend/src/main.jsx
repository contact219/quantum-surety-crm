// The pages call bare fetch() in ~99 places and none of them sent the CRM's JWT,
// which is why the API had to sit behind nginx basic auth instead. Patching
// window.fetch here attaches the token to every same-origin /api/ request at
// once -- no call sites change, and none can be missed. Runs before React
// mounts, so the first request on page load is already covered.
const _origFetch = window.fetch.bind(window);
let _reloading = false;
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const isApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
  const isLogin = url.indexOf('/api/auth/login') !== -1;
  if (isApi && !isLogin) {
    const token = localStorage.getItem('crm_token');
    if (token) {
      const headers = new Headers(
        init.headers ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
      );
      if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
      init = Object.assign({}, init, { headers });
    }
  }
  return _origFetch(input, init).then((r) => {
    if (r.status === 401 && isApi && !isLogin && !_reloading) {
      _reloading = true;
      localStorage.removeItem('crm_token');
      localStorage.removeItem('crm_user');
      window.location.reload();
    }
    return r;
  });
};

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter><App /></BrowserRouter>
);
