const express = require('express');
const pool = require('./db');

const app = express();
const port = 3000;

app.get('/users', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT name, age, score FROM student ORDER BY age ASC',
    );
    console.log(result.rows);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.listen(port, () => {
  console.log(`http://localhost:${port}`);
});
