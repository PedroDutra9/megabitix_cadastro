const express = require('express');
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/despesas
router.get('/', async (req, res) => {
  try {
    const { status, categoria, mes, ano } = req.query;
    let conditions = [];
    let params = [];
    let i = 1;

    if (status)    { conditions.push(`status = $${i++}`); params.push(status); }
    if (categoria) { conditions.push(`categoria = $${i++}`); params.push(categoria); }
    if (mes && ano) {
      conditions.push(`EXTRACT(MONTH FROM data_vencimento) = $${i++}`); params.push(parseInt(mes));
      conditions.push(`EXTRACT(YEAR FROM data_vencimento) = $${i++}`); params.push(parseInt(ano));
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await query(
      `SELECT * FROM despesas ${where} ORDER BY data_vencimento ASC, criado_em DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar despesas' });
  }
});

// GET /api/despesas/stats
router.get('/stats', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const { rows: [s] } = await query(`
      SELECT
        COALESCE(SUM(valor) FILTER (WHERE status = 'pago'), 0)          AS total_pago,
        COALESCE(SUM(valor) FILTER (WHERE status = 'pendente'), 0)      AS total_pendente,
        COALESCE(SUM(valor) FILTER (WHERE status = 'pendente' AND data_vencimento < $1), 0) AS total_vencido,
        COUNT(*) FILTER (WHERE status = 'pendente')::int                AS qtd_pendente,
        COUNT(*) FILTER (WHERE status = 'pendente' AND data_vencimento < $1)::int AS qtd_vencido,
        COUNT(*) FILTER (WHERE status = 'pago')::int                    AS qtd_pago
      FROM despesas
    `, [hoje]);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: 'Erro' });
  }
});

// GET /api/despesas/mensal — despesas agrupadas por mês (últimos 12 meses)
router.get('/mensal', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        TO_CHAR(data_vencimento, 'YYYY-MM') AS mes,
        TO_CHAR(data_vencimento, 'Mon/YY')  AS mes_label,
        COALESCE(SUM(valor), 0)             AS total,
        COUNT(*)::int                       AS qtd
      FROM despesas
      WHERE data_vencimento >= NOW() - INTERVAL '12 months'
      GROUP BY 1, 2
      ORDER BY 1
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro' });
  }
});

// POST /api/despesas
router.post('/', async (req, res) => {
  try {
    const {
      descricao, categoria, valor, data_vencimento,
      recorrente = false, frequencia, status = 'pendente', observacao
    } = req.body;
    if (!descricao || !valor || !data_vencimento) {
      return res.status(400).json({ error: 'Descrição, valor e vencimento são obrigatórios' });
    }
    const { rows } = await query(`
      INSERT INTO despesas (descricao, categoria, valor, data_vencimento, recorrente, frequencia, status, observacao)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [descricao, categoria || 'Outros', parseFloat(valor), data_vencimento, recorrente, frequencia || null, status, observacao || null]);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar despesa' });
  }
});

// PUT /api/despesas/:id
router.put('/:id', async (req, res) => {
  try {
    const { descricao, categoria, valor, data_vencimento, recorrente, frequencia, status, observacao } = req.body;
    const { rows } = await query(`
      UPDATE despesas SET
        descricao=$1, categoria=$2, valor=$3, data_vencimento=$4,
        recorrente=$5, frequencia=$6, status=$7, observacao=$8, atualizado_em=NOW()
      WHERE id=$9 RETURNING *
    `, [descricao, categoria, parseFloat(valor), data_vencimento, recorrente, frequencia, status, observacao, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Despesa não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar despesa' });
  }
});

// PATCH /api/despesas/:id/pagar
router.patch('/:id/pagar', async (req, res) => {
  try {
    const { data_pagamento } = req.body;
    const dataPgto = data_pagamento || new Date().toISOString().split('T')[0];
    const { rows } = await query(`
      UPDATE despesas SET status='pago', data_pagamento=$1, atualizado_em=NOW()
      WHERE id=$2 RETURNING *
    `, [dataPgto, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Despesa não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao pagar despesa' });
  }
});

// DELETE /api/despesas/:id
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM despesas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir despesa' });
  }
});

module.exports = router;
