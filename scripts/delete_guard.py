"""Guarda de delete Mac<-nuvem: só apaga se id existir e título (e hash em deletes mapeados) baterem."""
from __future__ import annotations
import hashlib, re, unicodedata

def fold(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def sha256_text(s: str) -> str:
    return hashlib.sha256((s or '').encode('utf-8')).hexdigest()

def decide_delete(payload: dict, local: dict | None) -> tuple[bool, str]:
    """local: {id, title, description} ou None se não existe no Kanzo.

    - Sempre exige expected_title (bloqueia delete cego como o do Venko #8).
    - Se vier temp_id (delete via id-map), também exige expected_description_sha256
      batendo com a descrição local — evita apagar outro card se o mapa apontar errado.
    - Delete direto de card real: título basta (a descrição pode ter mudado no Mac
      entre o enqueue e o apply).
    """
    payload = payload or {}
    expected = payload.get('expected_title')
    if expected is None or str(expected).strip() == '':
        return False, 'missing expected_title (refusing blind delete)'
    if local is None:
        return False, 'card not found on Mac'
    if fold(str(expected)) != fold(str(local.get('title') or '')):
        return False, 'title mismatch: expected %r got %r' % (expected, local.get('title'))
    if payload.get('temp_id') is not None:
        exp_hash = payload.get('expected_description_sha256')
        if not exp_hash:
            return False, 'missing expected_description_sha256 for mapped delete'
        got = sha256_text(local.get('description') or '')
        if str(exp_hash).lower() != got.lower():
            return False, 'description hash mismatch'
    return True, 'ok'
