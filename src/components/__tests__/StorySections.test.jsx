// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StorySections from '../StorySections';
import { summarizeStory } from '../../lib/story';
import TourPrologue from '../TourPrologue';

const locById = {
  a: {
    id: 'a', name: '甲寺',
    timeline: [
      { era: '东晋', label: '僧人择此结庐', function: '寺院', change: '佛教南传', evidence: '《高僧传》' },
      { era: '民国', label: '改为疗养地', function: '别墅区', change: '避暑铁路通车', evidence: '《庐山志》' },
    ],
    figures: [
      { name: '某僧', role: '东晋高僧', relation: '在此结社', works: ['《论甲》'], evidence: '《高僧传》卷六' },
    ],
  },
  b: {
    id: 'b', name: '乙峰',
    timeline: [
      { era: '东晋', label: '同代另一处', function: '古道场', change: '同一波南传', evidence: '《山志》' },
    ],
    figures: [
      { name: '某僧', role: '东晋高僧', relation: '亦曾驻此', works: ['《论乙》'], evidence: '《高僧传》卷六' },
      { name: '某居士', role: '民国文人', relation: '在此避暑写作', works: [], evidence: '' },
    ],
  },
};

const route = { id: 'r1', title: '一条测试线', stops: ['a', 'b'] };

const renderSections = () => {
  const { timeline, figures } = summarizeStory(route, locById);
  return render(<StorySections timeline={timeline} figures={figures} />);
};

describe('案头内容 (StorySections)', () => {
  it('按时期分组建时间轴，同代条目合到一段', () => {
    renderSections();
    expect(screen.getAllByText('东晋')).toHaveLength(1); // 两个地点的东晋条目并到同一段
    expect(screen.getByText('民国')).toBeInTheDocument();
    expect(screen.getByText('僧人择此结庐')).toBeInTheDocument();
    expect(screen.getByText('同代另一处')).toBeInTheDocument();
    expect(screen.getByText(/当时：寺院/)).toBeInTheDocument();
    expect(screen.getByText(/为何变：避暑铁路通车/)).toBeInTheDocument();
    expect(screen.getAllByText(/据 《高僧传》/).length).toBeGreaterThanOrEqual(1);
  });

  it('同一人物跨地点只出一条，作品与地点合并', () => {
    renderSections();
    expect(screen.getAllByText('某僧').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('《论甲》').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('《论乙》').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('某居士').length).toBeGreaterThanOrEqual(1); // 人物卡 + 关系图各一处
  });

  it('缺依据时标「依据待考」，不编造出处', () => {
    renderSections();
    expect(screen.getAllByText('依据待考').length).toBeGreaterThanOrEqual(1);
  });

  it('完全没有资料时给空态', () => {
    render(<StorySections timeline={[]} figures={[]} />);
    expect(screen.getByText(/时代资料还没生成/)).toBeInTheDocument();
    expect(screen.getByText(/人物资料还没生成/)).toBeInTheDocument();
  });

  it('摘要给出时期数与人物数，供概览入口行使用', () => {
    const { timeline, figures, has } = summarizeStory(route, locById);
    expect(has).toBe(true);
    expect(timeline).toHaveLength(2); // 东晋 / 民国
    expect(figures).toHaveLength(2);  // 某僧去重后 + 某居士
  });
});

describe('行前案头整页 (TourPrologue)', () => {
  it('展示导览标题与摘要，并提供开始导览 / 跳过两个出口', () => {
    const onStart = vi.fn();
    const onLookMap = vi.fn();
    render(
      <TourPrologue
        tour={{ meta: { title: '甲山导览' } }}
        route={route}
        locById={locById}
        onStart={onStart}
        onLookMap={onLookMap}
      />
    );
    expect(screen.getByText('甲山导览')).toBeInTheDocument();
    expect(screen.getByText(/2 个时期/)).toBeInTheDocument();
    expect(screen.getByText(/2 位人物/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('开始导览'));
    expect(onStart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('跳过，直接看地图'));
    expect(onLookMap).toHaveBeenCalledTimes(1);
  });
});
