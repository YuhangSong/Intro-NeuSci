import { VERSION } from './version.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const QID_RE = /^[a-z0-9_-]{1,40}$/i;

/* 每道投票题一个 Durable Object 实例：计数强一致，课堂现场不丢票 */
export class VoteRoom {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    const counts = (await this.state.storage.get('counts')) || [0, 0, 0, 0];
    if (request.method === 'POST' && url.pathname === '/inc') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const c = Number(body.choice);
      if (!Number.isInteger(c) || c < 0 || c > 3) return json({ error: 'bad choice' }, 400);
      counts[c] = (counts[c] || 0) + 1;
      await this.state.storage.put('counts', counts);
      return json({ ok: true, counts });
    }
    if (request.method === 'POST' && url.pathname === '/reset') {
      await this.state.storage.put('counts', [0, 0, 0, 0]);
      return json({ ok: true });
    }
    return json({ counts });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/health') return json({ ok: true, votes: true, version: VERSION });

    if (p === '/api/votes') {
      const qid = url.searchParams.get('qid') || '';
      if (!QID_RE.test(qid)) return json({ error: 'bad qid' }, 400);
      return env.VOTES.get(env.VOTES.idFromName(qid)).fetch('https://do/get');
    }

    if (p === '/api/vote' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const qid = String(body.qid || '');
      if (!QID_RE.test(qid)) return json({ error: 'bad qid' }, 400);
      return env.VOTES.get(env.VOTES.idFromName(qid)).fetch('https://do/inc', {
        method: 'POST',
        body: JSON.stringify({ choice: body.choice }),
      });
    }

    if (p === '/api/reset' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.ADMIN_KEY || auth !== 'Bearer ' + env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const qid = String(body.qid || '');
      if (!QID_RE.test(qid)) return json({ error: 'bad qid' }, 400);
      return env.VOTES.get(env.VOTES.idFromName(qid)).fetch('https://do/reset', { method: 'POST' });
    }

    /* 其余路径：未命中静态资源时兜底 404（正常情况下静态资源在 Worker 之前被服务） */
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
