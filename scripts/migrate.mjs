#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

const PASSWORD = '198611846Sb@Tm';
const HOST = 'db.qxunedraoviaonjdanag.supabase.co';
const DATABASE = 'postgres';

const client = new Client({
  host: HOST,
  port: 6543,
  user: 'postgres',
  password: PASSWORD,
  database: DATABASE,
  ssl: true,
});

async function main() {
  console.log('🔗 连接 Supabase PostgreSQL...');
  await client.connect();
  console.log('✅ 已连接');

  // Read and execute migration SQL
  const sqlPath = resolve(__dirname, '../supabase-migration.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  console.log('📄 读取迁移文件:', sqlPath);
  console.log(`   ${sql.split('\n').length} 行 SQL`);

  // Split by statement (semicolons) but be careful with function bodies
  // Simple approach: execute the whole thing (pg handles multiple statements differently)
  // Better: split on semicolons that are at the start of a line or preceded by a line break
  const statements = sql
    .split(/;\s*\n\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    // Skip comment-only blocks
    if (stmt.split('\n').every(l => l.trim().startsWith('--') || l.trim() === '')) {
      skipped++;
      continue;
    }

    try {
      await client.query(stmt + ';');
      success++;
    } catch (err) {
      // Common expected errors: already exists, duplicate
      if (err.message.includes('already exists') || err.message.includes('duplicate')) {
        console.log(`   ⏭  ${stmt.split('\n')[0].substring(0, 60)}... (已存在，跳过)`);
        skipped++;
      } else {
        console.error(`   ❌ 失败: ${stmt.split('\n')[0].substring(0, 80)}`);
        console.error(`       ${err.message.split('\n')[0]}`);
        failed++;
      }
    }
  }

  console.log(`\n📊 结果: ${success} 成功, ${skipped} 跳过, ${failed} 失败`);

  await client.end();
  console.log('🔌 已断开连接');
}

main().catch(async (err) => {
  console.error('💥 错误:', err.message);
  try { await client.end(); } catch (_) {}
  process.exit(1);
});
