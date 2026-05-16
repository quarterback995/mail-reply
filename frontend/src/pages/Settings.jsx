import { useState, useEffect, useRef } from 'react';
import { apiService } from '../services/api';
import { setDirty, setOnNavigateAway, clearGuard } from '../utils/navigationGuard';

const MODEL_TIERS = {
  fast: {
    label: '快速', description: '响应最快，适合简单邮件',
    color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/30', border: 'border-green-200 dark:border-green-800',
    models: { openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat', moonshot: 'moonshot-v1-8k', zhipu: 'glm-4-flash', xiaomi: 'mimo-v2.5' },
  },
  balanced: {
    label: '均衡', description: '速度与质量平衡，推荐日常使用',
    color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-800',
    models: { openai: 'gpt-4o', anthropic: 'claude-sonnet-4-20250514', deepseek: 'deepseek-chat', moonshot: 'moonshot-v1-32k', zhipu: 'glm-4', xiaomi: 'mimo-v2-pro' },
  },
  quality: {
    label: '高质量', description: '最强能力，适合重要邮件',
    color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/30', border: 'border-purple-200 dark:border-purple-800',
    models: { openai: 'gpt-4-turbo', anthropic: 'claude-3-5-sonnet-20241022', deepseek: 'deepseek-reasoner', moonshot: 'moonshot-v1-128k', zhipu: 'glm-4-plus', xiaomi: 'mimo-v2.5-pro' },
  },
};

const providers = {
  openai: { name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic (Claude)', defaultBaseUrl: 'https://api.anthropic.com' },
  deepseek: { name: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com' },
  moonshot: { name: 'Moonshot (月之暗面)', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  zhipu: { name: '智谱 AI (GLM)', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  xiaomi: { name: '小米 MiMo', defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
  custom: { name: '自定义', defaultBaseUrl: '' },
};

const getSnapshot = (provider, key, url, temp, tier, customs) =>
  JSON.stringify({ provider, key, url, temp, tier, customs });

const Settings = () => {
  const [apiProvider, setApiProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modelTier, setModelTier] = useState('balanced');
  const [customModels, setCustomModels] = useState({ fast: '', balanced: '', quality: '' });
  const [locked, setLocked] = useState({});
  const [backendConfig, setBackendConfig] = useState(null);
  const [configMode, setConfigMode] = useState('backend'); // 'backend' = use .env defaults, 'custom' = user editable
  const [availableApis, setAvailableApis] = useState([]);
  const [selectedApiId, setSelectedApiId] = useState(null);
  const savedSnapRef = useRef('');

  const getEffectiveModel = (tier) => {
    const custom = customModels[tier]?.trim();
    if (custom) return custom;
    return MODEL_TIERS[tier]?.models[apiProvider] || MODEL_TIERS[tier]?.models.openai || '';
  };

  const getCurrentModel = () => getEffectiveModel(modelTier);

  // Check dirty on every relevant state change
  // Sync api_model to localStorage whenever tier or provider changes
  useEffect(() => {
    const model = getCurrentModel();
    if (model) localStorage.setItem('api_model', model);
  }, [modelTier, apiProvider, customModels]);

  // Select a pre-configured API and apply its settings
  const handleApiSelect = (apiId) => {
    const api = availableApis.find(a => a.id === apiId);
    if (!api) return;
    setSelectedApiId(apiId);
    localStorage.setItem('selected_api_id', apiId.toString());
    setApiProvider(api.provider);
    setApiKey(api.api_key);
    setApiBaseUrl(api.base_url);
    const newCustoms = { ...customModels };
    if (api.model_fast) newCustoms.fast = api.model_fast;
    if (api.model_balanced) newCustoms.balanced = api.model_balanced;
    if (api.model_quality) newCustoms.quality = api.model_quality;
    setCustomModels(newCustoms);
    // Update localStorage immediately
    localStorage.setItem('api_provider', api.provider);
    localStorage.setItem('api_key', api.api_key);
    localStorage.setItem('api_base_url', api.base_url);
    if (api.model_fast) localStorage.setItem('custom_model_fast', api.model_fast);
    if (api.model_balanced) localStorage.setItem('custom_model_balanced', api.model_balanced);
    if (api.model_quality) localStorage.setItem('custom_model_quality', api.model_quality);
    // Sync current tier model
    const tier = localStorage.getItem('model_tier') || 'balanced';
    const tierModels = { fast: api.model_fast, balanced: api.model_balanced, quality: api.model_quality };
    if (tierModels[tier]) localStorage.setItem('api_model', tierModels[tier]);
  };

  // When switching to 'backend' mode, restore backend locked values
  const handleConfigModeChange = (mode) => {
    setConfigMode(mode);
    if (mode === 'backend' && backendConfig) {
      if (locked.api_provider && backendConfig.api_provider) setApiProvider(backendConfig.api_provider);
      if (locked.api_key && backendConfig.api_key) setApiKey(backendConfig.api_key);
      if (locked.api_base_url && backendConfig.api_base_url !== undefined) setApiBaseUrl(backendConfig.api_base_url);
      if (locked.temperature && backendConfig.temperature) setTemperature(backendConfig.temperature);
      const newCustoms = { ...customModels };
      if (locked.model_fast && backendConfig.model_fast) newCustoms.fast = backendConfig.model_fast;
      if (locked.model_balanced && backendConfig.model_balanced) newCustoms.balanced = backendConfig.model_balanced;
      if (locked.model_quality && backendConfig.model_quality) newCustoms.quality = backendConfig.model_quality;
      setCustomModels(newCustoms);
    }
  };

  // Check dirty on every relevant state change
  useEffect(() => {
    const snap = getSnapshot(apiProvider, apiKey, apiBaseUrl, temperature, modelTier, customModels);
    const dirty = snap !== savedSnapRef.current;
    setDirty(dirty);

    // beforeunload for browser close/refresh
    const handler = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [apiProvider, apiKey, apiBaseUrl, temperature, modelTier, customModels]);

  // Set navigate-away handler for Layout to call
  useEffect(() => {
    setOnNavigateAway(() => handleSave);
    return () => clearGuard();
  });

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    // Load locked settings from backend
    let hasLockedValues = false;
    try {
      const res = await apiService.getLockedSettings();
      const lk = res.data.locked || {};
      const cfg = res.data.config || {};
      setLocked(lk);
      setBackendConfig(cfg);
      hasLockedValues = Object.values(lk).some(v => v);
      // If backend has fixed values, apply them (override localStorage)
      if (lk.api_key && cfg.api_key) localStorage.setItem('api_key', cfg.api_key);
      if (lk.api_provider && cfg.api_provider) localStorage.setItem('api_provider', cfg.api_provider);
      if (lk.api_model && cfg.api_model) localStorage.setItem('api_model', cfg.api_model);
      if (lk.api_base_url && cfg.api_base_url) localStorage.setItem('api_base_url', cfg.api_base_url);
      if (lk.temperature && cfg.temperature) localStorage.setItem('temperature', cfg.temperature.toString());
      // Tier model locks — override custom_model_{tier}
      if (lk.model_fast && cfg.model_fast) localStorage.setItem('custom_model_fast', cfg.model_fast);
      if (lk.model_balanced && cfg.model_balanced) localStorage.setItem('custom_model_balanced', cfg.model_balanced);
      if (lk.model_quality && cfg.model_quality) localStorage.setItem('custom_model_quality', cfg.model_quality);
    } catch {}

    // Load available APIs from backend
    try {
      const apisRes = await apiService.getApis();
      const apis = apisRes.data.apis || [];
      setAvailableApis(apis);
      if (apis.length > 0) {
        // Select the first API by default
        const savedApiId = localStorage.getItem('selected_api_id');
        const match = apis.find(a => a.id === parseInt(savedApiId));
        setSelectedApiId(match ? match.id : apis[0].id);
      }
    } catch {}

    // Default to 'backend' mode if .env has locked values, otherwise 'custom'
    setConfigMode(hasLockedValues ? 'backend' : 'custom');

    // Load local settings (possibly overridden by backend locked values)
    const p = localStorage.getItem('api_provider') || 'openai';
    const k = localStorage.getItem('api_key') || '';
    const u = localStorage.getItem('api_base_url') || '';
    const t = parseFloat(localStorage.getItem('temperature') || '0.7');

    let tier = 'balanced';
    try {
      const ws = JSON.parse(localStorage.getItem('drafting_workspace'));
      if (ws?.modelTier && MODEL_TIERS[ws.modelTier]) tier = ws.modelTier;
    } catch {}
    if (!localStorage.getItem('drafting_workspace')) {
      tier = localStorage.getItem('model_tier') || 'balanced';
    }

    const customs = {
      fast: localStorage.getItem('custom_model_fast') || '',
      balanced: localStorage.getItem('custom_model_balanced') || '',
      quality: localStorage.getItem('custom_model_quality') || '',
    };

    setApiProvider(p); setApiKey(k); setApiBaseUrl(u);
    setTemperature(t); setModelTier(tier);
    setCustomModels(customs);
    savedSnapRef.current = getSnapshot(p, k, u, t, tier, customs);
  };

  const handleTierChange = (tier) => {
    setModelTier(tier);
    try {
      const ws = JSON.parse(localStorage.getItem('drafting_workspace')) || {};
      ws.modelTier = tier;
      localStorage.setItem('drafting_workspace', JSON.stringify(ws));
    } catch {}
    localStorage.setItem('model_tier', tier);
    localStorage.setItem('api_model', getEffectiveModel(tier));
  };

  const setCustomModel = (tier, value) => {
    setCustomModels(prev => ({ ...prev, [tier]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const model = getCurrentModel();
      const settings = {
        api_provider: apiProvider, api_model: model, api_key: apiKey, api_base_url: apiBaseUrl,
        temperature: temperature.toString(),
      };
      Object.entries(settings).forEach(([k, v]) => localStorage.setItem(k, v));
      localStorage.setItem('model_tier', modelTier);
      Object.entries(customModels).forEach(([tier, name]) => {
        localStorage.setItem(`custom_model_${tier}`, name);
      });
      localStorage.removeItem('custom_model');
      localStorage.removeItem('use_custom_model');
      try {
        const ws = JSON.parse(localStorage.getItem('drafting_workspace')) || {};
        ws.modelTier = modelTier;
        localStorage.setItem('drafting_workspace', JSON.stringify(ws));
      } catch {}
      await apiService.saveSettings(settings);
      // Update saved snapshot so dirty resets
      savedSnapRef.current = getSnapshot(apiProvider, apiKey, apiBaseUrl, temperature, modelTier, customModels);
      setDirty(false);
      return true;
    } catch (err) {
      alert('保存失败: ' + err.message);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey) { setTestResult({ success: false, message: '请先输入 API Key' }); return; }
    setIsTesting(true); setTestResult(null);
    try {
      const model = getCurrentModel();
      const baseUrl = apiBaseUrl || providers[apiProvider]?.defaultBaseUrl;
      const result = await apiService.testConnection({ provider: apiProvider, model, apiKey, baseUrl, temperature });
      setTestResult(result.data);
    } catch (err) {
      setTestResult({ success: false, message: '连接失败: ' + (err.response?.data?.detail || err.message) });
    } finally { setIsTesting(false); }
  };

  const inputCls = "w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors";

  // A field is disabled when it's locked by backend AND we're in backend mode
  const isDisabled = (field) => locked[field] && configMode === 'backend';

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950 transition-colors">
      <header className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex-shrink-0 transition-colors">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">API 设置</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">配置 AI 模型和 API 参数</p>
          </div>
          {/* Config mode toggle */}
          {Object.keys(locked).length > 0 && (
            <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-1">
              <button onClick={() => handleConfigModeChange('backend')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  configMode === 'backend'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}>
                后端默认
              </button>
              <button onClick={() => handleConfigModeChange('custom')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  configMode === 'custom'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}>
                自定义配置
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl space-y-6">
          {/* API Selector */}
          {availableApis.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 transition-colors">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">选择 API</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">后端已预配置的 API，点击直接切换</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {availableApis.map((api) => {
                  const isSelected = selectedApiId === api.id;
                  return (
                    <button key={api.id} onClick={() => handleApiSelect(api.id)}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 ring-blue-500'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50'
                      }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-semibold ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>{api.name}</span>
                        {isSelected && (
                          <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{providers[api.provider]?.name || api.provider}</p>
                      {api.base_url && <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 truncate font-mono">{api.base_url}</p>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Basic Config */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 transition-colors">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">基础配置</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                API 提供商 <span className="text-red-500">*</span>
                {isDisabled('api_provider') && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-normal">后端固定</span>}
              </label>
              <select value={apiProvider} onChange={(e) => { setApiProvider(e.target.value); setTestResult(null); }}
                disabled={isDisabled('api_provider')}
                className={`${inputCls} ${isDisabled('api_provider') ? 'opacity-60 cursor-not-allowed bg-gray-100 dark:bg-gray-700' : ''}`}>
                {Object.entries(providers).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
              </select>
            </div>

            {/* Model Tier Cards */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">模型档位 <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(MODEL_TIERS).map(([key, tier]) => {
                  const isSelected = modelTier === key;
                  const defaultModel = tier.models[apiProvider] || tier.models.openai;
                  const hasCustom = !!customModels[key]?.trim();
                  const tierLocked = locked[`model_${key}`] && configMode === 'backend';
                  return (
                    <div key={key}
                      className={`rounded-xl border-2 transition-all ${
                        isSelected
                          ? `${tier.border} ${tier.bg} ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 ring-blue-500`
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50'
                      }`}>
                      <button onClick={() => handleTierChange(key)} className="w-full p-4 pb-2 text-left">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-semibold ${isSelected ? tier.color : 'text-gray-700 dark:text-gray-300'}`}>{tier.label}</span>
                          {isSelected && <svg className={`w-4 h-4 ${tier.color}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>}
                          {locked[`model_${key}`] && configMode === 'backend' && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">后端固定</span>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{tier.description}</p>
                      </button>
                      <div className="px-4 pb-3">
                        <div className="flex items-center gap-1.5">
                          <input type="text" value={customModels[key]}
                            onChange={(e) => setCustomModel(key, e.target.value)}
                            placeholder={defaultModel}
                            disabled={tierLocked}
                            onClick={(e) => e.stopPropagation()}
                            className={`flex-1 text-xs py-1.5 px-2.5 rounded-lg border transition-colors bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                              tierLocked ? 'opacity-60 cursor-not-allowed bg-gray-100 dark:bg-gray-700' :
                              hasCustom
                                ? 'border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                            }`} />
                        </div>
                        {hasCustom ? (
                          <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-1 truncate">自定义: {customModels[key]}</p>
                        ) : (
                          <p className={`text-[10px] mt-1 truncate ${isSelected ? tier.color : 'text-gray-400 dark:text-gray-500'}`}>
                            默认: {defaultModel}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-gray-400">
                当前生效模型: <span className="text-blue-600 dark:text-blue-400 font-mono">{getCurrentModel()}</span>
                <span className="ml-2 text-gray-300 dark:text-gray-600">|</span>
                <span className="ml-2">{MODEL_TIERS[modelTier]?.label}档</span>
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                API Key <span className="text-red-500">*</span>
                {isDisabled('api_key') && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-normal">后端固定</span>}
              </label>
              <div className="relative">
                <input type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  disabled={isDisabled('api_key')}
                  placeholder="输入您的 API Key" className={`${inputCls} pr-12 ${isDisabled('api_key') ? 'opacity-60 cursor-not-allowed bg-gray-100 dark:bg-gray-700' : ''}`} />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  {showApiKey ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                API Base URL <span className="text-gray-400 text-xs">(可选)</span>
                {isDisabled('api_base_url') && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-normal">后端固定</span>}
              </label>
              <input type="text" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)}
                disabled={isDisabled('api_base_url')}
                placeholder={providers[apiProvider]?.defaultBaseUrl || 'https://api.example.com/v1'}
                className={`${inputCls} ${isDisabled('api_base_url') ? 'opacity-60 cursor-not-allowed bg-gray-100 dark:bg-gray-700' : ''}`} />
            </div>

            <div className="flex items-center gap-4">
              <button onClick={handleTestConnection} disabled={isTesting || !apiKey}
                className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-200 rounded-lg transition-colors flex items-center gap-2 border border-gray-200 dark:border-gray-700">
                {isTesting ? <><div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>测试中...</> : '测试连接'}
              </button>
              {testResult && (
                <div className={`flex-1 p-3 rounded-lg text-sm ${testResult.success ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
                  {testResult.message}
                  {testResult.details?.response && <p className="text-xs mt-1 opacity-70">响应: "{testResult.details.response}"</p>}
                </div>
              )}
            </div>
          </div>

          {/* Advanced */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 transition-colors">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">高级参数</h3>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Temperature <span className="text-gray-400 text-xs">(0-2)</span>
                  {isDisabled('temperature') && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-normal">后端固定</span>}
                </label>
                <input type="number" value={temperature} min="0" max="2" step="0.1"
                  disabled={isDisabled('temperature')}
                  onChange={(e) => setTemperature(Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className={`${inputCls} ${isDisabled('temperature') ? 'opacity-60 cursor-not-allowed bg-gray-100 dark:bg-gray-700' : ''}`} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={handleSave} disabled={isSaving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2 shadow-sm">
              {isSaving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>保存中...</> : '保存设置'}
            </button>
            <p className="text-xs text-gray-400">设置保存在浏览器本地</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
