//! Integer calculation parity for the subsequent settlement instructions.
//! This module adds no instruction and does not approve or transfer funds.

#[derive(Debug, PartialEq, Eq)]
pub enum CalculationError {
    InvalidParameters,
    Overflow,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AmountBreakdown {
    pub amount_minor: u64,
    pub tokens_to_redeem: u64,
    pub remainder: u128,
    pub denominator: u128,
}

pub fn coupon(
    balance: u64,
    face: u64,
    rate_bps: u32,
    frequency: u8,
) -> Result<AmountBreakdown, CalculationError> {
    if face == 0 || rate_bps > 100_000 || !matches!(frequency, 1 | 2 | 4) {
        return Err(CalculationError::InvalidParameters);
    }
    let numerator = u128::from(balance)
        .checked_mul(u128::from(face))
        .and_then(|value| value.checked_mul(u128::from(rate_bps)))
        .ok_or(CalculationError::Overflow)?;
    let denominator = 10_000 * u128::from(frequency);
    Ok(AmountBreakdown {
        amount_minor: u64::try_from(numerator / denominator)
            .map_err(|_| CalculationError::Overflow)?,
        tokens_to_redeem: 0,
        remainder: numerator % denominator,
        denominator,
    })
}

pub fn maturity(
    balance: u64,
    face: u64,
    rate_bps: u32,
    frequency: u8,
) -> Result<AmountBreakdown, CalculationError> {
    let mut result = coupon(balance, face, rate_bps, frequency)?;
    let principal = balance
        .checked_mul(face)
        .ok_or(CalculationError::Overflow)?;
    result.amount_minor = result
        .amount_minor
        .checked_add(principal)
        .ok_or(CalculationError::Overflow)?;
    result.tokens_to_redeem = balance;
    Ok(result)
}

pub fn early_redemption(
    balance: u64,
    percentage_bps: u16,
    price: u64,
) -> Result<AmountBreakdown, CalculationError> {
    if percentage_bps == 0 || percentage_bps > 10_000 || price == 0 {
        return Err(CalculationError::InvalidParameters);
    }
    let numerator = u128::from(balance) * u128::from(percentage_bps);
    let tokens = u64::try_from(numerator / 10_000).map_err(|_| CalculationError::Overflow)?;
    Ok(AmountBreakdown {
        amount_minor: tokens
            .checked_mul(price)
            .ok_or(CalculationError::Overflow)?,
        tokens_to_redeem: tokens,
        remainder: numerator % 10_000,
        denominator: 10_000,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_shared_typescript_vectors() {
        for line in include_str!("../../../test/fixtures/financial-parity.tsv")
            .lines()
            .skip(1)
        {
            let fields: Vec<_> = line.split('\t').collect();
            let balance = fields[1].parse().unwrap();
            let result = match fields[0] {
                "COUPON_PAYMENT" => coupon(
                    balance,
                    fields[2].parse().unwrap(),
                    fields[3].parse().unwrap(),
                    fields[4].parse().unwrap(),
                ),
                "BOND_REDEMPTION" => maturity(
                    balance,
                    fields[2].parse().unwrap(),
                    fields[3].parse().unwrap(),
                    fields[4].parse().unwrap(),
                ),
                "EARLY_REDEMPTION" => early_redemption(
                    balance,
                    fields[5].parse().unwrap(),
                    fields[6].parse().unwrap(),
                ),
                _ => panic!("Unknown vector type"),
            };
            if fields[7] == "ERROR" {
                assert!(result.is_err(), "{line}");
            } else {
                assert_eq!(
                    result.unwrap(),
                    AmountBreakdown {
                        amount_minor: fields[7].parse().unwrap(),
                        tokens_to_redeem: fields[8].parse().unwrap(),
                        remainder: fields[9].parse().unwrap(),
                        denominator: fields[10].parse().unwrap(),
                    },
                    "{line}"
                );
            }
        }
    }
}
