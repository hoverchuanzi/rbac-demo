const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const authenticate = require('../middleware/authenticate');
const { failure, success } = require('../response');

const router = express.Router();

// 登录和用户信息接口放在这里
router.post('/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};

    if (
      typeof username !== 'string' ||
      username.trim() === '' ||
      typeof password !== 'string' ||
      password === ''
    ) {
      return failure(res, 400, '用户名和密码不能为空');
    }

    const userResult = await pool.query(
      `
        SELECT id, password_hash
        FROM users
        WHERE lower(username) = lower($1)
          AND is_active = TRUE
        LIMIT 1
      `,
      [username.trim()],
    );

    const user = userResult.rows[0];
    const passwordMatched = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!passwordMatched) {
      return failure(res, 401, '用户名或密码错误');
    }

    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    });

    await pool.query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id],
    );

    return success(res, { accessToken }, '登录成功');
  } catch (error) {
    return next(error);
  }
});

router.get('/user/info', authenticate, async (req, res, next) => {
  try {
    const userResult = await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.real_name,
          u.avatar,
          u.email,
          COALESCE(
            array_agg(DISTINCT r.code ORDER BY r.code)
              FILTER (WHERE r.code IS NOT NULL),
            ARRAY[]::varchar[]
          ) AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
        WHERE u.id = $1
          AND u.is_active = TRUE
        GROUP BY u.id
      `,
      [req.auth.userId],
    );

    if (userResult.rowCount === 0) {
      return failure(res, 401, '用户不存在或已被禁用');
    }

    const user = userResult.rows[0];
    return success(res, {
      id: user.id,
      username: user.username,
      realName: user.real_name,
      avatar: user.avatar,
      email: user.email,
      roles: user.roles,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;