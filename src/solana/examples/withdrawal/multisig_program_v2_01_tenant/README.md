# Solana V2 Signature Withdrawal — Self-Managed Tenant

Self-managed **tenant** variant of [`multisig_program_v2_01`](../multisig_program_v2_01/README.md).
The on-chain flow is identical (V2 collateral accounts, admin + coordinator signatures,
classic SPL and Token-2022 mints both supported); only the Rain API authorization differs:

| | `multisig_program_v2_01` | this variant |
|---|---|---|
| Signature endpoint | `GET /v1/issuing/users/{userId}/signatures/withdrawals` | `GET /v1/issuing/tenants/signatures/withdrawals` |
| Contracts endpoint | `GET /v1/issuing/users/{userId}/contracts` | `GET /v1/issuing/tenants/contracts` |
| API key | user-scoped | tenant-scoped |
| `userId` argument | required (first) | none |
| Default `RAIN_API_URL` | `https://api-dev.raincards.xyz` | `https://api.raincards.xyz` (production) |

## Usage

Environment variables (`.env.local`, see the base example's README for details):
`RAIN_API_KEY` (tenant API key), `SOLANA_RPC_URL`, `COLLATERAL_ADMIN_PK`.

```bash
yarn solana:withdraw:v2-01-tenant <token> <amount> <adminAddress> <recipientAddress> <chainId>

# Example: withdraw $0.01 USDC on mainnet (chainId 900); amount is in cents
yarn solana:withdraw:v2-01-tenant EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1 <adminAddress> <recipientAddress> 900
```

For everything else (prerequisites, flow, troubleshooting), see the
[`multisig_program_v2_01` README](../multisig_program_v2_01/README.md).
