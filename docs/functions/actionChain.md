[**@clickup/pg-mig**](../README.md)

***

[@clickup/pg-mig](../globals.md) / actionChain

# Function: actionChain()

> **actionChain**(`options`, `registry`): `Promise`\<`boolean`\>

Defined in: src/actions/actionChain.ts:14

Overwrites the chain file for the migration versions. Chain file ensures that
the migration versions are appended strictly in the end (so a migration file
appeared in the middle will produce a git merge conflict).

## Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`MigrateOptions`](../interfaces/MigrateOptions.md) |
| `registry` | `Registry` |

## Returns

`Promise`\<`boolean`\>
