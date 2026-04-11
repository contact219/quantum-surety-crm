import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'qs-crm-secret-2026';

export function requireAuth(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = decoded;
      next();
    } catch(err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const result = await db.execute(sql`
      SELECT * FROM crm_users WHERE (username = ${username} OR email = ${username}) AND active = true
    `);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    await db.execute(sql`UPDATE crm_users SET last_login = now() WHERE id = ${user.id}`);
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

authRouter.get('/me', requireAuth(), async (req, res) => {
  res.json(req.user);
});

authRouter.get('/users', requireAuth(['admin']), async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT id, username, email, role, active, last_login, created_at FROM crm_users ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

authRouter.post('/users', requireAuth(['admin']), async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.execute(sql`
      INSERT INTO crm_users (username, email, password_hash, role)
      VALUES (${username}, ${email}, ${hash}, ${role||'sales'})
      RETURNING id, username, email, role
    `);
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

authRouter.patch('/users/:id', requireAuth(['admin']), async (req, res) => {
  const { role, active, password } = req.body;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.execute(sql`UPDATE crm_users SET password_hash=${hash} WHERE id=${parseInt(req.params.id)}`);
    }
    if (role !== undefined) await db.execute(sql`UPDATE crm_users SET role=${role} WHERE id=${parseInt(req.params.id)}`);
    if (active !== undefined) await db.execute(sql`UPDATE crm_users SET active=${active} WHERE id=${parseInt(req.params.id)}`);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

authRouter.post('/change-password', requireAuth(), async (req, res) => {
  const { current_password, new_password } = req.body;
  try {
    const result = await db.execute(sql`SELECT * FROM crm_users WHERE id=${req.user.id}`);
    const user = result.rows[0];
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await db.execute(sql`UPDATE crm_users SET password_hash=${hash} WHERE id=${req.user.id}`);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
