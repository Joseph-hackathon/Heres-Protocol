//! Intent-data parsing helpers shared across instructions.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Infer the asset decimals from an explicit mint, falling back to the intent's `assetSymbol`.
pub fn infer_asset_decimals(intent_json: &serde_json::Value, mint_decimals: Option<u8>) -> u8 {
    if let Some(decimals) = mint_decimals {
        return decimals;
    }

    match intent_json
        .get("assetSymbol")
        .and_then(|symbol| symbol.as_str())
        .unwrap_or("SOL")
    {
        "BTC" | "ETH" => 8,
        "MSOL" => 9,
        _ => 9,
    }
}

/// Parse a decimal amount string into atomic units using the asset decimals.
///
/// Integer/fixed-point only, no `f64` (audit M1). f64 lost lamport precision above ~9M units on
/// 9-decimal assets and `as u64` silently saturated negatives to 0 and huge values to u64::MAX.
/// Fractional digits beyond `decimals` are truncated (matching the prior truncating cast), and
/// any non-digit/sign/exponent input is rejected outright.
pub fn parse_amount_to_units(amount_str: &str, decimals: u8) -> Result<u64> {
    let s = amount_str.trim();
    require!(!s.is_empty(), ErrorCode::InvalidIntentData);

    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    let int_part = if int_part.is_empty() { "0" } else { int_part };

    // Reject signs, exponents, whitespace, anything non-digit.
    require!(
        int_part.bytes().all(|b| b.is_ascii_digit())
            && frac_part.bytes().all(|b| b.is_ascii_digit()),
        ErrorCode::InvalidIntentData
    );

    let scale = 10u64
        .checked_pow(decimals as u32)
        .ok_or(ErrorCode::InvalidIntentData)?;

    let whole: u64 = int_part.parse().map_err(|_| ErrorCode::InvalidIntentData)?;
    let mut units = whole.checked_mul(scale).ok_or(ErrorCode::InvalidIntentData)?;

    // Take only the first `decimals` fractional digits; scale them up to atomic units.
    let frac_digits = frac_part.len().min(decimals as usize);
    if frac_digits > 0 {
        let frac_val: u64 = frac_part[..frac_digits]
            .parse()
            .map_err(|_| ErrorCode::InvalidIntentData)?;
        let frac_scale = 10u64
            .checked_pow(decimals as u32 - frac_digits as u32)
            .ok_or(ErrorCode::InvalidIntentData)?;
        let frac_units = frac_val
            .checked_mul(frac_scale)
            .ok_or(ErrorCode::InvalidIntentData)?;
        units = units.checked_add(frac_units).ok_or(ErrorCode::InvalidIntentData)?;
    }

    Ok(units)
}

/// Compute `total_units * (percent_str / 100)` with integer math (audit M1).
///
/// `percent_str` may be fractional (e.g. "33.33"); up to 6 fractional digits of a percent are
/// honored. u128 intermediates avoid overflow; the result is range-checked back into u64.
pub fn apply_percentage(total_units: u64, percent_str: &str) -> Result<u64> {
    const PCT_DECIMALS: u32 = 6;
    let scaled_pct = parse_amount_to_units(percent_str, PCT_DECIMALS as u8)?; // percent * 10^6
    let denom = 100u128 * 10u128.pow(PCT_DECIMALS);
    let result = (total_units as u128)
        .checked_mul(scaled_pct as u128)
        .and_then(|v| v.checked_div(denom))
        .ok_or(ErrorCode::InvalidIntentData)?;
    u64::try_from(result).map_err(|_| ErrorCode::InvalidIntentData.into())
}

/// Check if the capsule requests private distribution via PER.
pub fn wants_private_distribution(intent_json: &serde_json::Value) -> bool {
    matches!(
        intent_json.get("distributionMode").and_then(|v| v.as_str()),
        Some("private")
    )
}
