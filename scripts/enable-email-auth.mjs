#!/usr/bin/env node
// Enable email authentication in Supabase
const TOKEN = process.env.SUPABASE_PAT;
const REF = 'qxunedraoviaonjdanag';

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ external_email_enabled: true }),
});

const data = await res.json();
if (data.external_email_enabled) {
  console.log('✅ Email Auth 已开启');
} else {
  console.log('⚠️  结果:', JSON.stringify(data).substring(0, 300));
}
