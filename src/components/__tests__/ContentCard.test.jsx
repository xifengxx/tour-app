// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContentCard from '../ContentCard';

const layers = [
  { id: 'novel', name: '小说场景', icon: '📖', color: '#c0392b' },
  { id: 'history', name: '历史人文', icon: '🏛', color: '#d35400' },
];

const renderCard = (loc, layer = 'novel') =>
  render(
    <ContentCard
      loc={loc}
      layer={layer}
      layers={layers}
      onLayerChange={() => {}}
      onShowDetail={() => {}}
    />
  );

describe('ContentCard', () => {
  it('novel 层有 scenes 时渲染章节/引文/上下文', () => {
    const loc = {
      name: '祝融峰', importance: 5, tags: ['最高峰'],
      layers: { novel: { scenes: [{ chapter: '第1章', title: '初章', quote: '引文内容', context: '背景说明' }] } },
    };
    renderCard(loc);
    expect(screen.getByText(/祝融峰/)).toBeInTheDocument(); // 标题带重要度星标，用正则
    expect(screen.getByText(/第1章/)).toBeInTheDocument();
    expect(screen.getByText('引文内容')).toBeInTheDocument(); // 「」改为独立装饰元素，正文文本不再包含引号
    expect(screen.getByText('背景说明')).toBeInTheDocument();
  });

  it('层为 { text } 时渲染文本', () => {
    const loc = { name: '甲峰', layers: { history: { text: '历史正文' } } };
    renderCard(loc, 'history');
    expect(screen.getByText('历史正文')).toBeInTheDocument();
  });

  it('层缺失时渲染空状态引导', () => {
    const loc = { name: '甲峰', layers: {} };
    renderCard(loc, 'novel');
    expect(screen.getByText(/暂无该分类的内容/)).toBeInTheDocument();
  });

  it('渲染 reflection 反思框 + practical 实用标签 + 按钮', () => {
    const loc = {
      name: '甲峰',
      layers: { novel: { text: '正文' } },
      reflection: '反思内容',
      practical: { access: '步行可达', difficulty: '轻松', tip: '带好水' },
    };
    renderCard(loc, 'novel');
    expect(screen.getByText(/驻足一想/)).toBeInTheDocument();
    expect(screen.getByText(/步行可达/)).toBeInTheDocument();
    expect(screen.getByText(/导航到这里/)).toBeInTheDocument();
  });

  it('渲染 tags 标签', () => {
    const loc = { name: '甲峰', tags: ['最高峰', '观日出'], layers: { novel: { text: '正文' } } };
    renderCard(loc);
    expect(screen.getByText('最高峰')).toBeInTheDocument();
    expect(screen.getByText('观日出')).toBeInTheDocument();
  });
});
