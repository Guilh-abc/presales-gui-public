#!/usr/bin/env python3
"""Agente de sync Mac <- Cloudflare (lote 3 nuvem, 09/11/2026).

D1 na nuvem = fonte oficial. O Kanzo no Mac é espelho opcional:
- só BAIXA a fila (/sync/pull), aplica no Kanzo e confirma (/sync/ack);
- NÃO envia /sync/push nem /sync/snapshot (não sobrescreve o D1);
- em conflito de hash da descrição, a nuvem vence (aplica mesmo assim).

Token: ~/.config/presales-kanzo/sync-token (mode 600) ou env PRESALES_SYNC_TOKEN.
Não imprime o token. Online no painel = last_pull_at recente.
"""
from __future__ import annotations
import re
import sqlite3
import json, os, time, urllib.request, urllib.error, pathlib, subprocess, datetime, shutil, sys, hashlib, importlib.util

HOME = pathlib.Path.home()
CFG = HOME / '.config' / 'presales-kanzo'
STATE = CFG / 'state.json'
TOKEN_FILE = CFG / 'sync-token'
LOG = CFG / 'sync.log'
BACKUP_DIR = HOME / 'kanzo' / 'backups' / 'presales-sync'
KANZO_MCP = os.environ.get('KANZO_MCP', 'http://127.0.0.1:4242/mcp')
KANZO_BIN = os.environ.get('KANZO_BIN', str(HOME / '.local/bin/kanzo'))
KANZO_HOME = os.environ.get('KANZO_HOME', str(HOME / 'kanzo'))
API = os.environ.get('PRESALES_API', 'https://SEU-WORKER.SUA-CONTA.workers.dev')
INTERVAL = float(os.environ.get('PRESALES_SYNC_INTERVAL', '8'))

def log(msg: str):
    CFG.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.datetime.now().isoformat(timespec='seconds')} {msg}\n"
    with LOG.open('a') as f: f.write(line)

def token() -> str:
    t = os.environ.get('PRESALES_SYNC_TOKEN', '').strip()
    if t: return t
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text().strip()
    raise SystemExit('missing sync token')

