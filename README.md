```md
# Financial Ledger API (Node.js + PostgreSQL)

This project is a backend REST API for a mock banking system. It manages accounts, deposits, withdrawals, and transfers using a double–entry ledger stored in PostgreSQL. The design ensures every money movement is tracked with balanced debit/credit entries and that account balances never go negative.

## 1. Project Overview

The API:

- Implements a simple financial ledger suitable for a small banking or wallet system.
- Uses three core tables:
  - `accounts` – represents user bank accounts.
  - `transactions` – represents high‑level business operations.
  - `ledger_entries` – immutable debit/credit entries linked to transactions.
- Supports:
  - Creating accounts for different users and account types.
  - Depositing money into a single account.
  - Withdrawing money from a single account with insufficient‑funds protection.
  - Transferring money between two accounts using double‑entry bookkeeping.
- Runs all money operations inside explicit database transactions to provide ACID guarantees.

## 2. Project Structure

The repository is organized as follows:

- `index.js`  
  Main Express application. Defines all HTTP routes, request validation, and error handling. Wraps each money operation in a PostgreSQL transaction.

- `db.js`  
  Database configuration using `pg` (node‑postgres). Creates and exports a connection pool based on environment variables.

- `api-design.md`  
  Design document for the REST API: endpoints, request/response shapes, and business rules.

- `design_tables.md`  
  Notes for the database schema: table definitions, columns, and constraints.

- `README.md`  
  This document. Explains how to set up, run, and understand the project.

- `Untitled Diagram.drawio.png`  
  Entity Relationship Diagram (ERD) showing `accounts`, `transactions`, and `ledger_entries` tables and their foreign‑key relationships.

- `Untitled Diagram2.drawio.png`  
  High‑level architecture diagram showing how the client, Node.js API, and PostgreSQL (Docker) interact.

- `postman/Financial-Ledger-API.postman_collection.json`  
  Postman collection with ready‑made requests to test all endpoints.

- `package.json`, `package-lock.json`  
  Node.js dependencies and npm scripts.

## 3. Tech Stack

- Node.js  
- Express (REST API framework)  
- PostgreSQL (relational database)  
- Docker (for running PostgreSQL locally)  
- `pg` (node‑postgres) for database access  
- `dotenv` for reading environment variables  

## 4. Setup and Running Locally

### 4.1 Prerequisites

- Node.js and npm installed.
- Docker Desktop installed and running.

### 4.2 Clone and install dependencies

```
git clone https://github.com/GowthamiAkula/financial-ledger-api.git
cd financial-ledger-api
npm install
```

### 4.3 Start PostgreSQL in Docker

```
docker run --name ledger-postgres \
  -e POSTGRES_USER=ledger_user \
  -e POSTGRES_PASSWORD=ledger_password \
  -e POSTGRES_DB=ledger_db \
  -p 5432:5432 \
  -d postgres
```

This starts a PostgreSQL instance on port 5432 with database `ledger_db`.

### 4.4 Configure environment variables

Create a file named `.env` in the project root:

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=ledger_user
DB_PASSWORD=ledger_password
DB_NAME=ledger_db
```

### 4.5 Create the database tables

Connect to the running container:

```
docker exec -it ledger-postgres psql -U ledger_user -d ledger_db
```

Create the three tables using the SQL from `design_tables.md`:

- `accounts`
- `transactions`
- `ledger_entries`

Exit `psql` with:

```
\q
```

### 4.6 Run the API server

```
npm run dev
```

The API will listen on:

```
http://localhost:3000
```

## 5. Domain and Data Model

### 5.1 Accounts table

- Represents a single bank account.
- Main columns:
  - `id` – primary key.
  - `user_id` – logical user identifier.
  - `type` – account type (for example `checking` or `savings`).
  - `currency` – currency code (for example `INR`).
  - `status` – account status (for example `active`).
- The `accounts` table does **not** store a balance column.
- Balance is always computed from related ledger entries for that account.

### 5.2 Transactions table

- Represents one logical business operation:
  - `deposit`
  - `withdrawal`
  - `transfer`
- Main columns:
  - `id` – primary key.
  - `type` – operation type.
  - `amount` – transaction amount.
  - `currency` – transaction currency.
  - `source_account_id` – source account (nullable for deposit).
  - `destination_account_id` – destination account (nullable for withdrawal).
  - `status` – `pending`, `completed`, or `failed`.
  - `description` – free‑text description.
  - `created_at` – timestamp.
- Acts as the parent record for all ledger entries belonging to that operation.

### 5.3 Ledger entries table

