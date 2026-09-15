import type { Request, Response } from './types';
export async function rpc<T>(message: Request): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as Response<T> | undefined;
  if (!response) throw new Error('扩展未响应，请刷新页面后重试。');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
