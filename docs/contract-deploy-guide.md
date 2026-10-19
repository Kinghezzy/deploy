# Contract Deploy Guide

This guide walks through deploying the Soroban contracts and wiring up the backend.

## Prerequisites

- Rust toolchain with the `wasm32-unknown-unknown` target
- Stellar CLI (`stellar`)
- A funded deployer account on the target network
- Backend environment configured (see `.env.example`)

## 1. Build the contracts

```bash
cargo build --target wasm32-unknown-unknown --release
```

Artifacts are written to `target/wasm32-unknown-unknown/release/*.wasm`.

## 2. Deploy

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/<contract>.wasm \
  --source <deployer-secret-key> \
  --network <network>
```

Record the returned contract ID and the deployer public key.

## 3. Initialize

```bash
stellar contract invoke \
  --id <contract-id> \
  --source <admin-secret-key> \
  --network <network> \
  -- initialize --admin <admin-public-key>
```

The account passed as `--admin` becomes the contract admin and is the only
account allowed to perform privileged operations (e.g. setting the backend
signer, pausing, upgrading).

## 4. Configure the backend

Set the contract IDs and the backend signing key in the backend environment
(see `.env.example` for the full list of variables).

---

## Key rotation

Privileged keys can be compromised or need periodic rotation. The table below
summarizes the roles and how each is rotated.

| Role | Where it lives | Rotation mechanism |
| --- | --- | --- |
| Contract admin | On-chain admin account | `set_admin` (admin-signed) |
| Deployer | Off-chain keypair used for `stellar contract deploy` | New keypair; no on-chain state to change |
| Backend signer | Backend wallet / signing key | `set_signer` (admin-signed) + backend secret update |

> Always rotate to a **freshly generated** keypair. Never reuse a key that may
> have been exposed.

### Rotating the contract admin

1. Generate a new admin keypair and fund it on the target network.
2. From the **current** admin account, transfer the admin role:

   ```bash
   stellar contract invoke \
     --id <contract-id> \
     --source <current-admin-secret-key> \
     --network <network> \
     -- set_admin --new_admin <new-admin-public-key>
   ```

3. Verify the new admin is active by performing a harmless admin-only call
   (e.g. reading the current signer) signed with the new key.
4. Revoke/retire the old admin key: remove it from any secret store and stop
   using it. If it was compromised, treat all admin-signed history as suspect
   and review recent privileged operations.
5. Update the admin key wherever it is referenced:
   - CI/CD secrets used for admin operations
   - Operator password managers / hardware wallets
   - Any runbooks or docs that name the old key

### Rotating the deployer

The deployer key is only used to submit `stellar contract deploy`. It holds no
on-chain privileges after deployment, so rotation is purely operational:

1. Generate a new deployer keypair and fund it.
2. Update the deployer secret in CI/CD (e.g. the `DEPLOYER_SECRET_KEY` secret)
   and in any local operator environment.
3. Remove the old deployer key from all secret stores.
4. If the old deployer key was compromised, audit deployments made with it and
   confirm the deployed contract IDs and admin are the expected ones.

### Rotating the backend signing key

The backend signs transactions with a wallet key. Rotate it as follows:

1. Generate a new backend signing keypair and fund it.
2. From the **admin** account, point the contract at the new signer:

   ```bash
   stellar contract invoke \
     --id <contract-id> \
     --source <admin-secret-key> \
     --network <network> \
     -- set_signer --signer <new-backend-public-key>
   ```

3. Update the backend secret with the new signing key (see config updates
   below) and redeploy/restart the backend so it picks up the new key.
4. Verify the backend can submit a signed transaction successfully.
5. Remove the old signing key from all secret stores.

### Config and secret updates

After any rotation, update every place the key is referenced:

- **Backend environment** — update the relevant variable in `.env` / the
  deployment environment (see `.env.example` for names such as the backend
  signing key and contract IDs).
- **Kubernetes secrets** — update the secret object and restart the affected
  pods so the new value is loaded:

  ```bash
  kubectl create secret generic <secret-name> \
    --from-literal=<key-var>=<new-value> \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl rollout restart deployment/<backend-deployment>
  ```

- **CI/CD secrets** — update the deployer/admin secrets in the CI provider so
  automated deploys and admin operations use the new keys.
- **Local operator environments** — update `.env` files and password managers;
  delete the old entries.

After updating, confirm no service still references the old key (search secret
stores and CI config for the old public key) and that the backend and admin
operations succeed with the new keys.
