import { describe, expect, it } from 'vitest';
import { localizeError } from '../src/shared/errors';
import { LANGUAGES } from '../src/shared/languages';

describe('localized diagnostics', () => {
  it('provides recognizable French and German timeout errors', () => {
    expect(localizeError('请求超时，请稍后重试', 'fr')).toMatch(/délai/i);
    expect(localizeError('请求超时，请稍后重试', 'de')).toMatch(/Zeit/i);
    expect(localizeError('请求超时，请稍后重试', 'zh-CN')).toBe('请求超时，请稍后重试');
  });
  it('localizes composed metadata warnings while retaining safe status codes', () => {
    for (const language of ['en', 'fr', 'de'] as const) {
      const message = localizeError('OpenAlex 已匹配，但元数据查询失败：HTTP 429', language);
      expect(message).toContain('OpenAlex');
      expect(message).toContain('HTTP 429');
      expect(message).not.toMatch(/\p{Script=Han}/u);
    }
  });
  it('does not echo unrecognized exception contents in any language', () => {
    for (const language of LANGUAGES) {
      expect(localizeError('provider failed: secret-token', language)).not.toContain('secret-token');
      expect(localizeError('元数据查询失败：secret-token', language)).not.toContain('secret-token');
    }
  });
});
