# Security Gates

Security checks run before an artifact can be published.

## Committed-secret scan

`node scripts/harness/secret-scan.mjs` scans Git-tracked and nonignored prospective text files. It never reads ignored `.env` files, withholds matched values, and fails on private-key material, credential-shaped tokens, populated secret assignments, or connection strings containing credentials.

## Dependency audit

Add the ecosystem's production dependency audit to `./init.sh` or the release gate and fail for the project's declared severity threshold. A temporary exception must name the advisory, affected package and reachability, compensating control, owner, and expiry date in a reviewed change; lowering the threshold or using `continue-on-error` is not an exception mechanism.

## Deployment protection

If deployment is configured, use a protected environment with designated reviewers. Deployment must consume verification, publish an immutable revision, record the previous artifact reference, check health, and provide rollback evidence. The complete scaffold does not create an active deployment because provider commands and credentials are project-specific.
