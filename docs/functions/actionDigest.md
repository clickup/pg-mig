[**@clickup/pg-mig**](../README.md)

***

[@clickup/pg-mig](../globals.md) / actionDigest

# Function: actionDigest()

> **actionDigest**(`_options`, `registry`): `Promise`\<`boolean`\>

Defined in: [src/actions/actionDigest.ts:12](https://github.com/clickup/pg-mig/blob/master/src/actions/actionDigest.ts#L12)

Prints the "code digest", of all migration version names on disk. Digest is a
string, and those strings can be compared lexicographically to determine
whether the code version is compatible with the DB version: if the DB's
digest is greater or equal to the code's digest, then they are compatible, so
the code can be deployed.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `_options` | [`MigrateOptions`](../interfaces/MigrateOptions.md) |
| `registry` | `Registry` |

## Returns

`Promise`\<`boolean`\>
