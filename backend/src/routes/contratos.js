const express = require('express');
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/contratos
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT co.*, v.valor_total, v.tem_implantacao, c.nome AS cliente_nome, u.nome AS gerado_por_nome
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

// POST /api/contratos (registra que o contrato foi gerado)
router.post('/', async (req, res) => {
  try {
    const { venda_id, num_contrato } = req.body;
    if (!venda_id || !num_contrato) return res.status(400).json({ error: 'venda_id e num_contrato são obrigatórios' });

    const { rows } = await query(`
      INSERT INTO contratos (num_contrato, venda_id, gerado_por)
      VALUES ($1, $2, $3)
      ON CONFLICT (num_contrato) DO UPDATE SET gerado_em = NOW()
      RETURNING *
    `, [num_contrato, venda_id, req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar contrato' });
  }
});

module.exports = router;
