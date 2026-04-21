-- Add FAILED_ROLLBACK to WithdrawalStatus enum
-- This status marks withdrawals where the on-chain transfer failed AND the DB rollback also failed.
-- These rows need manual reconciliation: refund the user balance and mark FAILED.
ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'FAILED_ROLLBACK';
