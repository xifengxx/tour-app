// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ElevationProfile from '../ElevationProfile';

describe('ElevationProfile', () => {
  it('有剖面数据时渲染摘要并完成 Canvas 绘制', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 80 })),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    });

    const { container } = render(
      <ElevationProfile
        prof={[[0, 1000], [5, 1200], [10, 1300]]}
        activeKm={5}
        stops={[[110, 30], [111, 31]]}
      />
    );

    expect(screen.getByText('海拔剖面')).toBeInTheDocument();
    expect(screen.getByText(/1,000–1,300m/)).toBeInTheDocument();
    expect(screen.getByText(/爬升 300m/)).toBeInTheDocument();

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(() => fireEvent.pointerMove(canvas, { clientX: 60 })).not.toThrow();
  });
});
