//! Read a Pyth Lazer / ephemeral oracle price feed (gated behind the `oracle` feature).

use anchor_lang::prelude::*;
#[cfg(feature = "oracle")]
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

#[cfg(feature = "oracle")]
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct SamplePrice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Pyth Lazer / ephemeral oracle price feed account
    pub price_update: AccountInfo<'info>,
}

/// Read and log SOL/USD (or other) price from Pyth Lazer / ephemeral oracle price feed (for gating or monitoring).
/// Enable feature "oracle" and pass a Pyth Lazer price feed account (e.g. SOL/USD on Magicblock devnet).
pub fn handler(ctx: Context<SamplePrice>) -> Result<()> {
    #[cfg(feature = "oracle")]
    {
        let data_ref = ctx.accounts.price_update.data.borrow();
        let price_update = PriceUpdateV2::try_deserialize_unchecked(&mut data_ref.as_ref())
            .map_err(|_| ErrorCode::InvalidPriceFeed)?;

        let maximum_age_secs: u64 = 60;
        let feed_id: [u8; 32] = ctx.accounts.price_update.key().to_bytes();
        let price = price_update
            .get_price_no_older_than(&Clock::get()?, maximum_age_secs, &feed_id)
            .map_err(|_| ErrorCode::InvalidPriceFeed)?;

        msg!("Price ({} +/- {}) * 10^-{}", price.price, price.conf, price.exponent);
        msg!("Price value: {}", price.price as f64 * 10_f64.powi(-price.exponent));
    }
    #[cfg(not(feature = "oracle"))]
    {
        let _ = ctx;
        msg!("Oracle feature disabled; enable with --features oracle and pass Pyth Lazer price feed account.");
    }
    Ok(())
}
