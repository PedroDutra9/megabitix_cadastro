const express = require('express');
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/contratos
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT co.id, co.num_contrato, co.venda_id, co.gerado_em,
             co.assinado_nome, co.assinado_em,
             v.valor_total, v.tem_implantacao,
             c.nome AS cliente_nome,
             u.nome AS gerado_por_nome
      FROM contratos co
      JOIN vendas v ON v.id = co.venda_id
      JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN usuarios u ON u.id = co.gerado_por
      ORDER BY co.gerado_em DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar contratos' });
  }
});

// POST /api/contratos
router.post('/', async (req, res) => {
  try {
    const { venda_id, num_contrato } = req.body;
    if (!venda_id || !num_contrato) return res.status(400).json({ error: 'venda_id e num_contrato são obrigatórios' });
    const { rows } = await query(`
      INSERT INTO contratos (num_contrato, venda_id, gerado_por)
      VALUES ($1, $2, $3)
      ON CONFLICT (num_contrato) DO UPDATE SET gerado_em = NOW()
      RETURNING id, num_contrato, venda_id, gerado_em
    `, [num_contrato, venda_id, req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar contrato' });
  }
});

// POST /api/contratos/:id/assinado
router.post('/:id/assinado', async (req, res) => {
  try {
    const { base64, nome } = req.body;
    if (!base64 || !nome) return res.status(400).json({ error: 'base64 e nome são obrigatórios' });
    if (base64.length > 14000000) return res.status(413).json({ error: 'Arquivo muito grande (máx 10MB)' });
    const { rows } = await query(`
      UPDATE contratos SET assinado_base64 = $1, assinado_nome = $2, assinado_em = NOW()
      WHERE id = $3 RETURNING id, num_contrato, assinado_nome, assinado_em
    `, [base64, nome, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Contrato não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar contrato assinado' });
  }
});

// GET /api/contratos/:id/assinado
router.get('/:id/assinado', async (req, res) => {
  try {
    const { rows } = await query('SELECT assinado_base64, assinado_nome FROM contratos WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].assinado_base64) return res.status(404).json({ error: 'Nenhum contrato assinado' });
    res.json({ base64: rows[0].assinado_base64, nome: rows[0].assinado_nome });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar contrato assinado' });
  }
});

// DELETE /api/contratos/:id/assinado
router.delete('/:id/assinado', async (req, res) => {
  try {
    await query('UPDATE contratos SET assinado_base64 = NULL, assinado_nome = NULL, assinado_em = NULL WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover contrato assinado' });
  }
});

module.exports = router;
