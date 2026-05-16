import { useState, useEffect } from 'react';
import { recordsService } from '../services/api';

const MODEL_TIERS = {
  fast: { label: '快速', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/30' },
  balanced: { label: '均衡', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30' },
  quality: { label: '高质量', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/30' },
};

const UserRecords = () => {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => { loadRecords(); }, []);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const res = await recordsService.list(100, 0);
      setRecords(res.data.records);
      setTotal(res.data.total);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    try {
      await recordsService.delete(id);
      setRecords(records.filter(r => r.id !== id));
      setTotal(t => t - 1);
      if (selected?.id === id) setSelected(null);
    } catch (e) { alert('删除失败'); }
  };

  const handleClearAll = async () => {
    try {
      await recordsService.clearAll();
      setRecords([]); setTotal(0); setSelected(null); setShowConfirm(false);
    } catch (e) { alert('清空失败'); }
  };

  const formatTime = (t) => {
    if (!t) return '';
    return t.replace('T', ' ').slice(0, 19);
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950 transition-colors">
      <header className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between flex-shrink-0 transition-colors">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">使用记录</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">最近 {total} 条生成记录</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadRecords}
            className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
            刷新
          </button>
          {records.length > 0 && (
            <button onClick={() => setShowConfirm(true)}
              className="px-3 py-1.5 text-sm text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
              清空全部
            </button>
          )}
        </div>
      </header>

      {/* Clear All Confirmation */}
      {showConfirm && (
        <div className="border-b border-gray-200 dark:border-gray-800 bg-red-50 dark:bg-red-900/20 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <p className="text-sm text-red-700 dark:text-red-300">确定清空全部 {total} 条记录？此操作不可撤销。</p>
          <div className="flex gap-2">
            <button onClick={handleClearAll}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">确定清空</button>
            <button onClick={() => setShowConfirm(false)}
              className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">取消</button>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left - Record List */}
        <div className={`${selected ? 'w-2/5' : 'w-full'} flex flex-col border-r border-gray-200 dark:border-gray-800 min-h-0 transition-all`}>
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : records.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-200 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <p className="text-lg font-medium">暂无记录</p>
                <p className="text-sm mt-1">生成草稿后会自动保存在这里</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              {records.map((r) => (
                <div key={r.id}
                  onClick={() => setSelected(r)}
                  className={`px-5 py-4 border-b border-gray-100 dark:border-gray-800/50 cursor-pointer group transition-colors ${
                    selected?.id === r.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-900/50'
                  }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{formatTime(r.created_at)}</span>
                      {r.model_name && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-mono">{r.model_name}</span>
                      )}
                      {r.token_usage && (
                        <span className="text-xs text-green-600 dark:text-green-400">{r.token_usage.total_tokens} tok</span>
                      )}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                      className="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{r.email_content?.slice(0, 120)}</p>
                  <p className="text-xs text-gray-400 mt-1 truncate italic">回复: {r.draft?.slice(0, 80)}...</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right - Detail View */}
        {selected && (
          <div className="w-3/5 flex flex-col min-h-0 overflow-auto bg-gray-50 dark:bg-gray-900/30">
            <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-shrink-0 bg-white dark:bg-gray-900">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">记录详情</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{formatTime(selected.created_at)}</p>
              </div>
              <div className="flex items-center gap-3">
                {selected.model_name && (
                  <span className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-mono">{selected.model_name}</span>
                )}
                {selected.token_usage && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-lg">
                    <span>入 <strong className="text-gray-700 dark:text-gray-200">{selected.token_usage.input_tokens}</strong></span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span>出 <strong className="text-gray-700 dark:text-gray-200">{selected.token_usage.output_tokens}</strong></span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span>共 <strong className="text-yellow-600 dark:text-yellow-400">{selected.token_usage.total_tokens}</strong></span>
                  </div>
                )}
                <button onClick={() => setSelected(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="flex-1 p-6 space-y-6 overflow-auto">
              {/* Input Email */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">收到的邮件</h4>
                  <button onClick={() => { navigator.clipboard.writeText(selected.email_content); alert('已复制'); }}
                    className="px-2.5 py-1 text-xs bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors border border-gray-200 dark:border-gray-700">复制</button>
                </div>
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-800 dark:text-gray-200">{selected.email_content}</pre>
                </div>
              </div>

              {/* Additional Context */}
              {selected.additional_context && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">附加说明</h4>
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <p className="text-sm text-gray-700 dark:text-gray-300">{selected.additional_context}</p>
                  </div>
                </div>
              )}

              {/* Generated Draft */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI 生成草稿</h4>
                  <button onClick={() => { navigator.clipboard.writeText(selected.draft); alert('已复制'); }}
                    className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">复制草稿</button>
                </div>
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-800 dark:text-gray-200">{selected.draft}</pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserRecords;
