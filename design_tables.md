Table: accounts

id: integer, primary key, auto-increment

user_id: text, not null

type: text, not null

currency: text, not null

status: text, not null, default “active”

Note: no balance column (balance will be calculated from ledger_entries).​

Table: transactions

id: integer, primary key, auto-increment

type: text (transfer/deposit/withdrawal), not null

amount: numeric(14,2), not null

currency: text, not null

source_account_id: integer, can be null

destination_account_id: integer, can be null

status: text (pending/completed/failed), default “pending”

description: text, optional

created_at: timestamp, default now.​​

Table: ledger_entries

id: integer, primary key, auto-increment

transaction_id: integer, not null (must match a transaction)

account_id: integer, not null (must match an account)

entry_type: text (debit/credit), not null

amount: numeric(14,2), not null

created_at: timestamp, default now.