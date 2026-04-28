const express = require('express');
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/clientes
router.get('/', async (req, res) => {
  try {
    const { busca } = req.query;
    let sql = 'SELECT * FROM clientes';
    let params = [];
    if (busca) {
      sql += ' WHERE nome ILIKE $1 OR doc ILIKE $1';
      params = [`%${busca}%`];
    }
    sql += ' ORDER BY nome';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar clientes' });
  }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Cliente não encontrado' });
  res.json(rows[0]);
});

// POST /api/clientes
router.post('/', async (req, res) => {
  try {
    const { nome, doc, tel, email, cep, rua, num, comp, bairro, cidade, estado, rep, cpf_rep, cargo_rep } = req.body;
    if (!nome || !doc) return res.status(400).json({ error: 'Nome e CNPJ/CPF são obrigatórios' });

    const { rows } = await query(
      `INSERT INTO clientes (nome, doc, tel, email, cep, rua, num, comp, bairro, cidade, estado, rep, cpf_rep, cargo_rep)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [nome, doc, tel, email, cep, rua, num, comp, bairro, cidade, estado, rep, cpf_rep, cargo_rep]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar cliente' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
  try {
    const { nome, doc, tel, email, cep, rua, num, comp, bairro, cidade, estado, rep, cpf_rep, cargo_rep } = req.body;
    const { rows } = await query(
      `UPDATE clientes SET nome=$1, doc=$2, tel=$3, email=$4, cep=$5, rua=$6, num=$7,
       comp=$8, bairro=$9, cidade=$10, estado=$11, rep=$12, cpf_rep=$13, cargo_rep=$14
       WHERE id = $15 RETURNING *`,
      [nome, doc, tel, email, cep, rua, num, comp, bairro, cidade, estado, rep, cpf_rep, cargo_rep, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar cliente' });
  }
});

// DELETE /api/clientes/:id (soft — apenas verifica dependências)
router.delete('/:id', async (req, res) => {
  try {
    const { rows: vendas } = await query('SELECT id FROM vendas WHERE cliente_id = $1 LIMIT 1', [req.params.id]);
    if (vendas.length) return res.status(409).json({ error: 'Cliente possui vendas vinculadas e não pode ser excluído' });
    await query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir cliente' });
  }
});

module.exports = router;
