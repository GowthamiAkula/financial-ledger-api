Here is a ready-to-edit **README.md** template tailored to your project. You can copy–paste this into `README.md` and then adjust wording if you like. 

***

```md
# Financial Ledger API with Double-Entry Bookkeeping

## Overview

This project is a backend REST API for a mock banking system that implements **double-entry bookkeeping** on top of a relational database. It tracks accounts, deposits, withdrawals, and transfers, ensuring that every movement of money is represented by balanced debit and credit ledger entries and that account balances never go negative. [web:90][web:91]

The API is built with **Node.js + Express** and uses **PostgreSQL** running in a Docker container for strong ACID guarantees and data integrity. [web:16][web:74][web:94]

---

## Tech Stack

- Node.js & Express (REST API)
- PostgreSQL (relational database)
- Docker (database container)
- node-postgres (`pg`) for database access
- dotenv for configuration [web:16][web:80][web:85]

---

## Setup and Running Locally

### Prerequisites

- Node.js and npm installed.
- Docker Desktop installed and running. [web:31][web:34]

### 1. Clone and install dependencies

```
git clone <your-repo-url>
cd financial-ledger-api
npm install
```

### 2. Start PostgreSQL in Docker

```
docker run --name ledger-postgres \
  -e POSTGRES_USER=ledger_user \
  -e POSTGRES_PASSWORD=ledger_password \
  -e POSTGRES_DB=ledger_db \
  -p 5432:5432 \
  -d postgres
```

This starts a local PostgreSQL instance on port 5432 with a dedicated database for the ledger. [web:74][web:75]

### 3. Environment variables

Create a `.env` file in the project root:

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=ledger_user
DB_PASSWORD=ledger_password
DB_NAME=ledger_db
```

The API reads these variables using `dotenv` and uses them to configure the PostgreSQL connection pool. [web:80][web:85]

### 4. Run database migrations (tables)

Connect to the database inside the container:

```
docker exec -it ledger-postgres psql -U ledger_user -d ledger_db
```

Create the tables:

```
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  source_account_id INTEGER,
  destination_account_id INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_source_account
    FOREIGN KEY (source_account_id) REFERENCES accounts(id),
  CONSTRAINT fk_destination_account
    FOREIGN KEY (destination_account_id) REFERENCES accounts(id)
);

CREATE TABLE ledger_entries (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  entry_type VARCHAR(10) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_transaction
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_account
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);
```

Exit with `\q`. These tables implement accounts, the transaction log, and immutable ledger entries. [web:75][web:81]

### 5. Start the API

```
npm run dev
```

The server will start on `http://localhost:3000`. [web:16]

---

## Data Model

### Accounts

- One row per logical bank account.
- Fields: `id`, `user_id`, `type` (checking/savings), `currency`, `status` (active/frozen).
- **No balance column**; balance is always calculated from ledger entries for strong consistency. [web:75]

### Transactions

- One row per business operation (deposit, withdrawal, transfer).  
- Fields: `id`, `type`, `amount`, `currency`, `source_account_id`, `destination_account_id`, `status`, `description`, `created_at`.  
- Used as the parent for ledger entries and to track business status (`pending`, `completed`, `failed`). [web:75][web:91]

### Ledger Entries

- Immutable, append-only rows that implement double-entry bookkeeping.  
- Fields: `id`, `transaction_id`, `account_id`, `entry_type` (`debit` or `credit`), `amount`, `created_at`.  
- Every transfer creates exactly two entries: one debit and one credit for the same amount. [web:90][web:93]

**Balance calculation**:  
For a given account, balance is computed as:

- credits minus debits over all its ledger entries:

\[
\text{balance} = \sum(\text{credits}) - \sum(\text{debits})
\]

This is implemented in SQL using a `CASE` expression over `entry_type`. [web:75][web:90]

---

## API Endpoints

Base URL: `http://localhost:3000`

### Health

- `GET /health`  
  - Returns API status and a simple DB connectivity check.

### Accounts

- `POST /accounts`  
  - Body: `{ "userId": "user1", "type": "checking", "currency": "INR" }`  
  - Creates a new account (status defaults to `active`). [web:55]

