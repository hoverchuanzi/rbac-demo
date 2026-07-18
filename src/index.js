const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const port = process.env.PORT || 3000;

// 让 Express 能够读取 JSON 请求体。
// 如果没有这一行，req.body 通常会是 undefined。
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 启动时检查必要配置，避免运行到登录时才发现密钥缺失。
if (!process.env.JWT_SECRET) {
  throw new Error('缺少 JWT_SECRET 环境变量');
}

/**
 * 用户登录
 *
 * 请求体：
 * {
 *   "username": "admin",
 *   "password": "用户输入的密码"
 * }
 */
app.post('/auth/login', async (req, res, next) => {
  try {
    // req.body may be undefined when the request has no body or uses an
    // unsupported Content-Type. Treat it as an empty object so validation can
    // return a useful 400 response instead of throwing a TypeError.
    const { username, password } = req.body ?? {};

    // 第一层输入检查。
    if (
      typeof username !== 'string' ||
      username.trim() === '' ||
      typeof password !== 'string' ||
      password === ''
    ) {
      return res.status(400).json({
        message: '用户名和密码不能为空',
      });
    }

    // 用户名在数据库中按不区分大小写的方式查找。
    // 只允许有效用户登录。
    const userResult = await pool.query(
      `
        SELECT
          id,
          username,
          password_hash,
          real_name,
          avatar,
          email,
          is_active
        FROM users
        WHERE lower(username) = lower($1)
          AND is_active = TRUE
        LIMIT 1
      `,
      [username.trim()],
    );

    // 无论是用户不存在、被禁用，还是密码错误，
    // 都返回相同提示，避免向外泄露用户是否存在。
    if (userResult.rowCount === 0) {
      return res.status(401).json({
        message: '用户名或密码错误',
      });
    }

    const user = userResult.rows[0];

    // bcrypt.compare 会读取哈希中的盐值和计算成本，
    // 然后判断明文密码是否匹配。
    const passwordMatched = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatched) {
      return res.status(401).json({
        message: '用户名或密码错误',
      });
    }

    // 查询用户当前拥有的有效角色。
    const roleResult = await pool.query(
      `
        SELECT DISTINCT r.code
        FROM user_roles ur
        JOIN roles r
          ON r.id = ur.role_id
         AND r.is_active = TRUE
        WHERE ur.user_id = $1
        ORDER BY r.code
      `,
      [user.id],
    );

    const roles = roleResult.rows.map((role) => role.code);

    // JWT 只保存稳定的用户 ID。
    // 不把密码、密码哈希或完整权限列表放进 Token。
    const accessToken = jwt.sign(
      {
        userId: user.id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '2h',
      },
    );

    // 登录成功后记录最后登录时间。
    await pool.query(
      `
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [user.id],
    );

    // 返回前端需要的数据。
    // 注意：绝对不能返回 password_hash。
    return res.json({
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        realName: user.real_name,
        avatar: user.avatar,
        email: user.email,
        roles,
      },
    });
  } catch (error) {
    next(error);
  }
});

// 临时健康检查接口。
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
  });
});

// 404 处理。
// 必须放在所有正常路由之后。
app.use((req, res) => {
  res.status(404).json({
    message: '接口不存在',
  });
});

// 统一错误处理。
// Express 的错误处理中间件必须有四个参数。
app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    message: '服务器内部错误',
  });
});

app.listen(port, () => {
  console.log(`服务已启动：http://localhost:${port}`);
});
