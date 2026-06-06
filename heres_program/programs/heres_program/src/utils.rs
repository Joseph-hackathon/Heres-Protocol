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

/// Parse an asset amount string into atomic units using the asset decimals.
pub fn parse_amount_to_units(amount_str: &str, decimals: u8) -> Result<u64> {
    let amount: f64 = amount_str
        .parse()
        .map_err(|_| ErrorCode::InvalidIntentData)?;

    let scale = 10u64.pow(decimals as u32) as f64;
    Ok((amount * scale) as u64)
}

/// Check if the capsule requests private distribution via PER.
pub fn wants_private_distribution(intent_json: &serde_json::Value) -> bool {
    matches!(
        intent_json.get("distributionMode").and_then(|v| v.as_str()),
        Some("private")
    )
}