- `GET /accounts/:id`  
  - Returns account details plus calculated `balance` from ledger entries. [web:75]

- `GET /accounts/:id/ledger`  
  - Returns all ledger entries for the account ordered by time.

### Deposits

- `POST /deposits`  
  - Body: `{ "accountId": 1, "amount": "200.00", "currency": "INR", "description": "initial deposit" }`  
  - Creates a `deposit` transaction and a **credit** ledger entry for the account. [web:90][web:96]  
  - Response: transaction details with status `completed`.

### Withdrawals

- `POST /withdrawals`  
  - Body: `{ "accountId": 1, "amount": "50.00", "currency": "INR", "description": "ATM cash" }`  
  - Creates a `withdrawal` transaction and a **debit** ledger entry.  
  - Recalculates balance; if it would go negative, transaction is rolled back and the API returns HTTP 422 with `"Insufficient funds"`. [web:111][web:122]

### Transfers

- `POST /transfers`  
  - Body:  
    `{ "sourceAccountId": 1, "destinationAccountId": 2, "amount": "50.00", "currency": "INR", "description": "test transfer" }`  
  - Inside a single database transaction:  
    - Inserts a `transfer` transaction (status `pending`).  
    - Inserts one **debit** ledger entry for the source and one **credit** ledger entry for the destination with the same amount.  
    - Recalculates the source balance; if it would be negative, rolls back and returns HTTP 422.  
    - Otherwise updates transaction status to `completed` and commits. [web:90][web:94][web:100]

---

## Business Rules and Error Handling

- **Double-entry bookkeeping**: every transfer produces exactly two ledger entries (debit + credit) so debits and credits always balance. [web:90][web:93]  
- **No negative balances**: withdrawals and transfers that would make the source account negative are rejected with HTTP 422. [web:111][web:122]  
- **Immutability**: `ledger_entries` are never updated or deleted; only new entries are appended, providing an audit trail. [web:90]  
- **Error status codes**:  
  - 400 – invalid input (missing fields, non-positive amounts). [web:104]  
  - 404 – account not found.  
  - 422 – business rule violation (insufficient funds). [web:111]  
  - 500 – unexpected server or database error.

---

## ACID Properties and Isolation

All money-moving endpoints (`/deposits`, `/withdrawals`, `/transfers`) wrap their operations in **explicit PostgreSQL transactions** using `BEGIN`, multiple SQL statements, and `COMMIT` or `ROLLBACK` via `node-postgres`. [web:94][web:100][web:125]

- **Atomicity**: each endpoint executes as a single transaction; partial inserts are rolled back on error. [web:94][web:122]  
- **Consistency**: foreign keys and balance checks (no negative balances) ensure that only valid states are committed. [web:122][web:127]  
- **Isolation**: the system relies on PostgreSQL’s default `READ COMMITTED` isolation level to prevent dirty reads; concurrent operations do not see uncommitted data. [web:94][web:125]  
- **Durability**: once a transaction commits, PostgreSQL guarantees that data is stored durably. [web:94][web:122]

---

## ERD and Architecture (for submission)

- **ERD**:  
  - Show `accounts`, `transactions`, `ledger_entries`.  
  - Primary keys and foreign keys as described in the Data Model section. [web:75]  

- **Architecture diagram**:  
  - Client (Postman/Frontend) → Express API (Node.js) → PostgreSQL (Docker container).  
  - Highlight that money-moving endpoints use DB transactions for ACID behavior. [web:16][web:94]
The ERD for this project is available at `docs/erd.png`.
The high-level architecture diagram is available at `docs/architecture.png`.


---

## Testing and Postman Collection

A Postman collection can be used to demonstrate the flow:

1. Create two accounts.  
2. Deposit into account 1.  
3. Withdraw from account 1 (success and insufficient funds case).  
4. Transfer from account 1 to account 2 (insufficient funds, then successful).  
5. Fetch accounts and their ledgers to verify balances and entries. [conversation_history:1]

Export this collection (v2.1) and include it with your submission.

```