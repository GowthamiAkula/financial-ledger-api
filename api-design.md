Here is the exact content you can paste into **`api-design.md`**:

```md
# POST /accounts Endpoint

## Description
POST /accounts creates a new account.

## JSON Request Example
```
{
  "userId": "u123",
  "type": "checking",
  "currency": "INR"
}
```

## Internal Steps (Server Logic)

1. Read `userId`, `type`, and `currency` from the request body.
2. Check that all three fields are present; if any is missing, return HTTP 400 with an error message.
3. Build an SQL INSERT statement that writes a new row into the `accounts` table using these values.
4. Execute the INSERT using the shared PostgreSQL connection pool.
5. Return the inserted row (including its new id and status) as JSON with HTTP status 201.

## Field Mapping Between JSON and Database

| JSON field | Database column | Example value |
|-----------|-----------------|---------------|
| `userId`  | `user_id`       | `"u123"`      |
| `type`    | `type`          | `"checking"`  |
| `currency`| `currency`      | `"INR"`       |
| *(none)*  | `status`        | `"active"` (default) |
```

After you paste and save this file in VS Code, tell “done”, and the next step will be adding the real Express code for `POST /accounts` in `index.js`.
## GET /accounts/:id

### Description
Returns a single account by id, including its current balance.

### Internal Steps
1. Read `id` from the URL path (`req.params.id`).
2. Query the `accounts` table for this id; if not found, return HTTP 404.
3. Query the `ledger_entries` table for all rows with this `account_id`.
4. Compute balance as (sum of credits) minus (sum of debits); if there are no rows, balance is 0.
5. Return account data plus the calculated balance in a JSON object.

### Balance formula
balance = (sum of amounts where entry_type = 'credit')
        − (sum of amounts where entry_type = 'debit')

Designing the transfer endpoint is about deciding what it must do step-by-step before writing any code.

1. What the client will send
For a transfer, the API call should look like:

URL: POST /transfers

JSON body:

json
{
  "sourceAccountId": 1,
  "destinationAccountId": 2,
  "amount": "100.00",
  "currency": "INR",
  "description": "Test transfer"
}
So the server must read: sourceAccountId, destinationAccountId, amount, currency, description.​

2. Business rules for double-entry + safety
For each transfer:

Create a transaction record with type "transfer", status initially "pending".​

Create two ledger entries:

Debit entry on the source account for the full amount.

Credit entry on the destination account for the same amount.

The sum of both entries’ amounts must balance: debit total = credit total.​

After considering this transfer, the source account must not go negative; otherwise the transfer is rejected and rolled back.​

3. Database transaction (ACID) plan
Everything for one transfer must happen in one PostgreSQL transaction:

BEGIN a transaction.​

Insert into transactions (type, amount, currency, source, destination, status = pending, description).

Insert debit ledger_entries row for source account.

Insert credit ledger_entries row for destination account.

Recalculate the source account’s balance using all its ledger entries (old ones + this new debit).

If the balance < 0:

ROLLBACK the transaction.

Return HTTP 422 Unprocessable Entity with message like "Insufficient funds".​

If balance ≥ 0:

Update the transaction status to "completed".

COMMIT the transaction.​

If any error occurs at any step, everything must be rolled back so partial entries are not left in the database.​

4. Response shape
On success, the endpoint should return something like:

json
{
  "transactionId": 5,
  "status": "completed",
  "sourceAccountId": 1,
  "destinationAccountId": 2,
  "amount": "100.00",
  "currency": "INR"
}
On failure due to insufficient funds, status code 422 and JSON like:

json
{ "message": "Insufficient funds" }
On bad input (missing fields, same source and destination, non-positive amount) use status 400.​

5. Your mini-task for the design
In api-design.md, add a new section:

text
## POST /transfers

### Description
Creates a money transfer between two accounts using double-entry bookkeeping (one debit and one credit) inside a single database transaction.

### Request JSON
{
  "sourceAccountId": 1,
  "destinationAccountId": 2,
  "amount": "100.00",
  "currency": "INR",
  "description": "Test transfer"
}

### Internal Steps
1. Validate input: all fields present, source and destination are different, amount > 0.
2. Start a database transaction.
3. Insert a row into `transactions` with type = 'transfer', status = 'pending'.
4. Insert a debit ledger entry for the source account and a credit ledger entry for the destination account for the same amount.
5. Recalculate the source account balance; if it would be negative, roll back the transaction and return HTTP 422.
6. If balance is ok, update the transaction status to 'completed' and commit the transaction.
7. Return the transaction details in the response.

### Error rules
- 400 for invalid input.
- 404 if any account does not exist.
- 422 if there are insufficient funds in the source account.
- 500 for unexpected server/database errors.
Save the file, then tell “transfer design done”.
After that, the next message will give the exact Express + node-postgres code for POST /transfers plus testing steps.

## POST /deposits

### Description
Adds money into a single account by creating a deposit transaction and a credit ledger entry inside one database transaction.

### Request JSON
{
  "accountId": 1,
  "amount": "200.00",
  "currency": "INR",
  "description": "Initial deposit"
}

### Internal Steps
1. Validate input: accountId, amount, and currency are present and amount > 0.
2. Check that the account exists; if not, return 404.
3. Start a database transaction.
4. Insert a row into `transactions` with type = 'deposit', status = 'pending'.
5. Insert a credit ledger entry for the account for the deposit amount.
6. Update the transaction status to 'completed' and commit the transaction.
7. Return the transaction details in the response.

### Error rules
- 400 for invalid input.
- 404 if the account does not exist.
- 500 for unexpected server/database errors.
## POST /withdrawals

### Description
Removes money from a single account by creating a withdrawal transaction and a debit ledger entry inside one database transaction. The withdrawal is only allowed if the account will not go negative.

### Request JSON
{
  "accountId": 1,
  "amount": "50.00",
  "currency": "INR",
  "description": "ATM cash"
}

### Internal Steps
1. Validate input: accountId, amount, and currency are present and amount > 0.
2. Check that the account exists; if not, return 404.
3. Start a database transaction.
4. Insert a row into `transactions` with type = 'withdrawal', status = 'pending'.
5. Insert a debit ledger entry for the account for the withdrawal amount.
6. Recalculate the account balance; if it would be negative, roll back the transaction and return HTTP 422.
7. If balance is ok, update the transaction status to 'completed' and commit the transaction.
8. Return the transaction details in the response.

### Error rules
- 400 for invalid input.
- 404 if the account does not exist.
- 422 if there are insufficient funds in the account.
- 500 for unexpected server/database errors.