def http(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('X-Presales-Sync-Token', token())
    req.add_header('Accept', 'application/json')
    req.add_header('User-Agent', 'PresalesKanzoSync/3.0 (Macintosh; Guilherme; pull-only)')
    if body is not None: req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else {}

class MCP:
    def __init__(self):
        self.sid = None; self.i = 0
        self._post({"jsonrpc":"2.0","id":self._id(),"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"presales-sync","version":"3-pull-only"}}})
        self._post({"jsonrpc":"2.0","method":"notifications/initialized"})
    def _id(self): self.i += 1; return self.i
    def _post(self, body):
        h = {"Content-Type":"application/json","Accept":"application/json, text/event-stream"}
        if self.sid: h["Mcp-Session-Id"] = self.sid
        req = urllib.request.Request(KANZO_MCP, json.dumps(body).encode(), h)
        with urllib.request.urlopen(req, timeout=30) as resp:
            self.sid = resp.headers.get("Mcp-Session-Id") or self.sid
            t = resp.read().decode()
        if not t.strip(): return None
        if t.lstrip().startswith("{"): return json.loads(t)
        out = None
        for line in t.splitlines():
            if line.startswith("data:"):
                d = line[5:].strip()
                if d: out = json.loads(d)
        return out
    def call(self, name, args):
        r = self._post({"jsonrpc":"2.0","id":self._id(),"method":"tools/call","params":{"name":name,"arguments":args}})
        if not r: raise RuntimeError('empty mcp')
        if 'error' in r: raise RuntimeError(r['error'])
        res = r.get('result') or {}
        if res.get('isError'): raise RuntimeError(res)
        for c in res.get('content') or []:
            if c.get('type') == 'text':
                try: return json.loads(c['text'])
                except Exception: return c['text']
        return res

def export_board():
    out = pathlib.Path('/tmp/presales-kanzo-export.json')
    subprocess.check_call([KANZO_BIN, '--home', KANZO_HOME, 'export', '-f', 'json', '-o', str(out)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    data = json.loads(out.read_text())
    data['hostname'] = os.uname().nodename
    return data

def backup_db():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    src = pathlib.Path(KANZO_HOME) / 'kanzo.db'
    if src.exists():
        dst = BACKUP_DIR / f"kanzo-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
        shutil.copy2(src, dst)
        old = sorted(BACKUP_DIR.glob('kanzo-*.db'))
        for f in old[:-30]:
            try: f.unlink()
            except Exception: pass
        return str(dst)
    return None

def _load_delete_guard():
    path = CFG / 'delete_guard.py'
    if not path.exists():
        path = pathlib.Path(__file__).with_name('delete_guard.py')
    spec = importlib.util.spec_from_file_location('delete_guard', path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

def descricoes(data):
    out = {}
    for p in data.get('projects') or []:
        for t in p.get('tasks') or []:
            out[str(t.get('id'))] = t.get('description') or ''
    return out

def sha(txt):
    return hashlib.sha256((txt or '').encode('utf-8')).hexdigest()

def kanzo_task_count():
    dbp = pathlib.Path(KANZO_HOME) / 'kanzo.db'
    with sqlite3.connect(str(dbp)) as conn:
        return conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0]

def apply_commands(mcp: MCP, commands, atual=None):
    """Aplica a fila da nuvem no Kanzo. Lote 3: se o hash da descrição divergir, aplica mesmo assim (nuvem vence)."""
    results = []; ids = []; atual = atual or {}
    if commands:
        backup_db()
    for cmd in commands:
        ids.append(cmd['id'])
        op = cmd.get('op'); payload = cmd.get('payload') or {}
        try:
            if op == 'create_task':
                args = {k: payload[k] for k in ('title','description','status','tags','url','human','project') if k in payload and payload[k] is not None}
                if 'human' in args: args['human'] = bool(args['human'])
                out = mcp.call('create_task', args)
                text = out if isinstance(out, str) else (json.dumps(out, ensure_ascii=False) if out is not None else '')
                m = re.search(r'([A-Za-z0-9_-]+)#(\d+)', text or '')
                real_key = (m.group(1) + '#' + m.group(2)) if m else None
                real_id = int(m.group(2)) if m else None
                results.append({
                    'ok': True, 'op': op, 'out': out,
                    'temp_id': payload.get('temp_id'),
                    'real_id': real_id, 'real_key': real_key,
                })
            elif op == 'update_task':
                tid = str(payload.get('id') or '').split('#')[-1]
                base = payload.get('base_description_sha256')
                if base and 'description' in payload and tid in atual and sha(atual[tid]) != base:
                    log(f'cloud-wins hash mismatch {tid}: aplicando descrição da nuvem')
                args = {k: payload[k] for k in ('id','title','description','status','tags','url','human','waits_on') if k in payload and payload[k] is not None}
                if 'human' in args: args['human'] = bool(args['human'])
                out = mcp.call('update_task', args)
                if 'description' in args and tid: atual[tid] = args['description']
                results.append({'ok': True, 'op': op, 'out': out, 'cloud_forced': bool(base and tid in atual)})
            elif op == 'delete_task':
                guard = _load_delete_guard()
                tid = str(payload.get('id') or '')
                num = tid.split('#')[-1]
                bak = backup_db()
                log(f'delete attempt id={tid} expected_title={payload.get("expected_title")!r} temp_id={payload.get("temp_id")!r} backup={bak}')
                local = None
                try:
                    dbp = pathlib.Path(KANZO_HOME) / 'kanzo.db'
                    with sqlite3.connect(str(dbp)) as conn:
                        row = conn.execute('SELECT id, title, description FROM tasks WHERE id = ?', (int(num),)).fetchone()
                    if row:
                        local = {'id': row[0], 'title': row[1] or '', 'description': row[2] or ''}
                except Exception as ge:
                    log(f'delete local lookup fail {tid}: {ge}')
                    local = None
                ok, why = guard.decide_delete(payload, local)
                if not ok:
                    log(f'delete refused {tid}: {why}')
                    results.append({'ok': False, 'op': op, 'error': why, 'refused': True})
                    continue
                out = mcp.call('delete_task', {'id': tid})
                log(f'delete applied {tid} title={local.get("title")!r}')
                results.append({'ok': True, 'op': op, 'out': out, 'expected_title': payload.get('expected_title')})
            elif op == 'add_comment':
                out = mcp.call('add_comment', {'id': payload.get('id'), 'body': payload.get('body'), 'author': payload.get('author')})
                results.append({'ok': True, 'op': op, 'out': out})
            else:
                results.append({'ok': False, 'op': op, 'error': 'unknown op'})
        except Exception as e:
            results.append({'ok': False, 'op': op, 'error': str(e)})
            log(f'apply fail {op}: {e}')
    return ids, results

def load_state():
    if STATE.exists():
        try: return json.loads(STATE.read_text())
        except Exception: pass
    return {}

def save_state(st):
    CFG.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st))

def cycle():
    """Lote 3: só puxa a fila da nuvem e aplica no Kanzo. Sem push/snapshot."""
    st = load_state()
    st['mode'] = 'pull_only'
    try:
        pulled = http('GET', '/sync/pull')
        cmds = pulled.get('commands') or []
        if cmds:
            log(f'pull {len(cmds)} commands')
            data = export_board()
            mcp = MCP()
            ids, results = apply_commands(mcp, cmds, descricoes(data))
            http('POST', '/sync/ack', {'ids': ids, 'results': results})
            ok_n = sum(1 for r in results if r.get('ok') is not False)
            log(f'ack {len(ids)} ok={ok_n} fail={len(ids)-ok_n}')
        else:
            log('pull 0 commands')
        st['last_pull_ok'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        st['kanzo_tasks'] = kanzo_task_count()
        save_state(st)
        log(f'pull-only ok kanzo_tasks={st["kanzo_tasks"]}')
    except Exception as e:
        log(f'pull error: {e}')
        raise

def main():
    CFG.mkdir(parents=True, exist_ok=True)
    log('agent start mode=pull_only')
    while True:
        try:
            cycle()
        except Exception as e:
            log(f'cycle error: {e}')
        time.sleep(INTERVAL)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'once':
        cycle(); sys.exit(0)
    main()
