#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.SUPABASE_PAT;
const REF = 'qxunedraoviaonjdanag';
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function runQuery(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

// Split SQL into individual statements, handling function bodies
function splitSQL(sql) {
  const statements = [];
  let current = '';
  let inDollar = false;

  for (const line of sql.split('\n')) {
    // Track $$ function body boundaries
    if (line.includes('$$')) {
      inDollar = !inDollar;
      current += line + '\n';
      if (!inDollar) {
        // Function body ended - flush
        const trimmed = current.trim();
        if (trimmed && !trimmed.split('\n').every(l => l.trim().startsWith('--') || l.trim() === '')) {
          statements.push(trimmed.replace(/;\s*$/, ''));
        }
        current = '';
      }
      continue;
    }

    if (inDollar) {
      current += line + '\n';
      continue;
    }

    // Strip comments
    const stripped = line.replace(/--.*$/, '').trim();
    if (!stripped) {
      current += line + '\n';
      continue;
    }

    if (stripped.endsWith(';')) {
      current += line + '\n';
      const trimmed = current.trim();
      if (trimmed && !trimmed.split('\n').every(l => {
        const s = l.replace(/--.*$/, '').trim();
        return !s || s === ';';
      })) {
        statements.push(trimmed.replace(/;\s*$/, ''));
      }
      current = '';
    } else {
      current += line + '\n';
    }
  }

  // Flush remaining
  const trimmed = current.trim();
  if (trimmed && trimmed !== ';') {
    statements.push(trimmed.replace(/;\s*$/, ''));
  }

  return statements;
}

async function main() {
  const sqlPath = resolve(__dirname, '../supabase-migration.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  const statements = splitSQL(sql);

  console.log(`📄 ${statements.length} 条 SQL 语句待执行\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.split('\n')[0].substring(0, 70);

    try {
      await runQuery(stmt);
      console.log(`  ✅ [${i + 1}/${statements.length}] ${preview}`);
      success++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      const msg = err.message;
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        console.log(`  ⏭  [${i + 1}/${statements.length}] ${preview} (已存在)`);
        skipped++;
      } else {
        console.error(`  ❌ [${i + 1}/${statements.length}] ${preview}`);
        console.error(`      ${msg}`);
        failed++;
      }
    }
  }

  console.log(`\n📊 完成: ${success} 成功, ${skipped} 跳过, ${failed} 失败`);
}

main().catch(err => {
  console.error('💥', err.message);
  process.exit(1);
});
