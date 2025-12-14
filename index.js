const express = require('express');
const pool = require('./db');
const { Pool } = require('pg');
const app = express();
const PORT = 3000;

app.use(express.json());
// Create new account
app.post('/accounts', async (req, res) => {
  try {
    const { userId, type, currency } = req.body;

    // 1. Validate input
    if (!userId || !type || !currency) {
      return res
        .status(400)
        .json({ message: 'userId, type, and currency are required' });
    }

    // 2. Insert into database
    const insertQuery = `
      INSERT INTO accounts (user_id, type, currency)
      VALUES ($1, $2, $3)
      RETURNING id, user_id AS "userId", type, currency, status
    `;

    const result = await pool.query(insertQuery, [userId, type, currency]);

    // 3. Return created row
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating account:', err.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});
// Create transfer between two accounts (double-entry)
app.post('/transfers', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      sourceAccountId,
      destinationAccountId,
      amount,
      currency,
      description,
    } = req.body;

    // 1. Basic validation
    if (
      !sourceAccountId ||
      !destinationAccountId ||
      !amount ||
      !currency
    ) {
      return res
        .status(400)
        .json({ message: 'sourceAccountId, destinationAccountId, amount, and currency are required' });
    }

    const sourceId = parseInt(sourceAccountId, 10);
    const destId = parseInt(destinationAccountId, 10);
    const numericAmount = parseFloat(amount);

    if (
      Number.isNaN(sourceId) ||
      Number.isNaN(destId) ||
      Number.isNaN(numericAmount) ||
      numericAmount <= 0
    ) {
      return res
        .status(400)
        .json({ message: 'Invalid account ids or amount' });
    }

    if (sourceId === destId) {
      return res
        .status(400)
        .json({ message: 'Source and destination accounts must be different' });
    }

    // 2. Start DB transaction
    await client.query('BEGIN');

    // 3. Check both accounts exist
    const accountsResult = await client.query(
      'SELECT id FROM accounts WHERE id = ANY($1::int[])',
      [[sourceId, destId]]
    );

    if (accountsResult.rows.length !== 2) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'One or both accounts not found' });
    }

    // 4. Insert transaction row (status pending)
    const txResult = await client.query(
      `
      INSERT INTO transactions (
        type, amount, currency,
        source_account_id, destination_account_id,
        status, description
      )
      VALUES ('transfer', $1, $2, $3, $4, 'pending', $5)
      RETURNING id
      `,
      [numericAmount, currency, sourceId, destId, description || null]
    );

    const transactionId = txResult.rows[0].id;

    // 5. Insert debit (source) and credit (destination) ledger entries
    const insertLedgerQuery = `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type, amount
      ) VALUES
        ($1, $2, 'debit',  $3),
        ($1, $4, 'credit', $3)
    `;
    await client.query(insertLedgerQuery, [
      transactionId,
      sourceId,
      numericAmount,
      destId,
    ]);

    // 6. Recalculate source account balance
    const balanceResult = await client.query(
      `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN entry_type = 'credit' THEN amount
            WHEN entry_type = 'debit'  THEN -amount
            ELSE 0
          END
        ), 0) AS balance
      FROM ledger_entries
      WHERE account_id = $1
      `,
      [sourceId]
    );

    const newBalance = parseFloat(balanceResult.rows[0].balance);

    if (newBalance < 0) {
      // Insufficient funds: rollback and 422
      await client.query('ROLLBACK');
      return res.status(422).json({ message: 'Insufficient funds' });
    }

    // 7. Mark transaction as completed and commit
    await client.query(
      `UPDATE transactions SET status = 'completed' WHERE id = $1`,
      [transactionId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      transactionId,
      status: 'completed',
      sourceAccountId: sourceId,
      destinationAccountId: destId,
      amount: numericAmount.toFixed(2),
      currency,
    });
  } catch (err) {
    console.error('Error creating transfer:', err.message);
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error during rollback:', rollbackErr.message);
    }
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});
// Deposit into a single account
app.post('/deposits', async (req, res) => {
  const client = await pool.connect();

  try {
    const { accountId, amount, currency, description } = req.body;

    // 1. Validate input
    if (!accountId || !amount || !currency) {
      return res
        .status(400)
        .json({ message: 'accountId, amount, and currency are required' });
    }

    const accId = parseInt(accountId, 10);
    const numericAmount = parseFloat(amount);

    if (Number.isNaN(accId) || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res
        .status(400)
        .json({ message: 'Invalid accountId or amount' });
    }

    // 2. Start DB transaction
    await client.query('BEGIN');

    // 3. Check account exists
    const accountResult = await client.query(
      'SELECT id FROM accounts WHERE id = $1',
      [accId]
    );

    if (accountResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Account not found' });
    }

    // 4. Insert transaction row
    const txResult = await client.query(
      `
      INSERT INTO transactions (
        type, amount, currency,
        source_account_id, destination_account_id,
        status, description
      )
      VALUES ('deposit', $1, $2, NULL, $3, 'pending', $4)
      RETURNING id
      `,
      [numericAmount, currency, accId, description || null]
    );

    const transactionId = txResult.rows[0].id;

    // 5. Insert credit ledger entry
    await client.query(
      `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type, amount
      )
      VALUES ($1, $2, 'credit', $3)
      `,
      [transactionId, accId, numericAmount]
    );

    // 6. Mark transaction as completed and commit
    await client.query(
      `UPDATE transactions SET status = 'completed' WHERE id = $1`,
      [transactionId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      transactionId,
      status: 'completed',
      accountId: accId,
      amount: numericAmount.toFixed(2),
      currency,
    });
  } catch (err) {
    console.error('Error creating deposit:', err.message);
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error during rollback (deposit):', rollbackErr.message);
    }
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});
// Withdraw from a single account
app.post('/withdrawals', async (req, res) => {
  const client = await pool.connect();

  try {
    const { accountId, amount, currency, description } = req.body;

    // 1. Validate input
    if (!accountId || !amount || !currency) {
      return res
        .status(400)
        .json({ message: 'accountId, amount, and currency are required' });
    }

    const accId = parseInt(accountId, 10);
    const numericAmount = parseFloat(amount);

    if (Number.isNaN(accId) || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res
        .status(400)
        .json({ message: 'Invalid accountId or amount' });
    }

    // 2. Start DB transaction
    await client.query('BEGIN');

    // 3. Check account exists
    const accountResult = await client.query(
      'SELECT id FROM accounts WHERE id = $1',
      [accId]
    );

    if (accountResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Account not found' });
    }

    // 4. Insert transaction row
    const txResult = await client.query(
      `
      INSERT INTO transactions (
        type, amount, currency,
        source_account_id, destination_account_id,
        status, description
      )
      VALUES ('withdrawal', $1, $2, $3, NULL, 'pending', $4)
      RETURNING id
      `,
      [numericAmount, currency, accId, description || null]
    );

    const transactionId = txResult.rows[0].id;

    // 5. Insert debit ledger entry
    await client.query(
      `
      INSERT INTO ledger_entries (
        transaction_id, account_id, entry_type, amount
      )
      VALUES ($1, $2, 'debit', $3)
      `,
      [transactionId, accId, numericAmount]
    );

    // 6. Recalculate account balance
    const balanceResult = await client.query(
      `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN entry_type = 'credit' THEN amount
            WHEN entry_type = 'debit'  THEN -amount
            ELSE 0
          END
        ), 0) AS balance
      FROM ledger_entries
      WHERE account_id = $1
      `,
      [accId]
    );

    const newBalance = parseFloat(balanceResult.rows[0].balance);

    if (newBalance < 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({ message: 'Insufficient funds' });
    }

    // 7. Mark transaction as completed and commit
    await client.query(
      `UPDATE transactions SET status = 'completed' WHERE id = $1`,
      [transactionId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      transactionId,
      status: 'completed',
      accountId: accId,
      amount: numericAmount.toFixed(2),
      currency,
    });
  } catch (err) {
    console.error('Error creating withdrawal:', err.message);
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error during rollback (withdrawal):', rollbackErr.message);
    }
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get single account with balance
app.get('/accounts/:id', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);

    if (Number.isNaN(accountId)) {
      return res.status(400).json({ message: 'Invalid account id' });
    }

    // 1. Fetch the account
    const accountResult = await pool.query(
      `SELECT id,
              user_id AS "userId",
              type,
              currency,
              status
       FROM accounts
       WHERE id = $1`,
      [accountId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const account = accountResult.rows[0];

    // 2. Calculate balance from ledger_entries
    const balanceResult = await pool.query(
      `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN entry_type = 'credit' THEN amount
            WHEN entry_type = 'debit'  THEN -amount
            ELSE 0
          END
        ), 0) AS balance
      FROM ledger_entries
      WHERE account_id = $1
      `,
      [accountId]
    );

    const balance = balanceResult.rows[0].balance;

    // 3. Return account with balance
    res.json({
      ...account,
      balance: balance.toString()
    });
  } catch (err) {
    console.error('Error fetching account:', err.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get ledger entries for an account
app.get('/accounts/:id/ledger', async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);

    if (Number.isNaN(accountId)) {
      return res.status(400).json({ message: 'Invalid account id' });
    }

    // 1. Check account exists
    const accountResult = await pool.query(
      `SELECT id FROM accounts WHERE id = $1`,
      [accountId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // 2. Get ledger entries for this account
    const entriesResult = await pool.query(
      `
      SELECT
        id,
        transaction_id AS "transactionId",
        entry_type   AS "entryType",
        amount,
        created_at   AS "createdAt"
      FROM ledger_entries
      WHERE account_id = $1
      ORDER BY created_at ASC, id ASC
      `,
      [accountId]
    );

    res.json({
      accountId,
      entries: entriesResult.rows
    });
  } catch (err) {
    console.error('Error fetching ledger entries:', err.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Simple health check
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', dbTime: result.rows[0].now });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(500).json({ status: 'error', message: 'DB not reachable' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