- Implements double‑entry bookkeeping.
- Each row is immutable and represents either:
  - a **debit** (money leaving an account), or
  - a **credit** (money entering an account).
- Main columns:
  - `id` – primary key.
  - `transaction_id` – foreign key to `transactions.id`.
  - `account_id` – foreign key to `accounts.id`.
  - `entry_type` – `debit` or `credit`.
  - `amount` – positive numeric amount.
  - `created_at` – timestamp.
- Balance for a given account is computed as total credits minus total debits.

## 6. API Endpoints

Base URL: `http://localhost:3000`

### 6.1 Health

- `GET /health`  
  Returns API status and a simple database connectivity check.

### 6.2 Accounts

- `POST /accounts`  
  Creates a new account.  
  Example JSON body:

  ```
  {
    "userId": "user1",
    "type": "checking",
    "currency": "INR"
  }
  ```

- `GET /accounts/:id`  
  Returns account details including the calculated balance from ledger entries.

- `GET /accounts/:id/ledger`  
  Returns all ledger entries for the account, ordered by creation time.

### 6.3 Deposits

- `POST /deposits`  
  Creates a `deposit` transaction and a **credit** ledger entry for one account.  
  Example JSON body:

  ```
  {
    "accountId": 1,
    "amount": "200.00",
    "currency": "INR",
    "description": "initial deposit"
  }
  ```

### 6.4 Withdrawals

- `POST /withdrawals`  
  Creates a `withdrawal` transaction and a **debit** ledger entry.  
- After inserting the debit entry, the service recomputes the account balance.
- If the balance would become negative:
  - The whole database transaction is rolled back.
  - The API returns HTTP status `422` with an error message.

### 6.5 Transfers

- `POST /transfers`  
  Moves money between two accounts in a single ACID transaction.  
- Example JSON body:

  ```
  {
    "sourceAccountId": 1,
    "destinationAccountId": 2,
    "amount": "50.00",
    "currency": "INR",
    "description": "test transfer"
  }
  ```

- Steps inside one database transaction:
  - Insert a `transfer` row into `transactions` with status `pending`.
  - Insert one **debit** ledger entry for the source account.
  - Insert one **credit** ledger entry for the destination account.
  - Recalculate the source account balance.
  - If the source would go negative, roll back and return HTTP `422`.
  - Otherwise, mark the transaction as `completed` and commit.

## 7. Business Rules and Error Handling

### 7.1 Core business rules

- All transfers follow double‑entry bookkeeping:
  - exactly one debit and one credit for the same amount.
- Withdrawals and transfers are blocked if they would make the source account negative.
- Ledger entries are append‑only:
  - no `UPDATE` or `DELETE` operations are used on the `ledger_entries` table.
  - this creates an auditable history of all money movements.

### 7.2 Error behaviour

- Standard HTTP status codes are used:
  - `400` – invalid input (missing fields, bad types, non‑positive amounts).
  - `404` – account not found.
  - `422` – business rule violation (for example insufficient funds).
  - `500` – unexpected server or database error.
- Error responses contain a JSON message describing the problem.

## 8. Transactions, ACID, and Isolation

- Each money‑related endpoint (`/deposits`, `/withdrawals`, `/transfers`) opens a PostgreSQL transaction using:
  - `BEGIN`
  - multiple SQL statements
  - `COMMIT` or `ROLLBACK`
- ACID properties:
  - **Atomicity** – all changes for one request either fully succeed or are completely undone.
  - **Consistency** – foreign keys and validation checks guarantee that only valid account and ledger states are stored.
  - **Isolation** – relies on PostgreSQL’s default `READ COMMITTED` level so that no request sees uncommitted data from another.
  - **Durability** – once a transaction is committed, PostgreSQL persists it to disk.

## 9. Testing with Postman

The repository includes a ready‑to‑use Postman collection:

- `postman/Financial-Ledger-API.postman_collection.json`

### 9.1 Importing the collection

- Open Postman.
- Click **Import** and select the JSON file from the `postman` folder.
- A collection named **Financial Ledger API** appears with pre‑configured requests.

### 9.2 Recommended test flow

1. Call `GET /health` to confirm the API and database are running.  
2. Create two accounts using the `POST /accounts` requests.  
3. Deposit money into account `1` using `POST /deposits`.  
4. Perform a successful withdrawal from account `1`.  
5. Try a large withdrawal from account `1` and verify that it fails with HTTP `422`.  
6. Perform a transfer from account `1` to account `2` and verify that balances and ledgers are updated correctly.  
7. Fetch final account details and ledgers using `GET /accounts/:id` and `GET /accounts/:id/ledger`.
```