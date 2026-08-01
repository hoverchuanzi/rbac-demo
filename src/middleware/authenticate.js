const jwt = require('jsonwebtoken');

const pool = require('../db');
const { failure } = require('../response');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return failure(res, 401, '未提供有效的访问令牌');
  }

  let payload;

  try {
    payload = jwt.verify(match[1], process.env.JWT_SECRET);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return failure(res, 401, '访问令牌已过期');
    }

    return failure(res, 401, '访问令牌无效');
  }

  if (!payload || typeof payload !== 'object' || !payload.userId) {
    return failure(res, 401, '访问令牌无效');
  }

  try {
    const userResult = await pool.query(
      `
        SELECT 1
        FROM users
        WHERE id = $1
          AND is_active = TRUE
      `,
      [payload.userId],
    );

    if (userResult.rowCount === 0) {
      return failure(res, 401, '用户不存在或已被禁用');
    }

    req.auth = {
      userId: payload.userId,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authenticate;