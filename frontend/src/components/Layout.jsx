import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { authService } from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { isDirty, getOnNavigateAway, getDirtyMessage, clearGuard } from '../utils/navigationGuard';

const LAYOUT_KEY = 'layout_sidebar';
const loadSidebarWidth = () => {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY))?.sidebarWidth; } catch { return undefined; }
};

const Layout = ({ children, user, onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [quota, setQuota] = useState(null);
  const { theme, toggleTheme } = useTheme();
  const [pendingNav, setPendingNav] = useState(null);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth() || 256);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [sidebarDragging, setSidebarDragging] = useState(false);

  useEffect(() => {
    loadQuota();
  }, [location.pathname]);

  // Keep ref in sync with state
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const loadQuota = async () => {
    try {
      const res = await authService.getQuota();
      setQuota(res.data);
    } catch {}
  };

  const navigation = [
    { name: '草稿工作台', href: '/', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
    { name: '数据中心', href: '/data-library', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { name: 'API 设置', href: '/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { name: '使用记录', href: '/records', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  ];

  const tierColors = {
    free: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    pro: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
    unlimited: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
  };

  const handleNavClick = (e, href) => {
    if (!isDirty() || location.pathname === href) return;
    e.preventDefault();
    setPendingNav(href);
  };

  const handleSaveAndLeave = async () => {
    const saveFn = getOnNavigateAway();
    if (saveFn) {
      const ok = await saveFn();
      if (ok) {
        clearGuard();
        navigate(pendingNav);
      }
    }
    setPendingNav(null);
  };

  const handleLeaveWithoutSaving = () => {
    clearGuard();
    navigate(pendingNav);
    setPendingNav(null);
  };

  const handleCancelNav = () => {
    setPendingNav(null);
  };

  // Sidebar resize
  const onSidebarPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    setSidebarDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const newW = startW + (ev.clientX - startX);
      setSidebarWidth(Math.min(400, Math.max(160, newW)));
    };
    const onUp = () => {
      setSidebarDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const state = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
      state.sidebarWidth = sidebarWidthRef.current;
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(state));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  return (
    <div className="min-h-screen flex bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
      {/* Unsaved Changes Modal */}
      {pendingNav && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">未保存的更改</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{getDirtyMessage()}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-6">
              <button onClick={handleSaveAndLeave}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
                保存并离开
              </button>
              <button onClick={handleLeaveWithoutSaving}
                className="w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors">
                不保存，直接离开
              </button>
              <button onClick={handleCancelNav}
                className="w-full px-4 py-2.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar drag overlay */}
      {sidebarDragging && <div className="fixed inset-0 z-50" style={{ cursor: 'col-resize' }} />}

      {/* Sidebar */}
      <aside className="bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0 relative" style={{ width: `${sidebarWidth}px` }}>
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            邮件回复助手
          </h1>
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navigation.map((item) => (
              <li key={item.name}>
                <Link
                  to={item.href}
                  onClick={(e) => handleNavClick(e, item.href)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    location.pathname === item.href
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
          {quota && (
            <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">今日配额</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${tierColors[quota.tier] || tierColors.free}`}>
                  {quota.tier}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-400 mt-1">{quota.used} / {quota.limit}</p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">{user?.username}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
                title={theme === 'dark' ? '切换为亮色模式' : '切换为暗色模式'}
              >
                {theme === 'dark' ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <button
                onClick={onLogout}
                className="text-xs text-gray-500 hover:text-red-500 transition-colors"
              >
                退出
              </button>
            </div>
          </div>
        </div>
        {/* Sidebar resize handle */}
        <div
          onPointerDown={onSidebarPointerDown}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-500/40 transition-colors group z-10"
          title="拖动调整侧边栏宽度"
        >
          <div className="absolute inset-y-0 right-1/2 translate-x-1/2 w-0.5 group-hover:w-1 group-active:w-1.5 bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 rounded-full transition-all" />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
};

export default Layout;
