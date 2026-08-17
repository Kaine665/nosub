import { describe, expect, it } from 'vitest';
import { paddleApiBase } from '../../supabase/functions/_shared/paddle-environment.js';

describe('paddleApiBase', () => {
  it('production 使用 Live API', () => {
    expect(paddleApiBase('production', 'pdl_live_apikey_example')).toBe('https://api.paddle.com');
  });

  it('sandbox 使用 Sandbox API', () => {
    expect(paddleApiBase('sandbox', 'pdl_sdbx_apikey_example')).toBe('https://sandbox-api.paddle.com');
  });

  it('未配置环境时从新格式 Live API Key 自动识别', () => {
    expect(paddleApiBase(undefined, 'pdl_live_apikey_example')).toBe('https://api.paddle.com');
  });

  it('拒绝未知环境', () => {
    expect(() => paddleApiBase('staging', 'key')).toThrow('PADDLE_ENVIRONMENT');
  });
});
