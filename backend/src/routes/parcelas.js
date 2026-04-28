const express = require('express');
const { query, pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Helpers ─────────────────────────────────────────────
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1 + months, d);
  // Garante o dia de vencimento correto (ex: dia 22)
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function proximoVencimento(diaVenc, mesBase) {
  // mesBase = 0-indexed month, ex: 3 = abril
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth(); // 0-indexed
  // Começa no próximo mês a partir de hoje
  const dt = new Date(ano, mes + mesBase, diaVenc);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(diaVenc).padStart(2,'0')}`;
}

// ── Gera parcelas automaticamente ao criar venda ────────
async function gerarParcelas(client, vendaId) {
  const { rows: [v] } = await client.query('SELECT * FROM vendas WHERE id = $1', [vendaId]);
  if (!v || v.forma_pagamento !== 'Parcelado') return;

  const nParc   = parseInt(v.num_parcelas || 0);
  const vParc   = parseFloat(v.valor_parcela || 0);
  const diaVenc = parseInt(v.dia_vencimento || 22);
  const entrada  = parseFloat(v.entrada || 0);

  if (nParc <= 0) return;

  // Parcela 0 = entrada (se houver)
  if (entrada > 0) {
    const dataHoje = new Date().toISOString().split('T')[0];
    await client.query(
      `INSERT INTO parcelas (venda_id, numero, valor, data_vencimento, status, observacao)
       VALUES ($1, 0, $2, $3, 'pendente', 'Entrada')`,
      [vendaId, entrada, dataHoje]
    );
  }

  // Parcelas mensais
  for (let i = 1; i <= nParc; i++) {
    const venc = proximoVencimento(diaVenc, i);
    await client.query(
      `INSERT INTO parcelas (venda_id, numero, valor, data_vencimento, status)
       VALUES ($1, $2, $3, $4, 'pendente')`,
      [vendaId, i, vParc, venc]
    );
  }
}

// GET /api/parcelas/venda/:vendaId — parcelas de uma venda
router.get('/venda/:vendaId', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.*, v.forma_pagamento, v.valor_total, c.nome AS cliente_nome
       FROM parcelas p
       JOIN vendas v ON v.id = p.venda_id
       JOIN clientes c ON c.id = v.cliente_id
       WHERE p.venda_id = $1
       ORDER BY p.numero`,
      [req.params.vendaId]
    );
    // Atualiza status "vencido" automaticamente
    const hoje = new Date().toISOString().split('T')[0];
    const atualizadas = rows.map(p => ({
      ...p,
      status: p.status === 'pendente' && p.data_vencimento < hoje ? 'vencido' : p.status
    }));
    res.json(atualizadas);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar parcelas' });
  }
});

// GET /api/parcelas/cobrancas — visão geral de todas as cobranças
router.get('/cobrancas', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const { rows } = await query(`
      SELECT 
        p.*,
        c.nome AS cliente_nome,
        c.tel AS cliente_tel,
        c.email AS cliente_email,
        v.id AS venda_num,
        CASE 
          WHEN p.status = 'pago' THEN 'pago'
          WHEN p.status = 'cancelado' THEN 'cancelado'
          WHEN p.data_vencimento < $1 THEN 'vencido'
          WHEN p.data_vencimento = $1 THEN 'vence_hoje'
          WHEN p.data_vencimento <= ($1::date + interval '7 days') THEN 'vence_semana'
          ELSE 'pendente'
        END AS status_calc
      FROM parcelas p
      JOIN vendas v ON v.id = p.venda_id
      JOIN clientes c ON c.id = v.cliente_id
      WHERE p.status != 'cancelado'
      ORDER BY p.data_vencimento ASC, c.nome ASC
    `, [hoje]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar cobranças' });
  }
});

// GET /api/parcelas/cobrancas/stats
router.get('/cobrancas/stats', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const { rows: [s] } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pago')::int AS total_pago,
        COUNT(*) FILTER (WHERE status = 'pendente' AND data_vencimento >= $1)::int AS total_pendente,
        COUNT(*) FILTER (WHERE status = 'pendente' AND data_vencimento < $1)::int AS total_vencido,
        COALESCE(SUM(valor) FILTER (WHERE status = 'pago'), 0) AS valor_recebido,
        COALESCE(SUM(valor) FILTER (WHERE status = 'pendente'), 0) AS valor_a_receber,
        COALESCE(SUM(valor) FILTER (WHERE status = 'pendente' AND data_vencimento < $1), 0) AS valor_vencido
      FROM parcelas
      WHERE status != 'cancelado'
    `, [hoje]);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar stats' });
  }
});

// PATCH /api/parcelas/:id/pagar — marca como pago
router.patch('/:id/pagar', async (req, res) => {
  try {
    const { data_pagamento, observacao } = req.body;
    const dataPgto = data_pagamento || new Date().toISOString().split('T')[0];
    const { rows } = await query(
      `UPDATE parcelas SET status = 'pago', data_pagamento = $1, observacao = $2
       WHERE id = $3 RETURNING *`,
      [dataPgto, observacao || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Parcela não encontrada' });

    // Verifica se todas as parcelas da venda estão pagas → atualiza status da venda
    const { rows: [{ total, pagas }] } = await query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'pago') AS pagas
       FROM parcelas WHERE venda_id = $1`,
      [rows[0].venda_id]
    );
    if (parseInt(total) === parseInt(pagas)) {
      await query("UPDATE vendas SET status = 'Pago' WHERE id = $1", [rows[0].venda_id]);
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar pagamento' });
  }
});

// PATCH /api/parcelas/:id/estornar — volta para pendente
router.patch('/:id/estornar', async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE parcelas SET status = 'pendente', data_pagamento = NULL
       WHERE id = $1 AND status = 'pago' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Parcela não encontrada ou não está paga' });
    // Volta status da venda se estava como Pago
    await query("UPDATE vendas SET status = 'Em andamento' WHERE id = $1 AND status = 'Pago'", [rows[0].venda_id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao estornar pagamento' });
  }
});

module.exports = { router, gerarParcelas };
