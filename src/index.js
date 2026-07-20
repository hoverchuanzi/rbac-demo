const bcrypt = require('bcrypt');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable');
}

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function success(res, data, message = 'ok') {
  return res.json({ code: 0, data, message });
}

function failure(res, status, message, code = status) {
  return res.status(status).json({ code, data: null, message });
}

function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return failure(res, 401, '未提供有效的访问令牌');
  }

  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET);

    if (!payload || typeof payload !== 'object' || !payload.userId) {
      return failure(res, 401, '访问令牌无效');
    }

    req.auth = { userId: payload.userId };
    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return failure(res, 401, '访问令牌已过期');
    }

    return failure(res, 401, '访问令牌无效');
  }
}

function buildMenuTree(rows) {
  const menusById = new Map();

  for (const row of rows) {
    const extraMeta =
      row.extra_meta &&
      typeof row.extra_meta === 'object' &&
      !Array.isArray(row.extra_meta)
        ? row.extra_meta
        : {};
    const meta = {
      ...extraMeta,
      title: row.title,
      order: row.sort_order,
      hideInMenu: row.is_hidden,
      keepAlive: row.keep_alive,
    };

    if (row.icon) {
      meta.icon = row.icon;
    }

    const menu = {
      name: row.name,
      path: row.path,
      meta,
    };

    if (row.component) {
      menu.component = row.component;
    }

    if (row.redirect) {
      menu.redirect = row.redirect;
    }

    menusById.set(String(row.id), {
      menu,
      parentId: row.parent_id === null ? null : String(row.parent_id),
    });
  }

  const roots = [];

  for (const entry of menusById.values()) {
    if (entry.parentId === null) {
      roots.push(entry.menu);
      continue;
    }

    const parent = menusById.get(entry.parentId);

    // A child without an accessible parent cannot form a valid menu route.
    if (!parent) {
      continue;
    }

    parent.menu.children ??= [];
    parent.menu.children.push(entry.menu);
  }

  return roots;
}

app.post('/auth/login', async (req, res, next) => {
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

app.get('/user/info', authenticate, async (req, res, next) => {
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

app.get('/menu/all', authenticate, async (req, res, next) => {
  try {
    const userResult = await pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND is_active = TRUE',
      [req.auth.userId],
    );

    if (userResult.rowCount === 0) {
      return failure(res, 401, '用户不存在或已被禁用');
    }

    const menuResult = await pool.query(
      `
        SELECT
          m.id,
          m.parent_id,
          m.name,
          m.path,
          m.component,
          m.redirect,
          m.title,
          m.icon,
          m.sort_order,
          m.is_hidden,
          m.keep_alive,
          m.extra_meta
        FROM menus m
        WHERE m.is_active = TRUE
          AND EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN roles r
              ON r.id = ur.role_id
             AND r.is_active = TRUE
            JOIN role_menus rm
              ON rm.role_id = r.id
             AND rm.menu_id = m.id
            WHERE ur.user_id = $1
          )
        ORDER BY m.sort_order, m.id
      `,
      [req.auth.userId],
    );

    return success(res, buildMenuTree(menuResult.rows));
  } catch (error) {
    return next(error);
  }
});

app.get('/health', (req, res) => success(res, { status: 'ok' }));

app.use((req, res) => failure(res, 404, '接口不存在'));

app.use((error, req, res, next) => {
  console.error(error);
  return failure(res, 500, '服务器内部错误');
});

app.listen(port, () => {
  console.log(`服务已启动：http://localhost:${port}`);
});
