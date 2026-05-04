const express = require('express');
const { query, pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/produtos
router.get('/', async (req, res) => {
  try {
    const { busca, categoria } = req.query;
    let conditions = [];
    let params = [];
    let i = 1;

    if (busca) { conditions.push(`(p.nome ILIKE $${i} OR p.marca ILIKE $${i})`); params.push(`%${busca}%`); i++; }
    if (categoria) { conditions.push(`p.categoria = $${i++}`); params.push(categoria); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await query(`
      SELECT p.*,
        COUNT(s.id) FILTER (WHERE s.status = 'disponível') AS qtd_disponivel,
        COUNT(s.id) AS qtd_total,
        JSON_AGG(
          JSON_BUILD_OBJECT('id', s.id, 'sn', s.sn, 'status', s.status)
          ORDER BY s.sn
        ) FILTER (WHERE s.id IS NOT NULL) AS seriais
      FROM produtos p
      LEFT JOIN seriais s ON s.produto_id = p.id
      ${where}
      GROUP BY p.id
      ORDER BY p.nome
    `, params);

    res.json(rows.map(r => ({ ...r, seriais: r.seriais || [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar produtos' });
  }
});

// GET /api/produtos/estoque/resumo  — DEVE VIR ANTES DE /:id
router.get('/estoque/resumo', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT 
        p.id, p.nome, p.categoria, p.marca,
        s.id as serial_id, s.sn, s.status,
        v.id as venda_id
      FROM produtos p
      JOIN seriais s ON s.produto_id = p.id
      LEFT JOIN venda_itens vi ON vi.serial_id = s.id
      LEFT JOIN vendas v ON v.id = vi.venda_id
      ORDER BY p.nome, s.sn
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estoque' });
  }
});

// GET /api/produtos/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.*,
        JSON_AGG(JSON_BUILD_OBJECT('id', s.id, 'sn', s.sn, 'status', s.status) ORDER BY s.sn)
          FILTER (WHERE s.id IS NOT NULL) AS seriais
      FROM produtos p
      LEFT JOIN seriais s ON s.produto_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ ...rows[0], seriais: rows[0].seriais || [] });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

// POST /api/produtos
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { nome, categoria, marca, modelo, descricao, seriais = [] } = req.body;
    if (!nome || !categoria) return res.status(400).json({ error: 'Nome e categoria são obrigatórios' });

    const { rows } = await client.query(
      'INSERT INTO produtos (nome, categoria, marca, modelo, descricao) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [nome, categoria, marca, modelo, descricao]
    );
    const produto = rows[0];

    for (const sn of seriais) {
      await client.query('INSERT INTO seriais (produto_id, sn) VALUES ($1, $2)', [produto.id, sn]);
    }

    await client.query('COMMIT');
    res.status(201).json(produto);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Número de série já cadastrado' });
    res.status(500).json({ error: 'Erro ao criar produto' });
  } finally {
    client.release();
  }
});

// PUT /api/produtos/:id
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { nome, categoria, marca, modelo, descricao, seriais = [] } = req.body;
    if (!nome || !categoria) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nome e categoria são obrigatórios' });
    }

    const { rows } = await client.query(
      'UPDATE produtos SET nome=$1, categoria=$2, marca=$3, modelo=$4, descricao=$5, atualizado_em=NOW() WHERE id=$6 RETURNING *',
      [nome, categoria, marca || null, modelo || null, descricao || null, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // Adiciona séries novas
    for (const sn of seriais) {
      await client.query(
        'INSERT INTO seriais (produto_id, sn) VALUES ($1, $2) ON CONFLICT (sn) DO NOTHING',
        [req.params.id, sn]
      );
    }

    await client.query('COMMIT');

    // Retorna produto completo com seriais
    const { rows: full } = await query(`
      SELECT p.*,
        COUNT(s.id) FILTER (WHERE s.status = 'disponível') AS qtd_disponivel,
        COUNT(s.id) AS qtd_total,
        JSON_AGG(JSON_BUILD_OBJECT('id', s.id, 'sn', s.sn, 'status', s.status) ORDER BY s.sn)
          FILTER (WHERE s.id IS NOT NULL) AS seriais
      FROM produtos p
      LEFT JOIN seriais s ON s.produto_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [req.params.id]);

    res.json({ ...full[0], seriais: full[0].seriais || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro PUT produto:', err);
    res.status(500).json({ error: 'Erro ao atualizar produto: ' + err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/produtos/:produtoId/serial/:serialId — exclui série individual
router.delete('/:produtoId/serial/:serialId', async (req, res) => {
  try {
    const { rows } = await query('SELECT status, sn FROM seriais WHERE id = $1 AND produto_id = $2', [req.params.serialId, req.params.produtoId]);
    if (!rows.length) return res.status(404).json({ error: 'Série não encontrada' });
    if (rows[0].status === 'vendido') return res.status(409).json({ error: `Série ${rows[0].sn} já foi vendida e não pode ser removida` });
    await query('DELETE FROM seriais WHERE id = $1', [req.params.serialId]);
    res.json({ ok: true, sn: rows[0].sn });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover série' });
  }
});

module.exports = router;
