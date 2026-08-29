# Solana V2.2 Single-Signer Withdrawal — Self-Managed Tenant

Self-managed **tenant** variant of [`single_signer_program_v2_02`](../single_signer_program_v2_02/README.md).
The on-chain flow is identical (SingleSignerCollateral accounts, owner + coordinator signatures,
classic SPL and Token-2022 mints both supported); only the Rain API authorization differs:

| | `single_signer_program_v2_02` | this variant |
|---|---|---|
| Signature endpoint | `GET /v1/issuing/users/{userId}/signatures/withdrawals` | `GET /v1/issuing/tenants/signatures/withdrawals` |
| Contracts endpoint | `GET /v1/issuing/users/{userId}/contracts` | `GET /v1/issuing/tenants/contracts` |
| API key | user-scoped | tenant-scoped |
| `userId` argument | required (first) | none |
| Default `RAIN_API_URL` | `https://api-dev.raincards.xyz` | `https://api.raincards.xyz` (production) |

## Usage

Environment variables (`.env.local`, see the base example's README for details):
`RAIN_API_KEY` (tenant API key), `SOLANA_RPC_URL`, `OWNER_PK`.

```bash
yarn solana:withdraw:v2-02-tenant <token> <amount> <ownerAddress> <recipientAddress> <chainId>

# Example: withdraw $0.01 USDC on mainnet (chainId 900); amount is in cents
yarn solana:withdraw:v2-02-tenant EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1 <ownerAddress> <recipientAddress> 900
```

For everything else (prerequisites, flow, troubleshooting), see the
[`single_signer_program_v2_02` README](../single_signer_program_v2_02/README.md).
