const express = require('express');
const { query, pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { gerarParcelas } = require('./parcelas');

const router = express.Router();
router.use(authMiddleware);

// GET /api/vendas
router.get('/', async (req, res) => {
  try {
    const { busca, status, pagamento } = req.query;
    let conditions = [];
    let params = [];
    let i = 1;

    if (busca) {
      conditions.push(`(c.nome ILIKE $${i} OR CAST(v.id AS TEXT) LIKE $${i})`);
      params.push(`%${busca}%`); i++;
    }
    if (status) { conditions.push(`v.status = $${i++}`); params.push(status); }
    if (pagamento) { conditions.push(`v.forma_pagamento = $${i++}`); params.push(pagamento); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await query(`
      SELECT 
        v.*,
        c.nome AS cliente_nome, c.doc AS cliente_doc,
        u.nome AS usuario_nome,
        COUNT(vi.id) AS qtd_itens
      FROM vendas v
      JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN venda_itens vi ON vi.venda_id = v.id
      ${where}
      GROUP BY v.id, c.nome, c.doc, u.nome
      ORDER BY v.criado_em DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar vendas' });
  }
});

// GET /api/vendas/:id (detalhes completos)
router.get('/:id', async (req, res) => {
  try {
    const { rows: vRows } = await query(`
      SELECT v.*, c.*, u.nome AS usuario_nome,
        c.nome AS cliente_nome, c.doc AS cliente_doc,
        c.rua, c.num, c.comp, c.bairro, c.cidade, c.estado, c.cep,
        c.rep, c.cpf_rep, c.cargo_rep, c.tel AS cliente_tel, c.email AS cliente_email
      FROM vendas v
      JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.id = $1
    `, [req.params.id]);
    if (!vRows.length) return res.status(404).json({ error: 'Venda não encontrada' });

    const { rows: iRows } = await query(`
      SELECT vi.*, p.nome AS produto_nome, p.marca, p.modelo, p.categoria, s.sn
      FROM venda_itens vi
      JOIN produtos p ON p.id = vi.produto_id
      JOIN seriais s ON s.id = vi.serial_id
      WHERE vi.venda_id = $1
      ORDER BY vi.id
    `, [req.params.id]);

    res.json({ ...vRows[0], itens: iRows });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar venda' });
  }
});

// POST /api/vendas
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      cliente_id, valor_total, forma_pagamento, status = 'Pendente',
      entrada, num_parcelas, dia_vencimento, valor_parcela, saldo_restante,
      tem_implantacao = false, impl_data, impl_descricao,
      itens = []
    } = req.body;

    if (!cliente_id || !valor_total || !forma_pagamento) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cliente, valor total e forma de pagamento são obrigatórios' });
    }
    if (!itens.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A venda deve ter ao menos um item' });
    }

    // Verifica disponibilidade das séries
    for (const item of itens) {
      const { rows } = await client.query(
        'SELECT status FROM seriais WHERE id = $1 FOR UPDATE',
        [item.serial_id]
      );
      if (!rows.length) throw new Error(`Série ID ${item.serial_id} não encontrada`);
      if (rows[0].status !== 'disponível') throw new Error(`Série já vendida ou reservada`);
    }

    // Cria a venda
    const { rows: [venda] } = await client.query(`
      INSERT INTO vendas (
        cliente_id, usuario_id, valor_total, forma_pagamento, status,
        entrada, num_parcelas, dia_vencimento, valor_parcela, saldo_restante,
        tem_implantacao, impl_data, impl_descricao
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        cliente_id, req.user.id, valor_total, forma_pagamento, status,
        entrada || null, num_parcelas || null, dia_vencimento || null,
        valor_parcela || null, saldo_restante || null,
        tem_implantacao, impl_data || null, impl_descricao || null
      ]
    );

    // Insere itens e marca séries como vendidas
    for (const item of itens) {
      await client.query(
        'INSERT INTO venda_itens (venda_id, produto_id, serial_id, valor_unit) VALUES ($1,$2,$3,$4)',
        [venda.id, item.produto_id, item.serial_id, item.valor_unit || 0]
      );
      await client.query(
        'UPDATE seriais SET status = $1 WHERE id = $2',
        ['vendido', item.serial_id]
      );
    }

    // Gera parcelas se for venda parcelada
    await gerarParcelas(client, venda.id);

    await client.query('COMMIT');
    res.status(201).json(venda);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.message.includes('Série') ? 409 : 500).json({ error: err.message || 'Erro ao registrar venda' });
  } finally {
    client.release();
  }
});

// PATCH /api/vendas/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Pendente', 'Em andamento', 'Pago'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    const { rows } = await query(
      'UPDATE vendas SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Venda não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

// DELETE /api/vendas/:id — cancela venda e devolve séries ao estoque
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Busca a venda
    const { rows: vendaRows } = await client.query('SELECT * FROM vendas WHERE id = $1', [req.params.id]);
    if (!vendaRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    // Devolve séries ao estoque
    const { rows: itens } = await client.query(
      'SELECT serial_id FROM venda_itens WHERE venda_id = $1', [req.params.id]
    );
    for (const item of itens) {
      await client.query('UPDATE seriais SET status = $1 WHERE id = $2', ['disponível', item.serial_id]);
    }

    // Remove itens, contratos e venda
    await client.query('DELETE FROM contratos WHERE venda_id = $1', [req.params.id]);
    await client.query('DELETE FROM venda_itens WHERE venda_id = $1', [req.params.id]);
    await client.query('DELETE FROM vendas WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.json({ ok: true, seriais_devolvidos: itens.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar venda' });
  } finally {
    client.release();
  }
});

// GET /api/vendas/faturamento/mensal — últimos 12 meses
router.get('/faturamento/mensal', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        TO_CHAR(data_venda, 'YYYY-MM')  AS mes,
        TO_CHAR(data_venda, 'Mon/YY')   AS mes_label,
        COUNT(*)::int                   AS total_vendas,
        COALESCE(SUM(valor_total), 0)   AS faturamento,
        COUNT(*) FILTER (WHERE status = 'Pago')::int AS vendas_pagas,
        COALESCE(SUM(valor_total) FILTER (WHERE status = 'Pago'), 0) AS faturamento_pago
      FROM vendas
      WHERE data_venda >= NOW() - INTERVAL '12 months'
      GROUP BY 1, 2
      ORDER BY 1
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar faturamento mensal' });
  }
});

// GET /api/vendas/dashboard/stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const { rows: [stats] } = await query(`
      SELECT
        COUNT(DISTINCT v.id)::int AS total_vendas,
        COALESCE(SUM(v.valor_total), 0) AS faturamento_total,
        COUNT(DISTINCT v.id) FILTER (WHERE v.status = 'Pago')::int AS vendas_pagas,
        COUNT(DISTINCT v.id) FILTER (WHERE v.status = 'Pendente')::int AS vendas_pendentes
      FROM vendas v
    `);
    const { rows: [estoque] } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'disponível')::int AS disponiveis,
        COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
        COUNT(*)::int AS total
      FROM seriais
    `);
    const { rows: [clientes] } = await query('SELECT COUNT(*)::int AS total FROM clientes');
    res.json({ ...stats, ...estoque, total_clientes: clientes.total });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

module.exports = router;
