function success(res, data, message = 'ok') {
  return res.json({
    code: 0,
    data,
    message,
  });
}

function failure(res, status, message, code = status) {
  return res.status(status).json({
    code,
    data: null,
    message,
  });
}

module.exports = {
  failure,
  success,
};