import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../errorMessage';

describe('getErrorMessage', () => {
  it('优先返回字符串错误', () => {
    expect(getErrorMessage('网络失败')).toBe('网络失败');
  });

  it('提取 Error 的 message', () => {
    expect(getErrorMessage(new Error('请求超时'))).toBe('请求超时');
  });

  it('未知错误使用兜底文案', () => {
    expect(getErrorMessage(null)).toBe('操作失败，请稍后重试');
    expect(getErrorMessage({})).toBe('操作失败，请稍后重试');
  });
});
