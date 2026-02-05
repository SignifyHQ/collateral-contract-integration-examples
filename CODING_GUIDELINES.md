# Coding Guidelines

## @rain/program Imports

### How It Works

The project uses TypeScript path aliases to import the Solana collateral program and its versions. Imports resolve via `tsconfig.json` paths and are rewritten at build time.

**Path aliases (in `tsconfig.json`):**

| Alias | Resolves to | Exports |
|-------|-------------|---------|
| `@rain/program` | `./src/solana/program` | All program versions + `Ed25519ExtendedProgram` |
| `@rain/v2_00` | `./src/solana/program/v2_00` | `IdlV2_00`, `MainV2_00` |
| `@rain/v2_01` | `./src/solana/program/v2_01` | `IdlV2_01`, `MainV2_01` |
| `@rain/v2_02` | `./src/solana/program/v2_02` | `IdlV2_02`, `MainV2_02` |

### Usage

```typescript
// Import all needed exports from the main program (recommended)
import { Ed25519ExtendedProgram, IdlV2_02, MainV2_02 } from "@rain/program";

// Or import version-specific only (Ed25519ExtendedProgram must come from @rain/program)
import { Ed25519ExtendedProgram } from "@rain/program";
import { IdlV2_02, MainV2_02 } from "@rain/v2_02";
```

### Build & Runtime

- **TypeScript / IDE**: Paths are resolved by `tsconfig.json` `paths` and `baseUrl`.
- **ts-node**: Uses `tsconfig-paths/register` (configured in `package.json` under `ts-node.require`).
- **Compiled output**: `tsc-alias` rewrites path aliases to relative paths in `dist/` after `tsc`.

---

## Program Version Comparison

The collateral contract program has three IDL versions. Each defines the program interface (instructions, accounts, types). Use the version that matches the deployed program your integration targets.

### v2.00

| Aspect | Details |
|--------|---------|
| **Collateral types** | Multisig |

### v2.01

| Aspect | Details |
|--------|---------|
| **Collateral types** | Multisig |
| **New features** | Adds `rent_receiver` field and reduces the size of the collateral account |
> **Note:** If you are currently using **v2.00**, you **must migrate to v2.01** before using `withdraw_collateral_asset`. The interface for this instruction was changed in v2.01 and is **not backward compatible** with v2.00.


### v2.02

| Aspect | Details |
|--------|---------|
| **Collateral types** | Multisig + SingleSigner |
| **New features** | Adds support for `single signer` collateral accounts |

