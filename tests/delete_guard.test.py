#!/usr/bin/env python3
"""Regressão: delete da nuvem não pode apagar card errado (caso Venko #8)."""
import importlib.util, pathlib, unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('delete_guard', ROOT / 'scripts' / 'delete_guard.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

VENKO = {
    'id': 8,
    'title': 'Verificacao de novo fornecedor para substituir Venko',
    'description': '**Solução / Escopo:** Serviços de implantação e suporte para redes LTE privativas\n**Responsáveis:** Guilherme Romio Netto',
}
E2E = {
    'id': 61,
    'title': '__e2e_idmap_1794231494__',
    'description': '',
}

class DeleteGuardTests(unittest.TestCase):
    def test_recusa_se_card_nao_existe(self):
        ok, why = g.decide_delete({'id': 'pre-vendas#8', 'expected_title': VENKO['title']}, None)
        self.assertFalse(ok)
        self.assertIn('not found', why.lower())

    def test_recusa_se_titulo_nao_bate_colisao_idmap(self):
        payload = {
            'id': 'pre-vendas#8',
            'temp_id': 100067,
            'expected_title': E2E['title'],
            'expected_description_sha256': g.sha256_text(E2E['description']),
        }
        ok, why = g.decide_delete(payload, VENKO)
        self.assertFalse(ok)
        self.assertIn('title', why.lower())

    def test_aceita_delete_do_card_criado_pelo_temp_id(self):
        payload = {
            'id': 'pre-vendas#61',
            'temp_id': 100067,
            'expected_title': E2E['title'],
            'expected_description_sha256': g.sha256_text(E2E['description']),
        }
        ok, why = g.decide_delete(payload, E2E)
        self.assertTrue(ok, why)

    def test_recusa_sem_expected_title(self):
        ok, why = g.decide_delete({'id': 'pre-vendas#8'}, VENKO)
        self.assertFalse(ok)
        self.assertIn('expected_title', why.lower())

    def test_recusa_mapped_se_hash_nao_bate(self):
        payload = {
            'id': 'pre-vendas#61',
            'temp_id': 100067,
            'expected_title': E2E['title'],
            'expected_description_sha256': '0' * 64,
        }
        ok, why = g.decide_delete(payload, E2E)
        self.assertFalse(ok)
        self.assertIn('hash', why.lower())

    def test_aceita_venko_legitimo_com_titulo(self):
        payload = {
            'id': 'pre-vendas#8',
            'expected_title': VENKO['title'],
            'expected_description_sha256': g.sha256_text(VENKO['description']),
        }
        ok, why = g.decide_delete(payload, VENKO)
        self.assertTrue(ok, why)

    def test_delete_direto_ignora_hash_desatualizado_se_titulo_bate(self):
        payload = {
            'id': 'pre-vendas#8',
            'expected_title': VENKO['title'],
            'expected_description_sha256': '0' * 64,
        }
        ok, why = g.decide_delete(payload, VENKO)
        self.assertTrue(ok, why)

if __name__ == '__main__':
    unittest.main()
