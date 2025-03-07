[**@clickup/pg-mig**](../README.md)

***

[@clickup/pg-mig](../globals.md) / loadDBDigest

# Function: loadDBDigest()

> **loadDBDigest**\<`TDest`\>(`dests`, `sqlRunner`): `Promise`\<`string`\>

Defined in: [src/cli.ts:206](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L206)

Loads the digest strings from the provided databases and chooses the one
which reflects the database schema status the best.

## Type Parameters

| Type Parameter |
| ------ |
| `TDest` |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `dests` | `TDest`[] |
| `sqlRunner` | (`dest`, `sql`) => `Promise`\<`Record`\<`string`, `string`\>[]\> |

## Returns

`Promise`\<`string`\>
