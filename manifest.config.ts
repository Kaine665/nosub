import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

const googleOAuthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  ?? '1052189288353-ivcc0amvu3a5rb25cbse9fn97jea0erv.apps.googleusercontent.com';

/**
 * MV3 manifest — 动态定义。
 * 权限严格按 design §11:storage + YouTube host permission,不多不少。
 * nosub 1.0 不需要 sidePanel(用页面内浮层)、不需要 background 复杂逻辑。
 */
export default defineManifest({
  manifest_version: 3,
  name: '__MSG_appName__',
  version: pkg.version,
  description: '__MSG_appDescription__',
  default_locale: 'en',
  // 图标后续补,1.0 骨架先不带(Chrome 会用默认)
  icons: {
    16: 'icon16.png',
    48: 'icon48.png',
    128: 'icon128.png',
  },
  action: {
    default_title: '__MSG_actionTitle__',
    default_popup: 'src/popup/popup.html',
    default_icon: {
      16: 'icon16.png',
      48: 'icon48.png',
      128: 'icon128.png',
    },
  },
  options_ui: {
    page: 'src/options/options.html',
    open_in_tab: true,
  },
  permissions: ['storage', 'activeTab', 'identity'],
  oauth2: {
    client_id: googleOAuthClientId,
    scopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  },
  host_permissions: [
    'https://www.youtube.com/*',
    'https://api.dictionaryapi.dev/*',
    'https://ssl.gstatic.com/*',
    'https://translate.googleapis.com/*',
    'https://tatoeba.org/*',
    'https://dict.youdao.com/*',
    'https://dict-mobile.iciba.com/*',
    'https://api-nosub.43-130-246-125.sslip.io/*',
  ],
  content_scripts: [
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/bootstrap.ts'],
      run_at: 'document_idle',
    },
    // 主世界脚本:读 ytInitialPlayerResponse / ytInitialData / yt.config_
    // world: 'MAIN' 是 Chrome 102+ 支持的 MV3 特性,绕过 CSP 的 inline script 限制
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/youtube/page-script.ts'],
      run_at: 'document_start',  // 尽早注入,让 read() 在主世界数据填充前即就绪
      world: 'MAIN',
    },
  ],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  web_accessible_resources: [
    {
      resources: [
        'public/fonts/Inter-400.woff2',
        'public/fonts/Inter-600.woff2',
        'public/fonts/Inter-700.woff2',
      ],
      matches: ['https://www.youtube.com/*'],
    },
  ],
});
