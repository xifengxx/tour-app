// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProcessingPhase from '../ProcessingPhase';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } },
}));

// P1-2 回归：needs_review 必须与 done 一样终止轮询。
// 漏掉这个分支会让前端一路死等到 4 分钟超时，把"已完成但需核实"的导览报成处理失败。
async function renderWithStatus(status) {
  const onCheckDone = vi.fn();
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify([{ status }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  render(
    <ProcessingPhase
      draftTourId="t1" title="测试导览" destName="示例山" destRegion="江西省"
      novelTitle="" novelAuthor="" sourceText="文本"
      onCheckDone={onCheckDone} onSkip={vi.fn()} onBack={vi.fn()} onRetry={vi.fn()}
    />,
  );
  // 首次检查在 3s 后，完成跳转再延迟 800ms
  await vi.advanceTimersByTimeAsync(3200);
  await vi.advanceTimersByTimeAsync(900);
  await vi.advanceTimersByTimeAsync(5200); // 再走一个 5s 轮询周期
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return { onCheckDone, fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProcessingPhase 状态轮询', () => {
  it('done 结束轮询并进入审核', async () => {
    const { onCheckDone } = await renderWithStatus('done');
    expect(onCheckDone).toHaveBeenCalledTimes(1);
  });

  it('needs_review 同样结束轮询，并提示存在需核实问题', async () => {
    const { onCheckDone } = await renderWithStatus('needs_review');
    expect(onCheckDone).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('闸门发现路线存在需要核实的问题');
  });

  it('error 不进入审核，显示服务端原因', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ status: 'error', process_error: '仅识别出 2 个有效地点' }]), { status: 200 }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const onCheckDone = vi.fn();
    render(
      <ProcessingPhase draftTourId="t1" title="T" destName="D" destRegion="R"
        novelTitle="" novelAuthor="" sourceText="" onCheckDone={onCheckDone}
        onSkip={vi.fn()} onBack={vi.fn()} onRetry={vi.fn()} />,
    );
    await vi.advanceTimersByTimeAsync(3200);
    expect(onCheckDone).not.toHaveBeenCalled();
    expect(await screen.findByText(/仅识别出 2 个有效地点/)).toBeInTheDocument();
    // 失败后必须停止轮询，不能继续打服务器
    const callsBefore = globalThis.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(12000);
    expect(globalThis.fetch.mock.calls.length).toBe(callsBefore);
  });

  it('processing 继续轮询，不跳转', async () => {
    const { onCheckDone, fetchMock } = await renderWithStatus('processing');
    expect(onCheckDone).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
