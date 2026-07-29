#!/usr/bin/env node
/**
 * Seed script — 将静态 tour JSON 数据导入 Supabase
 *
 * 用法:
 *   1. 先运行 SQL 建表迁移: supabase-migration.sql
 *   2. 在 Supabase Dashboard → Project Settings → API 获取 service_role key
 *   3. 运行:
 *      SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../public/data');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('请设置 SUPABASE_URL 和 SUPABASE_SERVICE_KEY 环境变量');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 导览映射: JSON 文件 -> 用户 UUID（你需要替换为实际用户 ID）
const TOURS = [
  { file: 'henshan.json', userId: process.env.SUPABASE_USER_ID },
  { file: 'huashan.json', userId: process.env.SUPABASE_USER_ID },
];

async function seed() {
  for (const { file, userId } of TOURS) {
    if (!userId) {
      console.log(`跳过 ${file}: 需要设置 SUPABASE_USER_ID`);
      continue;
    }

    const data = JSON.parse(readFileSync(resolve(PUBLIC_DIR, file), 'utf-8'));

    // 1. Insert tour
    const { data: tour, error: tourErr } = await supabase
      .from('tours')
      .insert({
        user_id: userId,
        title: data.meta.title,
        subtitle: data.meta.subtitle,
        theme: data.theme || {},
        source: data.source || {},
        destination: data.destination || {},
        is_public: true,
      })
      .select()
      .single();

    if (tourErr) { console.error(`${file}: tour insert failed:`, tourErr.message); continue; }
    console.log(`✓ ${file} → tour ${tour.id}`);

    // 2. Insert content layers
    if (data.contentLayers?.length) {
      const { error: lErr } = await supabase.from('content_layers').insert(
        data.contentLayers.map((l, i) => ({
          tour_id: tour.id, layer_key: l.id, name: l.name, icon: l.icon, color: l.color, sort_order: i,
        }))
      );
      if (lErr) console.error(`  layers:`, lErr.message);
      else console.log(`  ✓ ${data.contentLayers.length} layers`);
    }

    // 3. Insert locations
    if (data.locations?.length) {
      const { error: locErr } = await supabase.from('locations').insert(
        data.locations.map((loc, i) => ({
          id: loc.id,
          tour_id: tour.id,
          name: loc.name,
          lat: loc.lat, lng: loc.lng,
          elevation: loc.elevation || '',
          importance: loc.importance || 3,
          tags: loc.tags || [],
          layers: loc.layers || {},
          reflection: loc.reflection || '',
          practical: loc.practical || {},
          sort_order: i,
        }))
      );
      if (locErr) console.error(`  locations:`, locErr.message);
      else console.log(`  ✓ ${data.locations.length} locations`);
    }

    // 4. Insert routes
    const validRoutes = (data.routes || []).filter(r => r.id !== 'extra');
    if (validRoutes.length) {
      const { error: rErr } = await supabase.from('routes').insert(
        validRoutes.map((r, i) => ({
          id: r.id,
          tour_id: tour.id,
          day_label: r.day || '',
          title: r.title,
          stops: r.stops || [],
          narrative: r.narrative || '',
          sort_order: i,
        }))
      );
      if (rErr) console.error(`  routes:`, rErr.message);
      else console.log(`  ✓ ${validRoutes.length} routes`);
    }

    // 5. Insert tips
    if (data.tips?.length) {
      const { error: tErr } = await supabase.from('tips').insert(
        data.tips.map((t, i) => ({
          tour_id: tour.id, text: t.text, sort_order: i,
        }))
      );
      if (tErr) console.error(`  tips:`, tErr.message);
      else console.log(`  ✓ ${data.tips.length} tips`);
    }
  }

  console.log('\n完成！');
}

seed().catch(console.error);
