import { useState, useEffect, useRef, useCallback } from 'react';
import { dataService } from '../services/api';
import { setDirty, setOnNavigateAway, setDirtyMessage, clearGuard } from '../utils/navigationGuard';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
  { code: 'pt', label: 'Português' },
  { code: 'ar', label: 'العربية' },
];

const STORAGE_KEY = 'data_library_editor';

const loadEditorState = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
};

const formatTimestamp = (ts) => {
  if (!ts) return '';
  const d = new Date(parseInt(ts));
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const DataLibrary = () => {
  const savedEditor = loadEditorState();
  const [threads, setThreads] = useState([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);
  const [isUploadingKnowledge, setIsUploadingKnowledge] = useState(false);
  const [isSavingThread, setIsSavingThread] = useState(false);
  const [activeTab, setActiveTab] = useState('style');
  const [showNewThread, setShowNewThread] = useState(savedEditor?.showNewThread || false);
  const [newThreadName, setNewThreadName] = useState(savedEditor?.newThreadName || '');
  const [newThreadMessages, setNewThreadMessages] = useState(
    savedEditor?.newThreadMessages || [
      { role: 'customer', content: '', attachments: [] },
      { role: 'user', content: '', attachments: [] },
    ]
  );
  // Editing state
  const [editingThreadId, setEditingThreadId] = useState(savedEditor?.editingThreadId || null);
  const [editingThreadFilename, setEditingThreadFilename] = useState(savedEditor?.editingThreadFilename || '');
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  // Preview modal
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  // Translation
  const [translateTarget, setTranslateTarget] = useState('en');
  const [translating, setTranslating] = useState(false);
  // Knowledge editing
  const [editingKnowledgeId, setEditingKnowledgeId] = useState(null);
  const [editingKnowledgeFilename, setEditingKnowledgeFilename] = useState('');
  const [editingKnowledgeContent, setEditingKnowledgeContent] = useState('');
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  // Knowledge search
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState('');
  const [knowledgeSearchResults, setKnowledgeSearchResults] = useState(null);
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  // Knowledge batch delete
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState(new Set());
  // Knowledge rename
  const [renamingKnowledgeId, setRenamingKnowledgeId] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  // Knowledge sort: { field: 'name'|'time'|'size', asc: boolean }
  const [knowledgeSort, setKnowledgeSort] = useState({ field: 'time', asc: false });
  // Knowledge search by title
  const [knowledgeTitleQuery, setKnowledgeTitleQuery] = useState('');
  // Knowledge pinned files (persisted in localStorage)
  const [pinnedIds, setPinnedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('knowledge_pinned') || '[]')); } catch { return new Set(); }
  });

  // Track original snapshot for dirty detection
  const originalSnapRef = useRef(JSON.stringify(savedEditor || {}));

  // Resizable split for template editor
  const savedLayout = (() => { try { return JSON.parse(localStorage.getItem('data_library_layout')) || {}; } catch { return {}; } })();
  const [splitWidth, setSplitWidth] = useState(savedLayout.splitWidth || 50); // percent
  const [editorHeight, setEditorHeight] = useState(savedLayout.editorHeight || 9999); // px, default fill available space
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);
  const splitWidthRef = useRef(splitWidth);
  const editorHeightRef = useRef(editorHeight);
  useEffect(() => { splitWidthRef.current = splitWidth; }, [splitWidth]);
  useEffect(() => { editorHeightRef.current = editorHeight; }, [editorHeight]);

  // Compute dirty state
  const isFormDirty = showNewThread && JSON.stringify({
    newThreadName, newThreadMessages, editingThreadId, editingThreadFilename, showNewThread,
  }) !== originalSnapRef.current;

  // Sync dirty state to navigation guard
  useEffect(() => {
    setDirty(isFormDirty);
    if (isFormDirty) {
      setDirtyMessage('模板编辑未完成，是否保存？');
    }
  }, [isFormDirty]);

  // Set navigate-away handler
  useEffect(() => {
    setOnNavigateAway(() => {
      handleSubmitThread();
      return true;
    });
    return () => clearGuard();
  });

  // Save editor state to localStorage
  useEffect(() => {
    if (showNewThread) {
      const state = { showNewThread, newThreadName, newThreadMessages, editingThreadId, editingThreadFilename };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [showNewThread, newThreadName, newThreadMessages, editingThreadId, editingThreadFilename]);

  // beforeunload warning
  useEffect(() => {
    const handler = (e) => { if (isFormDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isFormDirty]);

  useEffect(() => {
    loadDocuments();
    const handleFocus = () => loadDocuments();
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      localStorage.removeItem(STORAGE_KEY);
      clearGuard();
    };
  }, []);

  const loadDocuments = async () => {
    try {
      const [s, k] = await Promise.all([dataService.listStyleData(), dataService.listKnowledgeData()]);
      setThreads(s.data.documents || []);
      setKnowledgeFiles(k.data.documents || []);
    } catch (e) { console.error('加载失败:', e); }
  };

  const addMessagePair = () => setNewThreadMessages([...newThreadMessages, { role: 'customer', content: '', attachments: [] }, { role: 'user', content: '', attachments: [] }]);

  const updateMessage = (i, field, val) => {
    const u = [...newThreadMessages]; u[i] = { ...u[i], [field]: val }; setNewThreadMessages(u);
  };

  const removeMessagePair = (i) => {
    if (newThreadMessages.length <= 2) return;
    setNewThreadMessages(newThreadMessages.filter((_, idx) => idx !== i && idx !== i + 1));
  };

  const handleAttachFile = async (msgIndex, fileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const newAttachments = [];
    for (const file of files) {
      try {
        const text = await readFileAsText(file);
        newAttachments.push({ name: file.name, size: file.size, content: text });
      } catch {
        newAttachments.push({ name: file.name, size: file.size, content: `[文件: ${file.name}]` });
      }
    }
    const u = [...newThreadMessages];
    u[msgIndex] = { ...u[msgIndex], attachments: [...(u[msgIndex].attachments || []), ...newAttachments] };
    setNewThreadMessages(u);
  };

  const removeAttachment = (msgIndex, attIndex) => {
    const u = [...newThreadMessages];
    u[msgIndex] = { ...u[msgIndex], attachments: u[msgIndex].attachments.filter((_, i) => i !== attIndex) };
    setNewThreadMessages(u);
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const buildThreadText = (name, messages) => {
    const parts = messages.filter(m => m.content.trim() || (m.attachments && m.attachments.length > 0)).map(m => {
      let text = `${m.role === 'customer' ? 'Customer' : 'User'}: ${m.content}`;
      if (m.attachments && m.attachments.length > 0) {
        const attTexts = m.attachments.map(a => `\n[附件: ${a.name}]\n${a.content}`).join('\n');
        text += attTexts;
      }
      return text;
    });
    return `[Thread: ${name}]\n\n${parts.join('\n\n')}`;
  };

  const handleSubmitThread = async () => {
    if (!newThreadName.trim()) { alert('请输入模板名称'); return; }
    if (!newThreadMessages.some((m) => m.content.trim() || (m.attachments && m.attachments.length > 0))) { alert('请至少输入一条消息'); return; }
    // Clear localStorage immediately to prevent stale state on remount
    localStorage.removeItem(STORAGE_KEY);
    setIsSavingThread(true);
    const text = buildThreadText(newThreadName, newThreadMessages);
    try {
      const blob = new Blob([text], { type: 'text/plain' });
      if (editingThreadId) {
        await dataService.updateDocument('style', editingThreadId, new File([blob], `${newThreadName}.txt`, { type: 'text/plain' }));
      } else {
        await dataService.uploadStyleData(new File([blob], `${newThreadName}.txt`, { type: 'text/plain' }));
      }
      await loadDocuments();
      resetThreadForm();
      return true;
    } catch (e) { alert('保存失败: ' + (e.response?.data?.detail || e.message)); return false; }
    finally { setIsSavingThread(false); }
  };

  const resetThreadForm = () => {
    setShowNewThread(false);
    setEditingThreadId(null);
    setEditingThreadFilename('');
    setNewThreadName('');
    setNewThreadMessages([{ role: 'customer', content: '', attachments: [] }, { role: 'user', content: '', attachments: [] }]);
    originalSnapRef.current = JSON.stringify({});
    clearGuard();
    localStorage.removeItem(STORAGE_KEY);
  };

  const parseThreadContent = (content) => {
    const lines = content.split('\n');
    let threadName = '';
    const messages = [];
    let currentRole = null;
    let currentContent = '';
    let currentAttachments = [];
    let inAttachment = false;
    let attName = '';
    let attContent = '';

    for (const line of lines) {
      const nameMatch = line.match(/^\[Thread:\s*(.+?)\]$/);
      if (nameMatch) { threadName = nameMatch[1]; continue; }
      if (line.startsWith('Customer: ')) {
        if (currentRole) messages.push({ role: currentRole, content: currentContent.trim(), attachments: currentAttachments });
        currentRole = 'customer'; currentContent = line.substring(10); currentAttachments = []; inAttachment = false; continue;
      }
      if (line.startsWith('User: ')) {
        if (currentRole) messages.push({ role: currentRole, content: currentContent.trim(), attachments: currentAttachments });
        currentRole = 'user'; currentContent = line.substring(6); currentAttachments = []; inAttachment = false; continue;
      }
      const attMatch = line.match(/^\[附件:\s*(.+?)\]$/);
      if (attMatch) {
        if (inAttachment && attName) currentAttachments.push({ name: attName, size: 0, content: attContent.trim() });
        inAttachment = true; attName = attMatch[1]; attContent = ''; continue;
      }
      if (inAttachment) { attContent += line + '\n'; } else { currentContent += '\n' + line; }
    }
    if (currentRole) {
      if (inAttachment && attName) currentAttachments.push({ name: attName, size: 0, content: attContent.trim() });
      messages.push({ role: currentRole, content: currentContent.trim(), attachments: currentAttachments });
    }
    return { threadName, messages };
  };

  const handleEditThread = async (docId, filename) => {
    if (isFormDirty && !window.confirm('当前有未保存的更改，确定要切换吗？')) return;
    try {
      const res = await dataService.previewDocument('style', docId);
      const content = res.data;
      const { threadName, messages } = parseThreadContent(content);
      const name = threadName || filename.replace(/\.txt$/i, '');
      const msgs = messages.length > 0 ? messages : [{ role: 'customer', content: '', attachments: [] }, { role: 'user', content: '', attachments: [] }];
      setEditingThreadId(docId);
      setEditingThreadFilename(filename);
      setNewThreadName(name);
      setNewThreadMessages(msgs);
      setShowNewThread(true);
      // Set original snapshot after loading
      setTimeout(() => {
        originalSnapRef.current = JSON.stringify({
          newThreadName: name, newThreadMessages: msgs, editingThreadId: docId, editingThreadFilename: filename, showNewThread: true,
        });
      }, 0);
    } catch (e) { alert('加载模板失败'); }
  };

  const handleDelete = async (docType, docId) => {
    if (!window.confirm('确定删除？')) return;
    try { await dataService.deleteDocument(docType, docId); await loadDocuments(); } catch (e) { alert('删除失败'); }
  };

  const handleKnowledgeUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setIsUploadingKnowledge(true);
    try { await dataService.uploadKnowledgeData(file); await loadDocuments(); e.target.value = ''; }
    catch (err) { alert('上传失败: ' + (err.response?.data?.detail || err.message)); }
    finally { setIsUploadingKnowledge(false); }
  };

  const handlePreview = async (docType, docId, filename) => {
    setPreviewDoc({ docType, docId, filename });
    setPreviewLoading(true); setPreviewContent('');
    try { const res = await dataService.previewDocument(docType, docId); setPreviewContent(res.data); }
    catch (e) { setPreviewContent('加载预览失败'); }
    finally { setPreviewLoading(false); }
  };

  const handleEditKnowledge = async (docId, filename) => {
    try {
      const res = await dataService.previewDocument('knowledge', docId);
      setEditingKnowledgeId(docId);
      setEditingKnowledgeFilename(filename);
      setEditingKnowledgeContent(res.data);
    } catch (e) { alert('加载文档失败'); }
  };

  const handleSaveKnowledge = async () => {
    if (!editingKnowledgeContent.trim()) { alert('内容不能为空'); return; }
    setSavingKnowledge(true);
    try {
      const blob = new Blob([editingKnowledgeContent], { type: 'text/plain' });
      await dataService.updateDocument('knowledge', editingKnowledgeId, new File([blob], editingKnowledgeFilename, { type: 'text/plain' }));
      await loadDocuments();
      setEditingKnowledgeId(null);
      setEditingKnowledgeFilename('');
      setEditingKnowledgeContent('');
    } catch (e) { alert('保存失败: ' + (e.response?.data?.detail || e.message)); }
    finally { setSavingKnowledge(false); }
  };

  const handleKnowledgeSearch = async () => {
    const q = knowledgeSearchQuery.trim();
    if (!q) return;
    setKnowledgeSearching(true);
    try {
      const res = await dataService.searchKnowledge(q);
      setKnowledgeSearchResults(res.data.results || []);
    } catch (e) { alert('检索失败: ' + (e.response?.data?.detail || e.message)); }
    finally { setKnowledgeSearching(false); }
  };

  const toggleKnowledgeSelection = (docId) => {
    setSelectedKnowledgeIds(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      return next;
    });
  };

  const toggleSelectAllKnowledge = () => {
    if (selectedKnowledgeIds.size === knowledgeFiles.length) {
      setSelectedKnowledgeIds(new Set());
    } else {
      setSelectedKnowledgeIds(new Set(knowledgeFiles.map(f => f.doc_id)));
    }
  };

  const handleBatchDeleteKnowledge = async () => {
    if (selectedKnowledgeIds.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedKnowledgeIds.size} 个文档？`)) return;
    try {
      await dataService.batchDelete('knowledge', Array.from(selectedKnowledgeIds));
      setSelectedKnowledgeIds(new Set());
      await loadDocuments();
    } catch (e) { alert('批量删除失败: ' + (e.response?.data?.detail || e.message)); }
  };

  const handleRenameKnowledge = async (docId) => {
    const newName = renamingValue.trim();
    if (!newName) return;
    try {
      await dataService.renameDocument('knowledge', docId, newName);
      setRenamingKnowledgeId(null);
      await loadDocuments();
    } catch (e) { alert('重命名失败: ' + (e.response?.data?.detail || e.message)); }
  };

  const togglePinKnowledge = (docId) => {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      localStorage.setItem('knowledge_pinned', JSON.stringify([...next]));
      return next;
    });
  };

  const handleTranslatePreview = async () => {
    if (!previewContent.trim()) return;
    setTranslating(true);
    try { const res = await dataService.translate(previewContent, translateTarget); setPreviewContent(res.data.translated); }
    catch (e) { alert('翻译失败'); }
    finally { setTranslating(false); }
  };

  const handleDownload = (docType, docId) => { dataService.downloadDocument(docType, docId); };

  // Filter threads by search
  const filteredThreads = threads.filter(t =>
    !searchQuery.trim() || t.filename.toLowerCase().includes(searchQuery.toLowerCase()) || (t.preview || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const inputCls = "w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors";
  const textareaCls = "flex-1 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y transition-colors";

  const autoResize = (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.max(120, e.target.scrollHeight) + 'px';
  };

  // Split resize handlers
  const onSplitPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = splitWidth;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const container = document.getElementById('data-library-split');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitWidth(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const state = JSON.parse(localStorage.getItem('data_library_layout') || '{}');
      state.splitWidth = splitWidthRef.current;
      state.editorHeight = editorHeightRef.current;
      localStorage.setItem('data_library_layout', JSON.stringify(state));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const onEditorHeightPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = editorHeight;
    setIsDragging(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const delta = ev.clientY - startY;
      setEditorHeight(Math.min(9999, Math.max(300, startH + delta)));
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const state = JSON.parse(localStorage.getItem('data_library_layout') || '{}');
      state.splitWidth = splitWidthRef.current;
      state.editorHeight = editorHeightRef.current;
      localStorage.setItem('data_library_layout', JSON.stringify(state));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950 transition-colors">
      <header className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex-shrink-0 transition-colors">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">数据中心</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">管理您的回复模板和知识库</p>
      </header>

      <div className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 flex-shrink-0 transition-colors">
        <div className="flex gap-4">
          <button onClick={() => setActiveTab('style')}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'style' ? 'border-purple-500 text-purple-600 dark:text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            回复模板
          </button>
          <button onClick={() => setActiveTab('knowledge')}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'knowledge' ? 'border-yellow-500 text-yellow-600 dark:text-yellow-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            知识库
          </button>
        </div>
      </div>

      {/* Drag overlay */}
      {isDragging && <div className="fixed inset-0 z-50" />}

      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'style' && (
          <div className="px-6 py-4 flex items-center justify-between flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 transition-colors">
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">回复模板</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">保存历史对话记录，帮助 AI 学习您的回复风格</p>
            </div>
            {!showNewThread && (
              <button onClick={() => { resetThreadForm(); setShowNewThread(true); }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors flex items-center gap-2 shadow-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                新建模板
              </button>
            )}
          </div>
        )}

        {activeTab === 'style' ? (
          showNewThread ? (
            /* Split view: list on left, editor on right */
            <div id="data-library-split" className="flex-1 flex min-h-0 overflow-hidden">
              {/* Left: template list */}
              <div className="flex flex-col min-h-0 overflow-auto p-6" style={{ width: `${splitWidth}%` }}>
                {threads.length > 0 && (
                  <div className="mb-4">
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索模板名称或内容..."
                        className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
                      {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                    {searchQuery && <p className="text-xs text-gray-400 mt-2">找到 {filteredThreads.length} 个模板</p>}
                  </div>
                )}
                {filteredThreads.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p>{searchQuery ? '没有匹配的模板' : '暂无回复模板'}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredThreads.map((t) => (
                      <div key={t.doc_id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          editingThreadId === t.doc_id
                            ? 'bg-purple-50 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700'
                            : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                        }`} onClick={() => handleEditThread(t.doc_id, t.filename)}>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-200 truncate">{t.filename}</p>
                        {t.preview && <p className="text-xs text-gray-400 mt-0.5 truncate">{t.preview.slice(0, 60)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Resize handle */}
              <div
                onPointerDown={onSplitPointerDown}
                className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-500/40 transition-colors group relative z-10"
                title="拖动调整宽度"
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 group-hover:w-1 group-active:w-1.5 bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 rounded-full transition-all" />
              </div>

              {/* Right: editor */}
              <div className="flex-1 flex flex-col min-h-0 overflow-auto">
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 transition-colors flex flex-col" style={{ height: `${editorHeight}px` }}>
                  <div className="flex-1 flex flex-col min-h-0 overflow-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                      {editingThreadId ? '编辑模板' : '新建模板'}
                      {editingThreadFilename && <span className="ml-2 text-sm text-gray-400 font-normal">({editingThreadFilename})</span>}
                      {isFormDirty && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">未保存</span>}
                    </h4>
                    <button onClick={() => { if (isFormDirty && !window.confirm('有未保存的更改，确定关闭吗？')) return; resetThreadForm(); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">模板名称</label>
                    <input type="text" value={newThreadName} onChange={(e) => setNewThreadName(e.target.value)}
                      placeholder="例如：客户咨询回复示例" className={inputCls} />
                  </div>
                  <div className="mb-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-400">对话内容</label>
                  </div>
                  <div className="space-y-4 pr-1 mb-4 flex-1 min-h-0 overflow-auto">
                    {newThreadMessages.map((msg, i) => (
                      <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                        <div className="flex gap-3">
                          <div className="w-16 flex-shrink-0 pt-2">
                            <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${msg.role === 'customer' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'}`}>
                              {msg.role === 'customer' ? '客户' : '用户'}
                            </span>
                          </div>
                          <div className="flex-1 flex flex-col gap-2">
                            <textarea value={msg.content} onChange={(e) => { updateMessage(i, 'content', e.target.value); autoResize(e); }}
                              onInput={autoResize}
                              placeholder={msg.role === 'customer' ? '客户的消息...' : '您的回复...'} rows={4}
                              style={{ minHeight: '120px' }}
                              className={textareaCls} />
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {msg.attachments.map((att, ai) => (
                                  <span key={ai} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-md border border-gray-200 dark:border-gray-600">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                    {att.name}
                                    <button onClick={() => removeAttachment(i, ai)} className="ml-0.5 text-gray-400 hover:text-red-500">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <label className="self-start cursor-pointer inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                              添加附件
                              <input type="file" className="hidden" multiple accept=".txt,.pdf,.md,.csv,.json,.xml,.html,.doc,.docx,.jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp" onChange={(e) => { handleAttachFile(i, e.target.files); e.target.value = ''; }} />
                            </label>
                          </div>
                          {i >= 2 && i % 2 === 0 && (
                            <button onClick={() => removeMessagePair(i)} className="self-start p-2 text-gray-400 hover:text-red-500">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button onClick={addMessagePair}
                      className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors flex items-center gap-2 border border-gray-200 dark:border-gray-700">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                      添加对话轮次
                    </button>
                    <button onClick={handleSubmitThread} disabled={isSavingThread}
                      className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm flex items-center gap-2 ${isSavingThread ? 'opacity-60 cursor-not-allowed' : ''}`}>
                      {isSavingThread ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>保存中...</> : (editingThreadId ? '保存修改' : '保存模板')}
                    </button>
                    {editingThreadId && (
                      <button onClick={() => { if (isFormDirty && !window.confirm('有未保存的更改，确定取消吗？')) return; resetThreadForm(); }}
                        className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors border border-gray-200 dark:border-gray-700">
                        取消编辑
                      </button>
                    )}
                  </div>
                  </div>{/* close inner scroll div */}
                  {/* Vertical resize handle for editor height */}
                  <div
                    onPointerDown={onEditorHeightPointerDown}
                    className="h-1.5 mt-4 -mx-6 -mb-6 cursor-row-resize hover:bg-blue-400/30 active:bg-blue-500/40 transition-colors group relative rounded-b-xl"
                    title="拖动调整编辑区域高度"
                  >
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 group-hover:h-1 group-active:h-1.5 bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 rounded-full transition-all" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Normal list view */
            <div className="flex-1 overflow-auto p-6">
              {/* Search bar */}
            {threads.length > 0 && (
              <div className="mb-4">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索模板名称或内容..."
                    className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
                {searchQuery && (
                  <p className="text-xs text-gray-400 mt-2">找到 {filteredThreads.length} 个模板</p>
                )}
              </div>
            )}

            {filteredThreads.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                <p className="text-lg">{searchQuery ? '没有匹配的模板' : '暂无回复模板'}</p>
                <p className="text-sm mt-2">{searchQuery ? '尝试其他关键词' : '创建第一个模板，提供您的回复风格样本'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredThreads.map((t) => (
                  <div key={t.doc_id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
                        <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                      </div>
                      <div>
                        <p className="text-gray-900 dark:text-gray-200 font-medium">{t.filename}</p>
                        {t.preview && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-md">{t.preview.slice(0, 80)}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEditThread(t.doc_id, t.filename)}
                        className="p-2 text-gray-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors" title="编辑">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => handlePreview('style', t.doc_id, t.filename)}
                        className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="预览">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      </button>
                      <button onClick={() => handleDownload('style', t.doc_id)}
                        className="p-2 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors" title="下载">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </button>
                      <button onClick={() => handleDelete('style', t.doc_id)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="删除">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )
        ) : (
          <div className="flex-1 overflow-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">知识库</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">上传参考文档（菜单、政策等）</p>
              </div>
              <label className={`cursor-pointer px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors flex items-center gap-2 shadow-sm ${isUploadingKnowledge ? 'opacity-50' : ''}`}>
                {isUploadingKnowledge ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>上传中...</> : '上传文件'}
                <input type="file" className="hidden" accept=".txt,.pdf,.md,.jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp" onChange={handleKnowledgeUpload} disabled={isUploadingKnowledge} />
              </label>
            </div>

            {/* Semantic Search Bar */}
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">语义检索测试</span>
                <span className="text-xs text-gray-400">— 测试 RAG 会检索到哪些内容</span>
              </div>
              <div className="flex gap-2">
                <input type="text" value={knowledgeSearchQuery}
                  onChange={(e) => setKnowledgeSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleKnowledgeSearch(); }}
                  placeholder="输入关键词或问题，例如：营业时间、退款政策..."
                  className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition-colors" />
                <button onClick={handleKnowledgeSearch} disabled={knowledgeSearching || !knowledgeSearchQuery.trim()}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 text-white text-sm rounded-lg transition-colors flex items-center gap-1.5">
                  {knowledgeSearching ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : '检索'}
                </button>
              </div>
              {knowledgeSearchResults !== null && (
                <div className="mt-3">
                  {knowledgeSearchResults.length === 0 ? (
                    <p className="text-xs text-gray-400">未找到相关内容</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-400">找到 {knowledgeSearchResults.length} 个相关片段：</p>
                      {knowledgeSearchResults.map((r, i) => (
                        <div key={i} className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-yellow-600 dark:text-yellow-400 font-medium">{r.metadata?.filename || '未知'}</span>
                            <span className="text-gray-400">片段 {r.metadata?.chunk_index ?? i}</span>
                          </div>
                          <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap line-clamp-4">{r.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Title search bar */}
            {knowledgeFiles.length > 0 && !editingKnowledgeId && (
              <div className="mb-3">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input type="text" value={knowledgeTitleQuery} onChange={(e) => setKnowledgeTitleQuery(e.target.value)}
                    placeholder="搜索文件标题..."
                    className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition-colors" />
                  {knowledgeTitleQuery && (
                    <button onClick={() => setKnowledgeTitleQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
                {knowledgeTitleQuery && <p className="text-xs text-gray-400 mt-1.5">找到 {knowledgeFiles.filter(f => f.filename.toLowerCase().includes(knowledgeTitleQuery.toLowerCase())).length} 个文件</p>}
              </div>
            )}

            {/* Sort bar */}
            {knowledgeFiles.length > 1 && !editingKnowledgeId && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-gray-400">排序:</span>
                {[
                  { field: 'name', label: '名称' },
                  { field: 'time', label: '时间' },
                  { field: 'size', label: '大小' },
                ].map((opt) => (
                  <button key={opt.field}
                    onClick={() => setKnowledgeSort((prev) => ({
                      field: opt.field,
                      asc: prev.field === opt.field ? !prev.asc : opt.field === 'name',
                    }))}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      knowledgeSort.field === opt.field
                        ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 font-medium'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}>
                    {opt.label}
                    {knowledgeSort.field === opt.field && (
                      <span className="ml-0.5">{knowledgeSort.asc ? '↑' : '↓'}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Knowledge file list */}
            {knowledgeFiles.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <p className="text-lg">暂无知识库文档</p>
              </div>
            ) : editingKnowledgeId ? (
              /* Inline editor for knowledge */
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                    编辑文档
                    <span className="ml-2 text-sm text-gray-400 font-normal">({editingKnowledgeFilename})</span>
                  </h4>
                  <button onClick={() => { setEditingKnowledgeId(null); setEditingKnowledgeContent(''); }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <textarea value={editingKnowledgeContent}
                  onChange={(e) => setEditingKnowledgeContent(e.target.value)}
                  className="w-full h-[500px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-4 text-sm text-gray-900 dark:text-white font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-y transition-colors" />
                <div className="flex gap-3 mt-4">
                  <button onClick={handleSaveKnowledge} disabled={savingKnowledge}
                    className={`px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors flex items-center gap-2 shadow-sm ${savingKnowledge ? 'opacity-60 cursor-not-allowed' : ''}`}>
                    {savingKnowledge ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>保存中...</> : '保存修改'}
                  </button>
                  <button onClick={() => { setEditingKnowledgeId(null); setEditingKnowledgeContent(''); }}
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors border border-gray-200 dark:border-gray-700">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Batch actions bar */}
                {knowledgeFiles.length > 0 && (
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-gray-400">
                        <input type="checkbox"
                          checked={selectedKnowledgeIds.size === knowledgeFiles.length && knowledgeFiles.length > 0}
                          onChange={toggleSelectAllKnowledge}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-yellow-600 focus:ring-yellow-500" />
                        全选 ({selectedKnowledgeIds.size}/{knowledgeFiles.length})
                      </label>
                      {selectedKnowledgeIds.size > 0 && (
                        <button onClick={handleBatchDeleteKnowledge}
                          className="px-3 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors flex items-center gap-1 border border-red-200 dark:border-red-800">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          删除选中 ({selectedKnowledgeIds.size})
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {[...knowledgeFiles]
                    .filter(f => !knowledgeTitleQuery.trim() || (f.filename || '').toLowerCase().includes(knowledgeTitleQuery.toLowerCase()))
                    .sort((a, b) => {
                      // Pinned files always first
                      const aPinned = pinnedIds.has(a.doc_id) ? 1 : 0;
                      const bPinned = pinnedIds.has(b.doc_id) ? 1 : 0;
                      if (aPinned !== bPinned) return bPinned - aPinned;
                      // Then apply selected sort
                      const { field, asc } = knowledgeSort;
                      let cmp = 0;
                      if (field === 'name') cmp = (a.filename || '').localeCompare(b.filename || '');
                      else if (field === 'time') cmp = (parseInt(a.created_at) || 0) - (parseInt(b.created_at) || 0);
                      else if (field === 'size') cmp = (parseInt(a.content_size) || 0) - (parseInt(b.content_size) || 0);
                      return asc ? cmp : -cmp;
                    }).map((f) => (
                    <div key={f.doc_id} className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                      selectedKnowledgeIds.has(f.doc_id)
                        ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700'
                        : pinnedIds.has(f.doc_id)
                          ? 'bg-yellow-50/50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800'
                          : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                    }`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <input type="checkbox"
                          checked={selectedKnowledgeIds.has(f.doc_id)}
                          onChange={() => toggleKnowledgeSelection(f.doc_id)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-yellow-600 focus:ring-yellow-500 flex-shrink-0" />
                        <div className="w-10 h-10 rounded-lg bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          {renamingKnowledgeId === f.doc_id ? (
                            <div className="flex items-center gap-2">
                              <input type="text" value={renamingValue}
                                onChange={(e) => setRenamingValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameKnowledge(f.doc_id); if (e.key === 'Escape') setRenamingKnowledgeId(null); }}
                                autoFocus
                                className="flex-1 bg-white dark:bg-gray-800 border border-yellow-400 dark:border-yellow-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500" />
                              <button onClick={() => handleRenameKnowledge(f.doc_id)}
                                className="p-1 text-yellow-600 hover:text-yellow-700" title="确认">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              </button>
                              <button onClick={() => setRenamingKnowledgeId(null)}
                                className="p-1 text-gray-400 hover:text-gray-600" title="取消">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-gray-900 dark:text-gray-200 font-medium truncate">{f.filename}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {f.preview && <p className="text-xs text-gray-400 truncate max-w-md">{f.preview.slice(0, 60)}</p>}
                                {f.content_size && parseInt(f.content_size) > 0 && (
                                  <span className="text-xs text-gray-300 dark:text-gray-600 flex-shrink-0">
                                    {parseInt(f.content_size) >= 1000 ? `${(parseInt(f.content_size) / 1000).toFixed(1)}k字` : `${f.content_size}字`}
                                  </span>
                                )}
                                {f.created_at && <span className="text-xs text-gray-300 dark:text-gray-600 flex-shrink-0">{formatTimestamp(f.created_at)}</span>}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => togglePinKnowledge(f.doc_id)}
                          className={`p-2 rounded-lg transition-colors ${pinnedIds.has(f.doc_id) ? 'text-yellow-500 hover:text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20' : 'text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'}`}
                          title={pinnedIds.has(f.doc_id) ? '取消置顶' : '置顶'}>
                          <svg className="w-4 h-4" fill={pinnedIds.has(f.doc_id) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                        </button>
                        <button onClick={() => { setRenamingKnowledgeId(f.doc_id); setRenamingValue(f.filename); }}
                          className="p-2 text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors" title="重命名">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => handleEditKnowledge(f.doc_id, f.filename)}
                          className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="编辑内容">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => handlePreview('knowledge', f.doc_id, f.filename)}
                          className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="预览">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                        <button onClick={() => handleDownload('knowledge', f.doc_id)}
                          className="p-2 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors" title="下载">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </button>
                        <button onClick={() => handleDelete('knowledge', f.doc_id)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="删除">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setPreviewDoc(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 w-[800px] max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">{previewDoc.filename}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{previewDoc.docType === 'style' ? '回复模板' : '知识库文档'} - 预览</p>
              </div>
              <div className="flex items-center gap-2">
                <select value={translateTarget} onChange={(e) => setTranslateTarget(e.target.value)}
                  className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-300">
                  {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <button onClick={handleTranslatePreview} disabled={translating}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-1">
                  {translating ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : '翻译'}
                </button>
                <button onClick={() => handleDownload(previewDoc.docType, previewDoc.docId)}
                  className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  下载
                </button>
                <button onClick={() => setPreviewDoc(null)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {previewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-mono leading-relaxed">{previewContent}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataLibrary;
