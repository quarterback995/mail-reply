import { useState, useEffect, useRef } from 'react';
import { draftService, dataService, apiService, webFetchService } from '../services/api';

const STORAGE_KEY = 'drafting_workspace';
const HISTORY_KEY = 'drafting_history';

const loadState = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
};

const loadHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
};

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

const MODEL_TIERS = {
  fast: {
    label: '快速', description: '响应最快，适合简单邮件',
    color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/30',
    models: { openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat', moonshot: 'moonshot-v1-8k', zhipu: 'glm-4-flash', xiaomi: 'mimo-v2.5' },
  },
  balanced: {
    label: '均衡', description: '速度与质量平衡，推荐日常使用',
    color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30',
    models: { openai: 'gpt-4o', anthropic: 'claude-sonnet-4-20250514', deepseek: 'deepseek-chat', moonshot: 'moonshot-v1-32k', zhipu: 'glm-4', xiaomi: 'mimo-v2-pro' },
  },
  quality: {
    label: '高质量', description: '最强能力，适合重要邮件',
    color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/30',
    models: { openai: 'gpt-4-turbo', anthropic: 'claude-3-5-sonnet-20241022', deepseek: 'deepseek-reasoner', moonshot: 'moonshot-v1-128k', zhipu: 'glm-4-plus', xiaomi: 'mimo-v2.5-pro' },
  },
};

const DraftingWorkspace = () => {
  const saved = loadState();
  const [emailContent, setEmailContent] = useState(saved.emailContent || '');
  const [generatedDraft, setGeneratedDraft] = useState(saved.generatedDraft || '');
  const [isLoading, setIsLoading] = useState(false);
  const [additionalContext, setAdditionalContext] = useState(saved.additionalContext || '');
  const [history, setHistory] = useState(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [tokenUsage, setTokenUsage] = useState(saved.tokenUsage || null);
  const [modelTier, setModelTier] = useState(saved.modelTier || 'balanced');
  const [availableApis, setAvailableApis] = useState([]);
  const [selectedApiId, setSelectedApiId] = useState(null);
  const [attachments, setAttachments] = useState(saved.attachments || []);
  const [webUrl, setWebUrl] = useState(saved.webUrl || '');
  const [webContent, setWebContent] = useState(saved.webContent || '');
  const [webTitle, setWebTitle] = useState(saved.webTitle || '');
  const [webFetching, setWebFetching] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState(null); // {task_id, pages_found, status, ...}
  const crawlPollRef = useRef(null);
  const abortRef = useRef(null);

  // Resizable panels
  const savedLayout = loadState().layout || {};
  const [leftWidth, setLeftWidth] = useState(savedLayout.leftWidth || 50); // percent
  const [bottomHeight, setBottomHeight] = useState(savedLayout.bottomHeight || 56); // px
  const draggingRef = useRef(null); // 'horizontal' | 'vertical' | null
  const startPosRef = useRef({ x: 0, y: 0, startVal: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const leftWidthRef = useRef(leftWidth);
  const bottomHeightRef = useRef(bottomHeight);
  useEffect(() => { leftWidthRef.current = leftWidth; }, [leftWidth]);
  useEffect(() => { bottomHeightRef.current = bottomHeight; }, [bottomHeight]);

  // Per-side language selection
  const [leftLang, setLeftLang] = useState(saved.leftLang || 'en');
  const [rightLang, setRightLang] = useState(saved.rightLang || 'en');
  const [translatingSide, setTranslatingSide] = useState(null);
  const [translateEngine, setTranslateEngine] = useState(saved.translateEngine || 'baidu');
  const TRANSLATE_ENGINES = [
    { id: 'baidu', label: '百度' },
    { id: 'google', label: 'Google' },
    { id: 'llm', label: 'AI' },
  ];

  // Translation state per side — originals and translations stored separately
  const [leftOriginal, setLeftOriginal] = useState(saved.leftOriginal || '');
  const [leftTranslated, setLeftTranslated] = useState(saved.leftTranslated || '');
  const [leftShowTranslated, setLeftShowTranslated] = useState(saved.leftShowTranslated || false);

  const [rightOriginal, setRightOriginal] = useState(saved.rightOriginal || '');
  const [rightTranslated, setRightTranslated] = useState(saved.rightTranslated || '');
  const [rightShowTranslated, setRightShowTranslated] = useState(saved.rightShowTranslated || false);

  // On mount: sync translation state + check for pending draft generation
  useState(() => {
    if (saved.leftShowTranslated && saved.leftTranslated) {
      setEmailContent(saved.leftTranslated);
    } else if (saved.leftOriginal) {
      setEmailContent(saved.leftOriginal);
    }
    if (saved.rightShowTranslated && saved.rightTranslated) {
      setGeneratedDraft(saved.rightTranslated);
    } else if (saved.rightOriginal) {
      setGeneratedDraft(saved.rightOriginal);
    }
  });

  // Poll for pending draft generation that continued in background
  useState(() => {
    const pending = localStorage.getItem('pending_draft');
    if (!pending) return;
    try {
      const { startTime } = JSON.parse(pending);
      setIsLoading(true);
      let elapsed = 0;
      const poll = setInterval(() => {
        elapsed += 1500;
        // Check if a new history entry appeared (generation completed)
        const hist = loadHistory();
        const found = hist.find(e => e.id >= startTime);
        if (found) {
          clearInterval(poll);
          localStorage.removeItem('pending_draft');
          setGeneratedDraft(found.draft);
          setTokenUsage(found.tokenUsage || null);
          setRightOriginal(found.draft);
          setRightTranslated('');
          setRightShowTranslated(false);
          setIsLoading(false);
          setHistory(hist);
        } else if (elapsed > 120000) {
          clearInterval(poll);
          localStorage.removeItem('pending_draft');
          setIsLoading(false);
        }
      }, 1500);
    } catch { localStorage.removeItem('pending_draft'); }
  });

  // Resume crawl polling if a task was in progress
  useEffect(() => {
    const pendingCrawl = localStorage.getItem('pending_crawl');
    if (!pendingCrawl) return;
    try {
      const { taskId } = JSON.parse(pendingCrawl);
      setCrawling(true);
      pollCrawlStatus(taskId, 0);
    } catch { localStorage.removeItem('pending_crawl'); }
  }, []);

  const pollCrawlStatus = async (taskId, retryCount = 0) => {
    try {
      const res = await webFetchService.getCrawlStatus(taskId);
      const data = res.data;
      setCrawlProgress(data);
      if (data.status === 'running') {
        crawlPollRef.current = setTimeout(() => pollCrawlStatus(taskId, 0), 2000);
      } else {
        // Completed or failed
        setCrawling(false);
        localStorage.removeItem('pending_crawl');
        if (data.status === 'completed') {
          alert(`爬取完成！共保存 ${data.pages_saved} 个页面 (${Math.round(data.total_chars / 1000)}k 字)`);
        } else {
          alert('爬取失败: ' + (data.errors?.slice(0, 3).join('\n') || '未知错误'));
        }
        setCrawlProgress(null);
      }
    } catch (err) {
      // Retry up to 10 times with increasing delay, then give up
      if (retryCount >= 10) {
        setCrawling(false);
        localStorage.removeItem('pending_crawl');
        setCrawlProgress(null);
        alert('无法连接到服务器，爬取状态未知。请刷新页面后在知识库中检查结果。');
        return;
      }
      crawlPollRef.current = setTimeout(() => pollCrawlStatus(taskId, retryCount + 1), 3000);
    }
  };

  // Load backend settings on mount (so generation uses correct config even without opening Settings)
  useEffect(() => {
    apiService.getApis().then(res => {
      const apis = res.data.apis || [];
      setAvailableApis(apis);
      if (apis.length === 0) return;
      const savedId = localStorage.getItem('selected_api_id');
      const api = apis.find(a => a.id === parseInt(savedId)) || apis[0];
      setSelectedApiId(api.id);
      localStorage.setItem('selected_api_id', api.id.toString());
      localStorage.setItem('api_provider', api.provider);
      localStorage.setItem('api_key', api.api_key);
      localStorage.setItem('api_base_url', api.base_url);
      if (api.model_fast) localStorage.setItem('custom_model_fast', api.model_fast);
      if (api.model_balanced) localStorage.setItem('custom_model_balanced', api.model_balanced);
      if (api.model_quality) localStorage.setItem('custom_model_quality', api.model_quality);
      const tier = localStorage.getItem('model_tier') || 'balanced';
      const tierModels = { fast: api.model_fast, balanced: api.model_balanced, quality: api.model_quality };
      if (tierModels[tier]) localStorage.setItem('api_model', tierModels[tier]);
    }).catch(() => {});
  }, []);

  // Cleanup crawl polling on unmount
  useEffect(() => {
    return () => { if (crawlPollRef.current) clearTimeout(crawlPollRef.current); };
  }, []);

  const handleApiSwitch = (apiId) => {
    const api = availableApis.find(a => a.id === apiId);
    if (!api) return;
    setSelectedApiId(apiId);
    localStorage.setItem('selected_api_id', apiId.toString());
    localStorage.setItem('api_provider', api.provider);
    localStorage.setItem('api_key', api.api_key);
    localStorage.setItem('api_base_url', api.base_url);
    if (api.model_fast) localStorage.setItem('custom_model_fast', api.model_fast);
    if (api.model_balanced) localStorage.setItem('custom_model_balanced', api.model_balanced);
    if (api.model_quality) localStorage.setItem('custom_model_quality', api.model_quality);
    const tier = localStorage.getItem('model_tier') || 'balanced';
    const tierModels = { fast: api.model_fast, balanced: api.model_balanced, quality: api.model_quality };
    if (tierModels[tier]) localStorage.setItem('api_model', tierModels[tier]);
  };

  const handleAddAttachments = async (fileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const newAtts = [];
    for (const file of files) {
      try {
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsText(file);
        });
        newAtts.push({ name: file.name, size: file.size, content: text });
      } catch {
        newAtts.push({ name: file.name, size: file.size, content: '' });
      }
    }
    const updated = [...attachments, ...newAtts];
    setAttachments(updated);
    persist({ attachments: updated });
  };

  const removeAttachment = (index) => {
    const updated = attachments.filter((_, i) => i !== index);
    setAttachments(updated);
    persist({ attachments: updated });
  };

  const persist = (patch) => {
    // patch MUST come last to override stale state values
    const state = {
      emailContent, generatedDraft, additionalContext, tokenUsage, modelTier, attachments,
      webUrl, webContent, webTitle,
      leftLang, rightLang,
      leftOriginal, leftTranslated, leftShowTranslated,
      rightOriginal, rightTranslated, rightShowTranslated,
      layout: { leftWidth, bottomHeight },
      ...patch,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  };

  // --- Resizable panel drag handlers ---
  const onPointerDown = (axis, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startVal = axis === 'horizontal' ? leftWidth : bottomHeight;
    draggingRef.current = axis;
    setIsDragging(true);
    document.body.style.cursor = axis === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      if (axis === 'horizontal') {
        const container = document.getElementById('workspace-panels');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        setLeftWidth(Math.min(80, Math.max(30, pct)));
      } else {
        const delta = startY - ev.clientY;
        setBottomHeight(Math.min(400, Math.max(80, startVal + delta)));
      }
    };
    const onUp = () => {
      draggingRef.current = null;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const state = {
        emailContent, generatedDraft, additionalContext, tokenUsage, modelTier, attachments,
        webUrl, webContent, webTitle,
        leftLang, rightLang,
        leftOriginal, leftTranslated, leftShowTranslated,
        rightOriginal, rightTranslated, rightShowTranslated,
        layout: { leftWidth: leftWidthRef.current, bottomHeight: bottomHeightRef.current },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const resetLayout = () => {
    setLeftWidth(50);
    setBottomHeight(56);
    persist({ layout: { leftWidth: 50, bottomHeight: 56 } });
  };

  const saveToHistory = (email, draft, context, usage, tier) => {
    const entry = { id: Date.now(), timestamp: new Date().toLocaleString('zh-CN'), emailContent: email, draft, additionalContext: context, tokenUsage: usage, modelTier: tier };
    const updated = [entry, ...history].slice(0, 50);
    setHistory(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  const getLangLabel = (code) => LANGUAGES.find(l => l.code === code)?.label || code;

  const handleTranslate = async (side) => {
    const lang = side === 'left' ? leftLang : rightLang;
    const text = side === 'left' ? emailContent : generatedDraft;
    if (!text.trim()) return;
    setTranslatingSide(side);
    try {
      const res = await dataService.translate(text, lang, translateEngine);
      const translated = res.data.translated;
      if (side === 'left') {
        setLeftOriginal(text);
        setLeftTranslated(translated);
        setLeftShowTranslated(true);
        setEmailContent(translated);
        persist({ leftOriginal: text, leftTranslated: translated, leftShowTranslated: true, leftLang: lang, emailContent: translated });
      } else {
        setRightOriginal(text);
        setRightTranslated(translated);
        setRightShowTranslated(true);
        setGeneratedDraft(translated);
        persist({ rightOriginal: text, rightTranslated: translated, rightShowTranslated: true, rightLang: lang, generatedDraft: translated });
      }
    } catch (e) { alert('翻译失败'); }
    finally { setTranslatingSide(null); }
  };

  const toggleTranslation = (side) => {
    if (side === 'left') {
      const showTranslated = !leftShowTranslated;
      setLeftShowTranslated(showTranslated);
      if (showTranslated) {
        setEmailContent(leftTranslated);
        persist({ leftShowTranslated: true, emailContent: leftTranslated });
      } else {
        setEmailContent(leftOriginal);
        persist({ leftShowTranslated: false, emailContent: leftOriginal });
      }
    } else {
      const showTranslated = !rightShowTranslated;
      setRightShowTranslated(showTranslated);
      if (showTranslated) {
        setGeneratedDraft(rightTranslated);
        persist({ rightShowTranslated: true, generatedDraft: rightTranslated });
      } else {
        setGeneratedDraft(rightOriginal);
        persist({ rightShowTranslated: false, generatedDraft: rightOriginal });
      }
    }
  };

  const clearTranslation = (side) => {
    if (side === 'left') {
      setLeftTranslated(''); setLeftShowTranslated(false);
      setEmailContent(leftOriginal);
      persist({ leftTranslated: '', leftShowTranslated: false, emailContent: leftOriginal });
    } else {
      setRightTranslated(''); setRightShowTranslated(false);
      setGeneratedDraft(rightOriginal);
      persist({ rightTranslated: '', rightShowTranslated: false, generatedDraft: rightOriginal });
    }
  };

  const handleFetchUrl = async () => {
    const url = webUrl.trim();
    if (!url) return;
    setWebFetching(true);
    try {
      const res = await webFetchService.fetchUrl(url);
      const { title, content } = res.data;
      setWebContent(content);
      setWebTitle(title || new URL(url).hostname);
      persist({ webUrl: url, webContent: content, webTitle: title || new URL(url).hostname });
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || '抓取失败';
      alert('网页抓取失败: ' + detail);
    } finally {
      setWebFetching(false);
    }
  };

  const handleClearWebContent = () => {
    setWebContent('');
    setWebTitle('');
    persist({ webContent: '', webTitle: '' });
  };

  const handleCrawlToKnowledge = async () => {
    const url = webUrl.trim();
    if (!url) return;
    if (!window.confirm(`将抓取该网站最多 50 个页面并保存到知识库，后台持续运行。继续？`)) return;
    setCrawling(true);
    setCrawlProgress(null);
    try {
      const res = await webFetchService.startCrawl(url);
      const { task_id } = res.data;
      localStorage.setItem('pending_crawl', JSON.stringify({ taskId: task_id }));
      pollCrawlStatus(task_id);
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || '启动失败';
      alert('爬取启动失败: ' + detail);
      setCrawling(false);
    }
  };

  const handleGenerate = async () => {
    if (!emailContent.trim() && attachments.length === 0) { alert('请先输入邮件内容或上传附件'); return; }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true); setTokenUsage(null);
    const startTime = Date.now();
    localStorage.setItem('pending_draft', JSON.stringify({ startTime }));
    try {
      const provider = localStorage.getItem('api_provider') || 'openai';
      const customModel = localStorage.getItem(`custom_model_${modelTier}`);
      const model = customModel?.trim() || MODEL_TIERS[modelTier].models[provider] || MODEL_TIERS[modelTier].models.openai;
      localStorage.setItem('api_model_override', model);
      let fullContent = emailContent;
      if (attachments.length > 0) {
        const attTexts = attachments.map(a => `\n[附件: ${a.name}]\n${a.content}`).join('\n');
        fullContent = fullContent + '\n\n--- 附件内容 ---' + attTexts;
      }
      const useWebContent = webContent || null;
      const res = useWebContent
        ? await draftService.generateDraftWithWeb(fullContent, additionalContext, useWebContent, { signal: controller.signal })
        : await draftService.generateDraft(fullContent, additionalContext, { signal: controller.signal });
      const draft = res.data.draft;
      setGeneratedDraft(draft); setTokenUsage(res.data.usage);
      setRightOriginal(draft); setRightTranslated(''); setRightShowTranslated(false);
      persist({ generatedDraft: draft, tokenUsage: res.data.usage, rightOriginal: draft, rightTranslated: '', rightShowTranslated: false });
      saveToHistory(emailContent, draft, additionalContext, res.data.usage, modelTier);
      localStorage.removeItem('api_model_override');
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError' || err.code === 'ERR_CANCELED') return;
      const detail = err.response?.data?.detail || err.message || '未知错误';
      alert('生成草稿失败: ' + detail);
      localStorage.removeItem('api_model_override');
    } finally {
      localStorage.removeItem('pending_draft');
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    const text = rightShowTranslated ? rightTranslated : generatedDraft;
    if (!text) return;
    // Use textarea fallback — navigator.clipboard requires HTTPS
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      alert('已复制');
    } catch {
      alert('复制失败，请手动选中后 Ctrl+C');
    }
    document.body.removeChild(ta);
  };

  const handleClear = () => {
    setEmailContent(''); setGeneratedDraft(''); setAdditionalContext(''); setTokenUsage(null); setAttachments([]);
    setWebUrl(''); setWebContent(''); setWebTitle('');
    setLeftOriginal(''); setLeftTranslated(''); setLeftShowTranslated(false);
    setRightOriginal(''); setRightTranslated(''); setRightShowTranslated(false);
    localStorage.removeItem(STORAGE_KEY);
  };

  const restoreFromHistory = (entry) => {
    setEmailContent(entry.emailContent); setGeneratedDraft(entry.draft);
    setAdditionalContext(entry.additionalContext || ''); setTokenUsage(entry.tokenUsage || null);
    setModelTier(entry.modelTier || 'balanced');
    setWebUrl(''); setWebContent(''); setWebTitle('');
    setLeftOriginal(''); setLeftTranslated(''); setLeftShowTranslated(false);
    setRightOriginal(''); setRightTranslated(''); setRightShowTranslated(false);
    persist({ ...entry, leftOriginal: '', leftTranslated: '', leftShowTranslated: false, rightOriginal: '', rightTranslated: '', rightShowTranslated: false, webUrl: '', webContent: '', webTitle: '' });
    setShowHistory(false);
  };

  const deleteHistoryEntry = (id) => {
    const updated = history.filter((e) => e.id !== id);
    setHistory(updated); localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  const handleLeftInput = (e) => {
    const val = e.target.value;
    setEmailContent(val);
    if (leftShowTranslated) {
      // Editing while showing translation → switch back to original mode with new content
      setLeftShowTranslated(false); setLeftTranslated('');
      persist({ emailContent: val, leftShowTranslated: false, leftTranslated: '' });
    } else {
      setLeftOriginal(val);
      persist({ emailContent: val, leftOriginal: val });
    }
  };

  const handleRightInput = (e) => {
    const val = e.target.value;
    setGeneratedDraft(val);
    if (rightShowTranslated) {
      setRightShowTranslated(false); setRightTranslated('');
      persist({ generatedDraft: val, rightShowTranslated: false, rightTranslated: '' });
    } else {
      setRightOriginal(val);
      persist({ generatedDraft: val, rightOriginal: val });
    }
  };

  const TranslationBar = ({ side }) => {
    const has = side === 'left' ? !!leftTranslated : !!rightTranslated;
    const showing = side === 'left' ? leftShowTranslated : rightShowTranslated;
    const lang = side === 'left' ? leftLang : rightLang;
    const setLang = side === 'left' ? setLeftLang : setRightLang;
    const langLabel = getLangLabel(lang);

    return (
      <div className="flex items-center gap-1.5">
        {has ? (
          <>
            <button onClick={() => toggleTranslation(side)}
              className={`px-2 py-1 text-xs rounded-lg transition-all flex items-center gap-1 font-medium ${
                showing
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                  : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
              }`}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              {showing ? '查看原文' : `查看${langLabel}`}
            </button>
            <button onClick={() => clearTranslation(side)}
              className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors" title="清除翻译">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </>
        ) : (
          <>
            <select value={translateEngine} onChange={(e) => { setTranslateEngine(e.target.value); persist({ translateEngine: e.target.value }); }}
              className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-gray-600 dark:text-gray-400 focus:outline-none">
              {TRANSLATE_ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <select value={lang} onChange={(e) => { setLang(e.target.value); persist({ [side === 'left' ? 'leftLang' : 'rightLang']: e.target.value }); }}
              className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-gray-600 dark:text-gray-400 focus:outline-none">
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <button onClick={() => handleTranslate(side)} disabled={translatingSide === side}
              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
              title={`翻译为 ${langLabel}`}>
              {translatingSide === side ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
              )}
            </button>
          </>
        )}
      </div>
    );
  };

  // Determine what to show in each panel — textarea value always matches the display mode
  const leftDisplay = leftShowTranslated ? leftTranslated : emailContent;
  const rightDisplay = rightShowTranslated ? rightTranslated : generatedDraft;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-gray-950 transition-colors">
      {/* Header */}
      <header className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between flex-shrink-0 transition-colors">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">草稿工作台</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">粘贴收到的邮件，生成回复草稿</p>
          </div>
          {availableApis.length > 1 && (
            <select value={selectedApiId || ''} onChange={(e) => handleApiSwitch(parseInt(e.target.value))}
              className="text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500">
              {availableApis.map(api => (
                <option key={api.id} value={api.id}>{api.name}</option>
              ))}
            </select>
          )}
        </div>
        <button onClick={() => setShowHistory(!showHistory)}
          className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          历史记录 ({history.length})
        </button>
        <button onClick={resetLayout}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="重置面板布局">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
        </button>
      </header>

      {/* Drag overlay — captures all pointer events during resize to prevent穿模 */}
      {isDragging && (
        <div className="fixed inset-0 z-50" style={{ cursor: draggingRef.current === 'horizontal' ? 'col-resize' : 'row-resize' }} />
      )}

      {/* History Panel */}
      {showHistory && (
        <div className="border-b border-gray-200 dark:border-gray-800 max-h-96 overflow-auto flex-shrink-0 bg-gray-50 dark:bg-gray-900/50 transition-colors">
          <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-gray-800 sticky top-0 border-b border-gray-100 dark:border-gray-700/50">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">历史记录</h3>
            <div className="flex gap-2 items-center">
              {history.length > 0 && (
                <button onClick={() => { if (window.confirm('确定清空全部？')) { setHistory([]); localStorage.removeItem(HISTORY_KEY); } }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors">清空全部</button>
              )}
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">暂无历史记录</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {history.map((entry) => (
                <div key={entry.id} className="px-6 py-4 hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer group flex gap-4 transition-colors" onClick={() => restoreFromHistory(entry)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-gray-400">{entry.timestamp}</span>
                      {entry.modelTier && MODEL_TIERS[entry.modelTier] && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${MODEL_TIERS[entry.modelTier].bg} ${MODEL_TIERS[entry.modelTier].color} font-medium`}>{MODEL_TIERS[entry.modelTier].label}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{entry.emailContent.slice(0, 100)}</p>
                    <p className="text-xs text-gray-400 mt-1 truncate italic">回复: {entry.draft.slice(0, 80)}...</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteHistoryEntry(entry.id); }}
                    className="self-start p-1.5 text-gray-300 dark:text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded hover:bg-red-50 dark:hover:bg-red-900/20">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex min-h-0 overflow-hidden" id="workspace-panels" style={{ position: 'relative' }}>
        {/* Left - Email Input */}
        <div className="flex flex-col border-r border-gray-200 dark:border-gray-800 min-h-0 overflow-hidden relative z-10" style={{ width: `${leftWidth}%` }}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">新邮件</h3>
              {leftShowTranslated && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-medium">
                  {getLangLabel(leftLang)} 译文
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <TranslationBar side="left" />
              <button onClick={handleClear} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">清空</button>
            </div>
          </div>
          <div className="flex-1 p-4 min-h-0 flex flex-col">
            <textarea value={leftDisplay}
              onChange={handleLeftInput}
              placeholder="在此粘贴收到的邮件..."
              className={`w-full flex-1 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent overflow-auto transition-colors font-sans leading-relaxed ${
                leftShowTranslated
                  ? 'bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 placeholder-amber-400'
                  : 'bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400'
              }`} />
            {/* Attachments area */}
            <div className="mt-2 flex-shrink-0">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachments.map((att, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg border border-blue-200 dark:border-blue-700">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                      {att.name}
                      <span className="text-blue-400 dark:text-blue-500">({(att.size / 1024).toFixed(1)}KB)</span>
                      <button onClick={() => removeAttachment(i)} className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                上传客户附件
                <input type="file" className="hidden" multiple accept=".txt,.pdf,.md,.csv,.json,.xml,.html,.doc,.docx,.jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp" onChange={(e) => { handleAddAttachments(e.target.files); e.target.value = ''; }} />
              </label>
            </div>
          </div>
        </div>

        {/* Horizontal Resize Handle */}
        <div
          onPointerDown={(e) => onPointerDown('horizontal', e)}
          className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-500/40 transition-colors group relative z-20"
          title="拖动调整左右面板宽度"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 group-hover:w-1 group-active:w-1.5 bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 rounded-full transition-all" />
        </div>

        {/* Right - Draft Output */}
        <div className="flex flex-col min-h-0 overflow-hidden relative" style={{ width: `${100 - leftWidth}%` }}>
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-shrink-0 transition-colors">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI 生成草稿</h3>
              {rightShowTranslated && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-medium">
                  {getLangLabel(rightLang)} 译文
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {generatedDraft && <TranslationBar side="right" />}
              {generatedDraft && (
                <div className="flex gap-1">
                  <button onClick={handleCopy} className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors">复制</button>
                  <button onClick={() => { setGeneratedDraft(''); setTokenUsage(null); setRightOriginal(''); setRightTranslated(''); setRightShowTranslated(false); persist({ generatedDraft: '', tokenUsage: null, rightOriginal: '', rightTranslated: '', rightShowTranslated: false }); }}
                    className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors">清空</button>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 p-4 min-h-0 overflow-auto">
            {isLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="mt-4 text-gray-500 dark:text-gray-400">正在生成回复...</p>
                </div>
              </div>
            ) : generatedDraft ? (
              <textarea value={rightDisplay}
                onChange={(e) => {
                  const val = e.target.value;
                  if (rightShowTranslated) {
                    setRightTranslated(val);
                    persist({ rightTranslated: val });
                  } else {
                    setGeneratedDraft(val);
                    setRightOriginal(val);
                    persist({ generatedDraft: val, rightOriginal: val });
                  }
                }}
                placeholder="生成的草稿将显示在这里"
                className={`w-full h-full rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent overflow-auto transition-colors font-sans leading-relaxed ${
                  rightShowTranslated
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 placeholder-amber-400'
                    : 'bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400'
                }`} />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                <p>生成的草稿将显示在这里</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Vertical Resize Handle for Bottom Bar */}
      <div
        onPointerDown={(e) => onPointerDown('vertical', e)}
        className="h-1.5 flex-shrink-0 cursor-row-resize hover:bg-blue-400/30 active:bg-blue-500/40 transition-colors group relative z-10"
        title="拖动调整底部面板高度"
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 group-hover:h-1 group-active:h-1.5 bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 rounded-full transition-all" />
      </div>

      {/* Bottom Bar */}
      <div className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-6 flex-shrink-0 transition-colors overflow-auto" style={{ height: `${bottomHeight}px` }}>
        {/* URL Fetch Row */}
        <div className="flex items-center gap-3 pt-3 pb-2">
          <div className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" /></svg>
              <input type="url" value={webUrl}
                onChange={(e) => { setWebUrl(e.target.value); persist({ webUrl: e.target.value }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFetchUrl(); }}
                placeholder="输入网页 URL 作为参考（可选）"
                className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
            </div>
            <button onClick={handleFetchUrl} disabled={webFetching || crawling || !webUrl.trim()}
              className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 rounded-lg transition-colors flex items-center gap-1.5 flex-shrink-0">
              {webFetching ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              )}
              {webFetching ? '抓取中...' : '抓取'}
            </button>
            <button onClick={handleCrawlToKnowledge} disabled={crawling || webFetching || !webUrl.trim()}
              title="抓取网站所有子页面并保存到知识库"
              className="px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-800/40 disabled:opacity-50 disabled:cursor-not-allowed text-blue-700 dark:text-blue-300 rounded-lg transition-colors flex items-center gap-1.5 flex-shrink-0">
              {crawling ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
              )}
              {crawlProgress ? (
                crawlProgress.pages_saved > 0
                  ? `已保存 ${crawlProgress.pages_saved}/${crawlProgress.pages_found} 页`
                  : crawlProgress.pages_visited > 0
                    ? `已访问 ${crawlProgress.pages_visited} 个链接`
                    : `${crawlProgress.pages_found} 页`
              ) : crawling ? '爬取中...' : '保存到知识库'}
            </button>
          </div>
          {webTitle && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg border border-green-200 dark:border-green-700 flex-shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              {webTitle.length > 20 ? webTitle.slice(0, 20) + '...' : webTitle}
              <span className="text-green-400 dark:text-green-500">({Math.round(webContent.length / 100) / 10}k字)</span>
              <button onClick={handleClearWebContent} className="ml-0.5 text-green-400 hover:text-red-500 transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          )}
        </div>
        {/* Controls Row */}
        <div className="flex items-center gap-4 pb-3">
          <div className="flex-1">
            <input type="text" value={additionalContext}
              onChange={(e) => { setAdditionalContext(e.target.value); persist({ additionalContext: e.target.value }); }}
              placeholder="附加说明（可选）：例如 '更正式一些' 或 '保持简洁'"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors">
              {Object.entries(MODEL_TIERS).map(([key, tier]) => (
                <button key={key} onClick={() => {
                  setModelTier(key);
                  persist({ modelTier: key });
                  // Sync to shared key for Settings
                  localStorage.setItem('model_tier', key);
                }}
                  title={tier.description}
                  className={`px-3 py-2 text-xs font-medium transition-all ${modelTier === key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                  {tier.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-gray-400 font-mono truncate max-w-[120px]" title={
              localStorage.getItem(`custom_model_${modelTier}`)?.trim() || MODEL_TIERS[modelTier]?.models[localStorage.getItem('api_provider') || 'openai']
            }>
              {localStorage.getItem(`custom_model_${modelTier}`)?.trim() || MODEL_TIERS[modelTier]?.models[localStorage.getItem('api_provider') || 'openai']}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleGenerate} disabled={isLoading || !emailContent.trim()}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors shadow-sm">
              {isLoading ? '生成中...' : '生成回复'}
            </button>
            {isLoading && (
              <button onClick={() => abortRef.current?.abort()}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors shadow-sm">
                停止
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DraftingWorkspace;
