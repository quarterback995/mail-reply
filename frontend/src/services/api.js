import axios from 'axios';

const isDev = import.meta.env.DEV;
const API_BASE_URL = isDev
  ? 'http://localhost:8001/api'
  : '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: inject session token + API settings
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('session_token');
  if (token) {
    config.headers['X-Session-Token'] = token;
  }

  // Only inject API settings for non-settings, non-auth routes
  if (!config.url.includes('/settings/') && !config.url.includes('/auth/')) {
    const apiKey = localStorage.getItem('api_key');
    if (apiKey) {
      config.headers['X-API-Key'] = apiKey;
    }
    // Always send provider/model so workspace tier switching works
    config.headers['X-API-Provider'] = localStorage.getItem('api_provider');
    config.headers['X-API-Model'] = localStorage.getItem('api_model_override') || localStorage.getItem('api_model');
    config.headers['X-API-Base-URL'] = localStorage.getItem('api_base_url');
    config.headers['X-Temperature'] = localStorage.getItem('temperature');
    const maxTokens = localStorage.getItem('max_tokens');
    if (maxTokens) config.headers['X-Max-Tokens'] = maxTokens;
  }

  return config;
});

// Response interceptor: handle 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('session_token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

// Auth service
export const authService = {
  login: (username, password) =>
    axios.post(`${API_BASE_URL}/auth/login`, { username, password }),
  register: (username, password) =>
    axios.post(`${API_BASE_URL}/auth/register`, { username, password }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  getQuota: () => api.get('/auth/quota'),
  getPermissions: () => api.get('/auth/permissions'),
  getAuditLogs: (limit = 50) => api.get(`/auth/audit?limit=${limit}`),
};

// Data service
export const dataService = {
  uploadStyleData: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/data/upload/style', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listStyleData: () => api.get('/data/list/style'),
  uploadKnowledgeData: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/data/upload/knowledge', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listKnowledgeData: () => api.get('/data/list/knowledge'),
  previewDocument: (docType, docId) => api.get(`/data/preview/${docType}/${docId}`, { responseType: 'text' }),
  downloadDocument: (docType, docId) => {
    const token = localStorage.getItem('session_token');
    window.open(`${API_BASE_URL}/data/download/${docType}/${docId}?token=${token}`, '_blank');
  },
  deleteDocument: (docType, docId) => api.delete(`/data/${docType}/${docId}`),
  renameDocument: (docType, docId, newFilename) => api.post(`/data/rename/${docType}/${docId}`, { new_filename: newFilename }),
  batchDelete: (docType, docIds) => api.post(`/data/batch-delete/${docType}`, { doc_ids: docIds }),
  searchKnowledge: (query, k = 5) => api.post('/data/search/knowledge', { query, k }),
  updateDocument: (docType, docId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.put(`/data/${docType}/${docId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  translate: (text, targetLang, engine = 'baidu') => api.post('/data/translate', { text, target_lang: targetLang, engine }),
};

// Draft service
export const draftService = {
  generateDraft: (emailContent, additionalContext = null, config = {}) =>
    api.post('/draft/generate', {
      email_content: emailContent,
      additional_context: additionalContext,
    }, { timeout: 300000, ...config }),
  generateDraftWithWeb: (emailContent, additionalContext = null, webContent = null, config = {}) =>
    api.post('/draft/generate', {
      email_content: emailContent,
      additional_context: additionalContext,
      web_content: webContent,
    }, { timeout: 300000, ...config }),
};

// URL fetch service
export const webFetchService = {
  fetchUrl: (url) => api.post('/data/fetch-url', { url }, { timeout: 30000 }),
  startCrawl: (url, maxDepth = 2) =>
    api.post('/data/crawl-url', { url, max_depth: maxDepth }, { timeout: 30000 }),
  getCrawlStatus: (taskId) =>
    api.get(`/data/crawl-status/${taskId}`, { timeout: 10000 }),
};

// Records service
export const recordsService = {
  list: (limit = 100, offset = 0) => api.get(`/records/list?limit=${limit}&offset=${offset}`),
  get: (id) => api.get(`/records/${id}`),
  delete: (id) => api.delete(`/records/${id}`),
  clearAll: () => api.delete('/records/'),
};

// Settings service
export const apiService = {
  testConnection: async (config) => {
    const url = isDev ? `${API_BASE_URL}/settings/test-connection` : '/api/settings/test-connection';
    return axios.post(url, config, {
      headers: { 'Content-Type': 'application/json' },
    });
  },
  saveSettings: (settings) => {
    const url = isDev ? `${API_BASE_URL}/settings/save` : '/api/settings/save';
    return axios.post(url, settings, {
      headers: { 'Content-Type': 'application/json' },
    });
  },
  getStatus: () => api.get('/settings/status'),
  getLockedSettings: () => api.get('/settings/locked'),
  getApis: () => api.get('/settings/apis'),
};

export default api;
