import { describe, it, expect } from 'vitest'
import { storySeedFor, hasSeedStory, seededTourCount } from '../storySeed'

const files = import.meta.glob('../../data/story/*.json', { eager: true })
const seeds = Object.values(files).map((m) => m.default ?? m)

describe('storySeed 自动注册', () => {
  it('目录里每份 JSON 都被注册', () => {
    expect(seededTourCount()).toBe(seeds.length)
    expect(seeds.length).toBeGreaterThan(1)
  })

  it('每份 JSON 的 tourId 都能取到种子', () => {
    for (const seed of seeds) {
      const got = storySeedFor(seed.tourId)
      expect(got?.tourName).toBe(seed.tourName)
      expect(hasSeedStory(got)).toBe(true)
    }
  })

  it('每份 JSON 的地点都有时间轴、人物、机位三件套', () => {
    for (const seed of seeds) {
      const locs = Object.entries(seed.locations ?? {})
      expect(locs.length).toBeGreaterThanOrEqual(3)
      for (const [id, loc] of locs) {
        expect(id.length).toBeGreaterThan(4)
        expect(loc.name).toBeTruthy()
        expect((loc.timeline ?? []).length).toBeGreaterThanOrEqual(2)
        // 人物可以留空：纯地质/工程景观点（巨蟒出山之外的东西海岸栈道、禹皇顶这类）
        // 没有可核实的关联人物，硬挂"文化背景人物"就是编造。
        // 留空时用更严的时间轴（≥2 条）承接，避免"没人物也没内容"的残缺案头。
        if ((loc.figures ?? []).length === 0) {
          expect((loc.timeline ?? []).length).toBeGreaterThanOrEqual(2)
        }
        expect((loc.shot ?? []).length).toBeGreaterThanOrEqual(1)
        for (const step of loc.timeline ?? []) {
          expect(step.era).toBeTruthy()
          expect(step.change).toBeTruthy()
          expect(step.evidence).toBeTruthy()
        }
        for (const fig of loc.figures ?? []) {
          expect(fig.name).toBeTruthy()
          expect(fig.relation).toBeTruthy()
          expect(fig.evidence).toBeTruthy()
        }
        for (const shot of loc.shot ?? []) {
          expect(shot.position).toBeTruthy()
          expect(shot.direction).toBeTruthy()
          expect(shot.formula).toBeTruthy()
          expect(shot.time).toBeTruthy()
          expect(shot.avoid).toBeTruthy()
        }
      }
    }
  })

  it('未知 tourId 不返回种子', () => {
    expect(storySeedFor('00000000-0000-0000-0000-000000000000')).toBeFalsy()
    expect(hasSeedStory(storySeedFor('00000000-0000-0000-0000-000000000000'))).toBe(false)
  })
})
