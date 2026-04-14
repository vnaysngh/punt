-- Security constraints: enforce data integrity at the database level
-- These are defense-in-depth — app logic already validates, but DB is the last line

-- Users: balance can never go negative
ALTER TABLE "users"
  ADD CONSTRAINT "users_appBalance_non_negative"
  CHECK ("appBalance" >= 0);

-- Bets: amount must be positive, direction must be UP or DOWN
ALTER TABLE "bets"
  ADD CONSTRAINT "bets_amount_positive"
  CHECK (amount > 0);

ALTER TABLE "bets"
  ADD CONSTRAINT "bets_direction_valid"
  CHECK (direction IN ('UP', 'DOWN'));

-- Bets: payout can never be negative (0 for losers, positive for winners)
ALTER TABLE "bets"
  ADD CONSTRAINT "bets_payout_non_negative"
  CHECK (payout IS NULL OR payout >= 0);

-- Deposits: amount must be positive
ALTER TABLE "deposits"
  ADD CONSTRAINT "deposits_amount_positive"
  CHECK (amount > 0);

-- Withdrawals: amount must be positive
ALTER TABLE "withdrawals"
  ADD CONSTRAINT "withdrawals_amount_positive"
  CHECK (amount > 0);

-- Markets: totalUp and totalDown can never go negative
ALTER TABLE "markets"
  ADD CONSTRAINT "markets_totalUp_non_negative"
  CHECK ("totalUp" >= 0);

ALTER TABLE "markets"
  ADD CONSTRAINT "markets_totalDown_non_negative"
  CHECK ("totalDown" >= 0);

-- Markets: startPrice must be positive
ALTER TABLE "markets"
  ADD CONSTRAINT "markets_startPrice_positive"
  CHECK ("startPrice" > 0);

-- Markets: direction must be valid when set
ALTER TABLE "markets"
  ADD CONSTRAINT "markets_direction_valid"
  CHECK (direction IS NULL OR direction IN ('UP', 'DOWN', 'DRAW'));
