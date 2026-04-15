-- Partial unique index: only one PENDING withdrawal per user at a time.
--
-- WHY: The application checks for an existing PENDING withdrawal before creating
-- a new one (findFirst → $transaction), but those are two separate DB round-trips
-- with an async gap between them. Two concurrent requests can both read "no pending"
-- and both proceed to create one — a TOCTOU race. This index closes that gap at
-- the DB level: the second INSERT is rejected with a unique constraint violation
-- (P2002) before it can create a row or touch the balance.
--
-- The WHERE clause makes it a *partial* index — it only enforces uniqueness while
-- status = 'PENDING'. Once a withdrawal is CONFIRMED or FAILED the slot is free,
-- so a user can make another withdrawal immediately after the previous one settles.
--
-- Postgres-specific syntax. Prisma does not support partial indexes in schema.prisma
-- natively, so this is managed as a raw migration.

CREATE UNIQUE INDEX "withdrawals_one_pending_per_user"
ON "withdrawals" ("userId")
WHERE status = 'PENDING';
