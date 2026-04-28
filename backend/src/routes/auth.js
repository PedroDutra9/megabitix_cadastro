const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await query(
      'SELECT * FROM usuarios WHERE email = $1 AND ativo = true',
      [email.toLowerCase().trim()]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(senha, user.senha_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Atualiza ultimo_login
    await query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, nome, email, perfil, ultimo_login FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ─── Gestão de usuários (admin only) ────────────────────

// GET /api/auth/usuarios
router.get('/usuarios', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await query(
    'SELECT id, nome, email, perfil, ativo, criado_em, ultimo_login FROM usuarios ORDER BY id'
  );
  res.json(rows);
});

// POST /api/auth/usuarios
router.post('/usuarios', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nome, email, senha, perfil = 'vendedor' } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    }
    if (!['admin', 'vendedor'].includes(perfil)) {
      return res.status(400).json({ error: 'Perfil inválido' });
    }
    const hash = await bcrypt.hash(senha, 12);
    const { rows } = await query(
      'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, perfil, ativo',
      [nome, email.toLowerCase().trim(), hash, perfil]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PUT /api/auth/usuarios/:id
router.put('/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nome, email, senha, perfil, ativo } = req.body;
    const { id } = req.params;

    let setClauses = [];
    let values = [];
    let i = 1;

    if (nome)   { setClauses.push(`nome = $${i++}`);   values.push(nome); }
    if (email)  { setClauses.push(`email = $${i++}`);  values.push(email.toLowerCase().trim()); }
    if (perfil) { setClauses.push(`perfil = $${i++}`); values.push(perfil); }
    if (ativo !== undefined) { setClauses.push(`ativo = $${i++}`); values.push(ativo); }
    if (senha)  {
      const hash = await bcrypt.hash(senha, 12);
      setClauses.push(`senha_hash = $${i++}`);
      values.push(hash);
    }

    if (!setClauses.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    values.push(id);
    const { rows } = await query(
      `UPDATE usuarios SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING id, nome, email, perfil, ativo`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PUT /api/auth/me/senha — troca de própria senha
router.put('/me/senha', authMiddleware, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if (!senha_atual || !nova_senha) {
      return res.status(400).json({ error: 'Informe a senha atual e a nova senha' });
    }
    const { rows } = await query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(senha_atual, rows[0].senha_hash);
    if (!ok) return res.status(401).json({ error: 'Senha atual incorreta' });

    const hash = await bcrypt.hash(nova_senha, 12);
    await query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
