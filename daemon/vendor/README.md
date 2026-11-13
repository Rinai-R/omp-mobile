`dsh-remote-host.mjs` is the Host side of ds-harness-remote's relay (device pairing, the
relay control connection and its Noise IK channel), bundled from
[liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote) at commit
ea1c0925f8be825a5f5afac32ad2d0b2c699f7f7 with `bun build --target=node --format=esm` over an
entry that re-exports `HostPairing`, `HostServerConnection`, `ConnectionController`,
`IdentityStore`, `HostServerApi`, `ServerCredentialStore` and `SafeLogger` from
`packages/plugin/src`, and `createEvent`, `createRpcError`, `createRpcResponse` and
`MAX_SECURE_MESSAGE_BYTES` from `@dsh-remote/protocol`. Not edited here; see
`LICENSE.dsh-remote` (MIT).
