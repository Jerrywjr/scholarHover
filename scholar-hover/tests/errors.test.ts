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
  it.each([
    '原文网站访问权限未授予，请允许读取原文网站。',
    '原文解析失败，请重新读取摘要。',
    '原文链接未返回可读取的摘要网页。',
    '原文链接发生跳转，请打开原文页面查看。',
    '原文页面未提供可核验的论文信息，可能需要登录或验证。',
    '原文页面未提供完整摘要。',
    '无法读取原文网页，请打开原文页面检查网络、跳转或访问限制。',
  ])('retains actionable source-page diagnostics in every language: %s', source => {
    expect(localizeError(source, 'zh-CN')).toBe(source);
    for (const language of ['en', 'fr', 'de'] as const) {
      const translated = localizeError(source, language);
      expect(translated).not.toBe(localizeError('操作失败，请重试。', language));
      expect(translated).not.toMatch(/\p{Script=Han}/u);
    }
  });
  it.each([
    ['zh-CN', '原文读取失败：HTTP 403；OpenAlex 查询失败：HTTP 429'],
    ['en', 'Source page read failed: HTTP 403; OpenAlex lookup failed: HTTP 429'],
    ['fr', 'Échec de lecture de la page originale : HTTP 403 ; Échec de la recherche OpenAlex : HTTP 429'],
    ['de', 'Lesen der Originalseite fehlgeschlagen: HTTP 403; OpenAlex-Abfrage fehlgeschlagen: HTTP 429'],
  ] as const)('keeps source and index failures distinct in %s', (language, expected) => {
    expect(localizeError('原文读取失败：HTTP 403；OpenAlex 查询失败：HTTP 429', language)).toBe(expected);
  });
  it('attributes a supplementary lookup failure to Crossref after an OpenAlex match', () => {
    for (const language of LANGUAGES) {
      const message = localizeError('OpenAlex 已匹配，但Crossref 查询失败：HTTP 503', language);
      expect(message).toContain('OpenAlex');
      expect(message).toContain('Crossref');
      expect(message).toContain('HTTP 503');
      if (language !== 'zh-CN') expect(message).not.toMatch(/\p{Script=Han}/u);
    }
  });
  it('sanitizes each nested provider error instead of reflecting response text', () => {
    for (const language of LANGUAGES) {
      const message = localizeError('原文读取失败：<html>secret-token</html>；OpenAlex 已匹配，但Crossref 查询失败：HTTP 503 secret-token', language);
      expect(message).toContain('OpenAlex');
      expect(message).toContain('Crossref');
      expect(message).not.toContain('secret-token');
      expect(message).not.toContain('<html>');
      expect(message).not.toContain('HTTP 503');
    }
  });
});
